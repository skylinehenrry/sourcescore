import AVFoundation
import AudioToolbox
import Foundation

struct TempoClock {
  var segments: [(beat: Double, seconds: Double, bpm: Double)]
  init(tempos: [Tempo], baseBPM: Double) {
    let first = tempos.sorted { $0.beat < $1.beat }.first(where: { $0.beat == 0 })?.bpm ?? baseBPM
    let factor = baseBPM / first
    var result: [(Double, Double, Double)] = [(0, 0, baseBPM)]
    for tempo in tempos.sorted(by: { $0.beat < $1.beat }) {
      let last = result.last!
      let seconds = last.1 + (tempo.beat - last.0) * 60 / last.2
      let entry = (tempo.beat, seconds, tempo.bpm * factor)
      if tempo.beat == last.0 { result[result.count - 1] = entry } else { result.append(entry) }
    }
    segments = result
  }
  func seconds(at beat: Double) -> Double {
    let segment = segments.last(where: { $0.beat <= beat }) ?? segments[0]
    return segment.seconds + (beat - segment.beat) * 60 / segment.bpm
  }
  func beat(at seconds: Double) -> Double {
    let segment = segments.last(where: { $0.seconds <= seconds }) ?? segments[0]
    return segment.beat + (seconds - segment.seconds) * segment.bpm / 60
  }
}
final class AudioRack: @unchecked Sendable {
  let queue = DispatchQueue(label: "SourceScore.audio", qos: .userInteractive)
  let engine = AVAudioEngine()
  var samplers: [String: AVAudioUnitMIDIInstrument] = [:], programs: [String: Int] = [:]
  private var patches: [String: (SoundPatch, URL)] = [:]
  private var loadedSounds: [String: String] = [:]
  private var currentArticulation: [String: Int] = [:]
  private var routing: [String: SoundPatch] = [:]
  var mixers: [String: AVAudioMixerNode] = [:]
  private var mix: [String: InstrumentMix] = [:]
  var bank = URL(
    fileURLWithPath:
      "/System/Library/Components/CoreAudio.component/Contents/Resources/gs_instruments.dls")
  var timer: DispatchSourceTimer?, generation = 0
  var outputError: ((String) -> Void)?
  func sampler(_ part: Part) throws -> AVAudioUnitMIDIInstrument {
    let patch = patches[part.id]
    let sound = patch?.0.id ?? "apple:\(part.program):\(part.percussion)"
    if let sampler = samplers[part.id], loadedSounds[part.id] == sound { return sampler }
    if let old = samplers.removeValue(forKey: part.id) {
      old.sendController(120, withValue: 0, onChannel: 0)
      engine.detach(old)
    }
    let sampler: AVAudioUnitMIDIInstrument
    if let (_, url) = patch {
      guard SoundLibrary.sineInstalled else {
        throw EditorError.message("SINE Player is unavailable. Install its Audio Unit or choose a built-in sound in the mixer.")
      }
      let state = try SoundLibrary.readPreset(url)
      var route = patch!.0
      route.readRouting(state)
      routing[part.id] = route
      sampler = AVAudioUnitMIDIInstrument(audioComponentDescription: SoundLibrary.sineDescription())
      sampler.auAudioUnit.fullState = state
    } else {
      routing.removeValue(forKey: part.id)
      let builtIn = AVAudioUnitSampler()
      try builtIn.loadSoundBankInstrument(
        at: bank, program: UInt8(clamping: part.program),
        bankMSB: UInt8(
          part.percussion ? kAUSampler_DefaultPercussionBankMSB : kAUSampler_DefaultMelodicBankMSB),
        bankLSB: UInt8(kAUSampler_DefaultBankLSB))
      sampler = builtIn
    }
    engine.attach(sampler)
    if mixers[part.id] == nil {
      let mixer = AVAudioMixerNode()
      engine.attach(mixer)
      engine.connect(mixer, to: engine.mainMixerNode, format: nil)
      mixers[part.id] = mixer
    }
    engine.connect(sampler, to: mixers[part.id]!, fromBus: 0, toBus: 0, format: nil)
    samplers[part.id] = sampler
    programs[part.id] = part.program
    loadedSounds[part.id] = sound
    currentArticulation.removeValue(forKey: part.id)
    applyMix()
    return sampler
  }
  func setSounds(_ values: [String: (SoundPatch, URL)]) {
    queue.async { [self] in patches = values }
  }
  func invalidateBuiltInSounds() {
    queue.async { [self] in
      for id in loadedSounds.keys where patches[id] == nil { loadedSounds.removeValue(forKey: id) }
    }
  }
  func resetSounds() {
    queue.async { [self] in
      generation += 1
      timer?.cancel()
      timer = nil
      for sampler in samplers.values {
        sampler.sendController(120, withValue: 0, onChannel: 0)
        engine.detach(sampler)
      }
      for mixer in mixers.values { engine.detach(mixer) }
      samplers = [:]
      mixers = [:]
      programs = [:]
      loadedSounds = [:]
      currentArticulation = [:]
      routing = [:]
      patches = [:]
    }
  }
  private func midi(_ value: Int, part: String) -> UInt8 {
    UInt8(max(0, min(127, patches[part]?.0.fixedMidi ?? value)))
  }
  private func prepare(_ sampler: AVAudioUnitMIDIInstrument, part: String, velocity: Int, articulations: [String] = []) {
    guard let patch = routing[part] ?? patches[part]?.0 else { return }
    if let keys = patch.articulationKeys,
      let key = articulations.compactMap({ keys[$0] }).first ?? keys["default"],
      currentArticulation[part] != key {
      sampler.startNote(UInt8(key), withVelocity: 1, onChannel: 0)
      sampler.stopNote(UInt8(key), onChannel: 0)
      currentArticulation[part] = key
    }
    let program = articulations.compactMap { patch.articulationPrograms?[$0] }.first
      ?? (articulations.contains("staccato") || articulations.contains("staccatissimo") ? patch.shortProgram : nil)
      ?? patch.longProgram
    if let program, currentArticulation[part] != program {
      sampler.sendProgramChange(UInt8(clamping: program), onChannel: 0)
      currentArticulation[part] = program
    }
    sampler.sendController(7, withValue: 100, onChannel: 0)
    let dynamics = UInt8(max(0, min(127, patch.dynamicsCC ?? 1)))
    sampler.sendController(dynamics, withValue: UInt8(clamping: velocity), onChannel: 0)
    if dynamics != 11 { sampler.sendController(11, withValue: 100, onChannel: 0) }
  }
  func editorInstrument(_ part: Part) async throws -> AVAudioUnitMIDIInstrument {
    try await withCheckedThrowingContinuation { continuation in
      queue.async { [self] in
        do {
          let unit = try sampler(part)
          try startEngine()
          continuation.resume(returning: unit)
        }
        catch { continuation.resume(throwing: error) }
      }
    }
  }
  func savePreset(_ unit: AVAudioUnitMIDIInstrument, to url: URL) async throws {
    try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
      queue.async { [self] in
        do {
          guard let state = unit.auAudioUnit.fullState else {
            throw EditorError.message("SINE could not save its instrument settings.")
          }
          let data = try PropertyListSerialization.data(fromPropertyList: state, format: .xml, options: 0)
          try data.write(to: url, options: .atomic)
          for (id, sampler) in samplers where sampler === unit {
            if var route = routing[id] {
              route.readRouting(state)
              routing[id] = route
              currentArticulation.removeValue(forKey: id)
            }
          }
          continuation.resume()
        } catch { continuation.resume(throwing: error) }
      }
    }
  }
  func startEngine() throws { if !engine.isRunning { try engine.start() } }
  private func applyMix() {
    for (id, mixer) in mixers {
      let value = mix[id] ?? InstrumentMix()
      mixer.outputVolume = InstrumentMix.audible(id, in: mix) ? value.volume : 0
      mixer.pan = value.pan
    }
  }
  func setMix(_ value: [String: InstrumentMix]) {
    queue.async { [self] in
      mix = value
      applyMix()
    }
  }
  func changeSound(_ part: Part) {
    queue.async { [self] in
      do { _ = try sampler(part) } catch { outputError?(error.localizedDescription) }
    }
  }
  func preview(_ note: Note, part: Part) {
    queue.async { [self] in
      do {
        let sampler = try self.sampler(part)
        try startEngine()
        guard let pitch = note.pitch.map({ $0.midi + note.transpose }) ?? note.playbackMidi else { return }
        let midi = self.midi(pitch, part: part.id)
        prepare(sampler, part: part.id, velocity: 90, articulations: note.playbackArticulations ?? [])
        sampler.startNote(midi, withVelocity: 90, onChannel: 0)
        queue.asyncAfter(deadline: .now() + 0.3) { sampler.stopNote(midi, onChannel: 0) }
      } catch { outputError?(error.localizedDescription) }
    }
  }
  func stop() {
    queue.async { [self] in
      generation += 1
      timer?.cancel()
      timer = nil
      for sampler in samplers.values { sampler.sendController(123, withValue: 0, onChannel: 0) }
    }
  }
  func play(
    _ playback: Playback, startBeat: Double, bpm: Double,
    ready: @escaping () -> Void = {},
    progress: @escaping (Double, Set<String>) -> Void, finished: @escaping () -> Void
  ) {
    queue.async { [self] in
      do {
        generation += 1
        let token = generation
        timer?.cancel()
        for sampler in samplers.values { sampler.sendController(123, withValue: 0, onChannel: 0) }
        let partMap = Dictionary(uniqueKeysWithValues: playback.parts.map { ($0.id, $0) })
        for part in playback.parts { _ = try sampler(part) }
        try startEngine()
        ready()
        let events = playback.events.filter { $0.beat + $0.duration > startBeat }.sorted {
          $0.beat < $1.beat
        }
        var next = 0
        var active: [String: (PlaybackEvent, Double)] = [:]
        var lastProgress = -1.0
        let started = ProcessInfo.processInfo.systemUptime
        let clock = TempoClock(tempos: playback.tempos, baseBPM: bpm)
        let initialSeconds = clock.seconds(at: startBeat)
        let source = DispatchSource.makeTimerSource(queue: queue)
        timer = source
        source.schedule(deadline: .now(), repeating: .milliseconds(10))
        source.setEventHandler { [self] in
          guard token == generation else { return }
          let elapsed = ProcessInfo.processInfo.systemUptime - started
          let beat = clock.beat(at: initialSeconds + elapsed)
          for (id, value) in active where beat >= value.1 {
            samplers[value.0.partId]?.stopNote(midi(value.0.midi, part: value.0.partId), onChannel: 0)
            active.removeValue(forKey: id)
          }
          while next < events.count && events[next].beat <= beat {
            let event = events[next]
            next += 1
            if event.beat + event.duration <= beat { continue }
            if partMap[event.partId] != nil {
              if let sampler = samplers[event.partId] {
                prepare(sampler, part: event.partId, velocity: event.velocity, articulations: event.articulations ?? [])
                sampler.startNote(
                  midi(event.midi, part: event.partId), withVelocity: UInt8(clamping: event.velocity), onChannel: 0)
              }
              let detached = event.articulations?.contains("staccato") == true || event.articulations?.contains("staccatissimo") == true
              active[event.id] = (event, event.beat + max(0.05, event.duration * (detached ? 0.5 : 1)))
            }
          }
          if elapsed - lastProgress >= 0.05 {
            let ids = active.values.flatMap { value -> [String] in
              guard let segments = value.0.segments else { return [value.0.id] }
              return segments.filter { beat >= $0.beat && beat < $0.beat + $0.duration }.map {
                $0.id
              }
            }
            progress(beat, Set(ids))
            lastProgress = elapsed
          }
          if beat >= playback.totalBeats && next == events.count && active.isEmpty {
            source.cancel()
            timer = nil
            finished()
          }
        }
        source.resume()
      } catch {
        outputError?(error.localizedDescription)
        finished()
      }
    }
  }
  /// Real offline audio render used by tests; avoids reliance on an output device.
  static func sample(program: Int, mix: InstrumentMix = InstrumentMix(), otherSolo: Bool = false,
    patch: SoundPatch? = nil, preset: URL? = nil, note: Int = 69)
    throws -> [Float]
  {
    let rack = AudioRack()
    rack.mix = ["test": mix]
    if otherSolo { rack.mix["other"] = InstrumentMix(solo: true) }
    if let patch, let preset { rack.patches["test"] = (patch, preset) }
    let part = Part(id: "test", name: "Test", staves: 1, program: program, percussion: false)
    let sampler = try rack.sampler(part)
    let format = AVAudioFormat(standardFormatWithSampleRate: 44100, channels: 2)!
    try rack.engine.enableManualRenderingMode(.offline, format: format, maximumFrameCount: 1024)
    try rack.engine.start()
    let midi = rack.midi(note, part: "test")
    rack.prepare(sampler, part: "test", velocity: 100)
    sampler.startNote(midi, withVelocity: 100, onChannel: 0)
    let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 1024)!
    let frames = 22050
    var result: [Float] = []
    while result.count < frames {
      let status = try rack.engine.renderOffline(1024, to: buffer)
      if status == .success, let samples = buffer.floatChannelData {
        result.append(
          contentsOf: UnsafeBufferPointer(start: samples[0], count: Int(buffer.frameLength)))
      } else if status == .error {
        throw EditorError.message("Offline instrument rendering failed.")
      }
    }
    sampler.stopNote(midi, onChannel: 0)
    rack.engine.stop()
    return Array(result.prefix(frames))
  }
}
