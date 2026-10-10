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
  var samplers: [String: AVAudioUnitSampler] = [:], programs: [String: Int] = [:]
  var mixers: [String: AVAudioMixerNode] = [:]
  private var mix: [String: InstrumentMix] = [:]
  var bank = URL(
    fileURLWithPath:
      "/System/Library/Components/CoreAudio.component/Contents/Resources/gs_instruments.dls")
  var timer: DispatchSourceTimer?, generation = 0
  var outputError: ((String) -> Void)?
  func sampler(_ part: Part) throws -> AVAudioUnitSampler {
    if let sampler = samplers[part.id], programs[part.id] == part.program { return sampler }
    let sampler = samplers[part.id] ?? AVAudioUnitSampler()
    if samplers[part.id] == nil {
      let mixer = AVAudioMixerNode()
      engine.attach(sampler)
      engine.attach(mixer)
      engine.connect(sampler, to: mixer, format: nil)
      engine.connect(mixer, to: engine.mainMixerNode, format: nil)
      samplers[part.id] = sampler
      mixers[part.id] = mixer
      applyMix()
    }
    try sampler.loadSoundBankInstrument(
      at: bank, program: UInt8(clamping: part.program),
      bankMSB: UInt8(
        part.percussion ? kAUSampler_DefaultPercussionBankMSB : kAUSampler_DefaultMelodicBankMSB),
      bankLSB: UInt8(kAUSampler_DefaultBankLSB))
    programs[part.id] = part.program
    return sampler
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
        guard let pitch = note.pitch else { return }
        let midi = UInt8(clamping: pitch.midi + note.transpose)
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
            samplers[value.0.partId]?.stopNote(UInt8(value.0.midi), onChannel: 0)
            active.removeValue(forKey: id)
          }
          while next < events.count && events[next].beat <= beat {
            let event = events[next]
            next += 1
            if event.beat + event.duration <= beat { continue }
            if partMap[event.partId] != nil {
              samplers[event.partId]?.startNote(
                UInt8(event.midi), withVelocity: UInt8(clamping: event.velocity), onChannel: 0)
              active[event.id] = (event, event.beat + max(0.1, event.duration))
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
  static func sample(program: Int, mix: InstrumentMix = InstrumentMix(), otherSolo: Bool = false)
    throws -> [Float]
  {
    let rack = AudioRack()
    rack.mix = ["test": mix]
    if otherSolo { rack.mix["other"] = InstrumentMix(solo: true) }
    let part = Part(id: "test", name: "Test", staves: 1, program: program, percussion: false)
    let sampler = try rack.sampler(part)
    let format = AVAudioFormat(standardFormatWithSampleRate: 44100, channels: 2)!
    try rack.engine.enableManualRenderingMode(.offline, format: format, maximumFrameCount: 1024)
    try rack.engine.start()
    sampler.startNote(69, withVelocity: 100, onChannel: 0)
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
    sampler.stopNote(69, onChannel: 0)
    rack.engine.stop()
    return Array(result.prefix(frames))
  }
}
