import Foundation

struct InstrumentMix: Equatable {
  var mute = false
  var solo = false
  var volume: Float = 0.8
  var pan: Float = 0
  static func audible(_ id: String, in mix: [String: InstrumentMix]) -> Bool {
    let value = mix[id] ?? InstrumentMix()
    return !value.mute && (!mix.values.contains(where: { $0.solo }) || value.solo)
  }
}

struct PlaybackTimeline {
  var starts: [Double]
  func measure(at beat: Double) -> Int {
    guard !starts.isEmpty else { return 0 }
    var low = 0
    var high = starts.count
    while low < high {
      let mid = (low + high) / 2
      if starts[mid] <= beat { low = mid + 1 } else { high = mid }
    }
    return max(0, low - 1)
  }
  func page(at beat: Double, barsPerPage: Int) -> Int { measure(at: beat) / barsPerPage }
  static func resolve(_ text: String, labels: [String]) throws -> Int {
    let value = text.trimmingCharacters(in: .whitespacesAndNewlines)
    let matching = labels.indices.filter { labels[$0] == value }
    if matching.count == 1 { return matching[0] }
    if matching.count > 1 {
      throw EditorError.message(
        "Several bars use that number. Select a note in the bar you want to play.")
    }
    if let number = Int(value), (1...max(1, labels.count)).contains(number), !labels.isEmpty {
      return number - 1
    }
    throw EditorError.message("Enter an existing bar number to start playback.")
  }
}
