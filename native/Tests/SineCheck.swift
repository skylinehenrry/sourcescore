import AVFoundation
import Foundation

@main struct SineCheck {
  static func require(_ condition: Bool, _ message: String) throws {
    if !condition { throw EditorError.message(message) }
  }
  static func main() async throws {
    let library = CommandLine.arguments.count > 1
      ? SoundLibrary(directory: URL(fileURLWithPath: CommandLine.arguments[1])) : SoundLibrary()
    try require(SoundLibrary.sineInstalled && !library.patches.isEmpty,
      "Install SINE Player, download Berlin Free Orchestra and configure its local presets first.")
    var report: [[String: Any]] = []
    for patch in library.patches {
      let program = patch.programs.first ?? 0
      let note = [43: 48, 42: 60, 41: 60, 58: 45, 70: 55, 60: 60, 73: 74, 72: 84, 47: 48, 12: 60][program] ?? 69
      let samples = try AudioRack.sample(program: program,
        patch: patch, preset: library.preset(patch), note: note)
      let energy = samples.reduce(0.0) { $0 + Double($1 * $1) } / Double(samples.count)
      try require(energy > 0.00000001, "SINE produced no audio for \(patch.name)")
      report.append(["sound": patch.name, "frames": samples.count, "meanSquare": energy])
      print("PASS SINE audio: \(patch.name)")
    }
    let patch = library.patches.first!
    let muted = try AudioRack.sample(program: 0, mix: InstrumentMix(mute: true),
      patch: patch, preset: library.preset(patch))
    let excluded = try AudioRack.sample(program: 0, otherSolo: true,
      patch: patch, preset: library.preset(patch))
    try require(muted.allSatisfy { abs($0) < 0.00001 } && excluded.allSatisfy { abs($0) < 0.00001 },
      "Muted/non-solo SINE instruments leaked audio")
    print("PASS Actual SINE mute and solo routing")
    let data = try JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys])
    try data.write(to: URL(fileURLWithPath: "work/berlin-render-report.json"))
    print("PASS \(report.count) configured Berlin instrument presets rendered actual audio")
  }
}
