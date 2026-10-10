import AppKit
import Foundation

@main struct NativeCheck {
  static func check(_ condition: Bool, _ message: String) throws {
    if !condition { throw EditorError.message(message) }
  }
  static func main() async throws {
    let source = try String(contentsOf: resource("example", "musicxml"), encoding: .utf8)
    let engine = CoreEngine()
    let summary = try await engine.decode(Summary.self, "open", ["source": source])
    try check(summary.parts.count == 6, "Instrument summary")
    let original = try await engine.decode(String.self, "source")
    try check(original == source, "No-op JSC source changed bytes")
    let start = ProcessInfo.processInfo.systemUptime
    let state = try await engine.decode(EditState.self, "semitone", ["ids": ["0:0:0"], "delta": 1])
    try check(state.notes[0].pitch?.label == "G5", "Semitone movement")
    print(
      String(
        format: "PASS JavaScriptCore pitch edit: %.2f ms",
        (ProcessInfo.processInfo.systemUptime - start) * 1000))
    _ = try await engine.call("undo", ["ids": ["0:0:0"]])
    let undone = try await engine.decode(String.self, "source")
    try check(undone == source, "Exact undo failed")
    let store = FileStore()
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }
    let path = directory.appendingPathComponent("score.musicxml")
    try Data(source.utf8).write(to: path)
    let (_, file) = try await store.open(path)
    let noop = try await store.save(source, to: file)
    try check(noop.unchanged && noop.backup == nil, "No-op file save")
    let changed = source.replacingOccurrences(of: "<alter>1</alter>", with: "<alter>0</alter>")
    let saved = try await store.save(changed, to: file)
    try check(try Data(contentsOf: saved.backup!) == Data(source.utf8), "Exact backup")
    let external = Data((changed + "<!-- external -->").utf8)
    try external.write(to: path)
    var blocked = false
    do { _ = try await store.save(changed, to: saved.reference) } catch { blocked = true }
    try check(blocked, "External conflict was overwritten")
    try check(try Data(contentsOf: path) == external, "External bytes changed")
    print("PASS Native no-op, atomic save, exact backup and conflict protection")
    let scene = try VectorScene.parse(
      "<svg width='100' height='100' viewBox='0 0 100 100'><g data-source-note='0:0:0'><path d='M0 0L20 0L20 10Z'/></g></svg>"
    )
    try check(scene.marks.count == 1 && scene.marks[0].style.owner == "0:0:0", "Vector identity")
    print("PASS Native vector path and note identity")
    let clock = TempoClock(
      tempos: [Tempo(beat: 0, bpm: 120), Tempo(beat: 4, bpm: 60)], baseBPM: 120)
    try check(
      abs(clock.seconds(at: 8) - 6) < 0.001 && abs(clock.beat(at: 6) - 8) < 0.001,
      "Source tempo changes")
    print("PASS Source tempo changes and clock conversion")
    let timeline = PlaybackTimeline(starts: [0, 3, 6, 10, 14, 17])
    try check(
      timeline.measure(at: 9.99) == 2 && timeline.measure(at: 10) == 3
        && timeline.page(at: 14, barsPerPage: 4) == 1, "Playback bar/page boundaries")
    try check(
      try PlaybackTimeline.resolve("5", labels: ["1", "2", "3", "4", "5"]) == 4, "Bar seek")
    var mix = ["flute": InstrumentMix(solo: true), "piano": InstrumentMix()]
    try check(
      InstrumentMix.audible("flute", in: mix) && !InstrumentMix.audible("piano", in: mix),
      "Solo routing")
    mix["piano"]?.solo = true
    mix["flute"]?.mute = true
    try check(
      !InstrumentMix.audible("flute", in: mix) && InstrumentMix.audible("piano", in: mix),
      "Multi-solo and mute")
    print("PASS Arbitrary bar seek, playback page boundaries, mute and multi-solo routing")
    let piano = try AudioRack.sample(program: 0)
    let flute = try AudioRack.sample(program: 73)
    try check(
      piano.reduce(0) { $0 + abs($1) } > 0.1 && flute.reduce(0) { $0 + abs($1) } > 0.1,
      "Audio output is silent")
    try check(
      zip(piano, flute).reduce(0) { $0 + abs($1.0 - $1.1) } > 0.1,
      "Different instruments have identical audio")
    print("PASS Actual piano/flute audio: nonzero, different rendered waveforms")
    let muted = try AudioRack.sample(program: 73, mix: InstrumentMix(mute: true))
    let excluded = try AudioRack.sample(program: 0, otherSolo: true)
    try check(
      muted.reduce(0) { $0 + abs($1) } < 0.0001 && excluded.reduce(0) { $0 + abs($1) } < 0.0001,
      "Muted/non-solo channels still sound")
    print("PASS Real mixer renders muted and excluded instruments as silence")
    let tied =
      "<score-partwise><part-list><score-part id='P1'><part-name>Violin</part-name></score-part></part-list><part id='P1'><measure number='1'><attributes><divisions>1</divisions><key><fifths>1</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time></attributes><note><pitch><step>F</step><alter>1</alter><octave>4</octave></pitch><duration>4</duration><tie type='start'/><type>whole</type><notations><tied type='start'/></notations></note></measure><measure number='2'><note><pitch><step>F</step><alter>1</alter><octave>4</octave></pitch><duration>4</duration><tie type='stop'/><type>whole</type><notations><tied type='stop'/></notations></note></measure></part></score-partwise>"
    _ = try await engine.call("open", ["source": tied])
    let connected = try await engine.decode(
      EditState.self, "semitone", ["ids": ["0:1:0"], "delta": 1])
    try check(
      connected.notes.count == 2 && connected.notes.allSatisfy { $0.pitch?.label == "G4" },
      "Bridge lost connected pitch updates")
    _ = try await engine.call("validate-save")
    let arrangement = try await engine.decode(Playback.self, "playback")
    try check(
      arrangement.events.count == 1 && arrangement.events[0].duration == 8
        && arrangement.events[0].segments?.count == 2, "Tied playback timing/highlights")
    _ = try await engine.call("undo")
    let restored = try await engine.decode(String.self, "source")
    try check(restored == tied, "Native connected-note undo")
    print(
      "PASS Native tie-chain updates, save validation, sustained playback segments and exact undo")
    var invalidBlocked = false
    do {
      _ = try await engine.call(
        "open",
        [
          "source": tied.replacingOccurrences(
            of: "</divisions>", with: "</divisions><staves>Infinity</staves>")
        ])
    } catch { invalidBlocked = true }
    let retained = try await engine.decode(String.self, "source")
    try check(invalidBlocked && retained == tied, "Failed open replaced the active source")
    print("PASS Failed native open retains the previous score source")
    let composition = try await engine.decode(
      String.self, "new-score", ["title": "Native composition", "instruments": ["Piano"], "bars": 2])
    _ = try await engine.call("open", ["source": composition])
    let entered = try await engine.decode(
      EditState.self, "input", ["id": "0:0:0", "letter": "B", "type": "quarter"])
    try check(entered.notes.first(where: { $0.id == "0:0:0" })?.pitch?.label == "B3", "Keyboard entry octave")
    let next = try await engine.decode(Note.self, "input-next", ["id": "0:0:0"])
    let second = try await engine.decode(
      EditState.self, "input", ["id": next.id, "letter": "C", "type": "quarter"])
    try check(second.notes.first(where: { $0.id == next.id })?.pitch?.label == "C4", "Entry across octave boundary")
    let chord = try await engine.decode(
      EditState.self, "input", ["id": "0:0:0", "letter": "D", "type": "quarter", "chord": true])
    let chordId = chord.selection!.first!
    try check(chord.notes.first(where: { $0.id == chordId })?.chord == true, "Chord entry")
    _ = try await engine.call("marking", ["id": "0:0:0", "kind": "dynamic", "symbol": "ff"])
    let items = try await engine.decode([NotationItem].self, "items", ["partId": "P1", "measureIndex": 0])
    try check(items.contains(where: { $0.kind == "dynamics" && $0.label.contains("ff") }), "Notation inspector bridge")
    _ = try await engine.call("validate-save")
    let compositionPath = directory.appendingPathComponent("composition.musicxml")
    let composed = try await engine.decode(String.self, "source")
    let compositionTarget = try await store.target(compositionPath)
    _ = try await store.save(composed, to: compositionTarget)
    try check(try String(contentsOf: compositionPath, encoding: .utf8) == composed, "Native structural save bytes")
    let bass = try await engine.decode(Note.self, "note", ["id": "0:0:1"])
    try check(bass.rest && bass.staff == 2 && bass.duration == 4, "Insertion changed other staff identity/timing")
    _ = try await engine.call("delete", ["ids": ["0:0:0", chordId]])
    let erased = try await engine.decode(Note.self, "note", ["id": "0:0:0"])
    try check(erased.rest && erased.duration == 1, "Delete did not preserve event timing")
    _ = try await engine.call("undo")
    let deleteUndo = try await engine.decode(String.self, "source")
    try check(deleteUndo == composed, "Native deletion undo changed bytes")
    for _ in 0..<4 { _ = try await engine.call("undo") }
    let compositionUndo = try await engine.decode(String.self, "source")
    try check(compositionUndo == composition, "Mixed structural history did not restore source")
    print("PASS Native new score, keyboard/chord entry, deletion, notation inspector, structural save and exact mixed undo")
    _ = try await engine.call("signature", ["partId": "P1", "index": 0, "staff": 1, "kind": "time", "values": ["beats": "3", "unit": "4"]])
    _ = try await engine.call("validate-save")
    let emptyMeter = try await engine.decode(Note.self, "note", ["id": "0:1:1"])
    try check(emptyMeter.rest && emptyMeter.duration == 3 && emptyMeter.onset == 0, "Empty meter did not fit both staves")
    _ = try await engine.call("undo")
    let meterUndo = try await engine.decode(String.self, "source")
    try check(meterUndo == composition, "Meter fitting undo changed bytes")
    print("PASS Native empty-bar meter change, voice backups and exact undo")
  }
}
