import Foundation

struct Pitch: Codable, Equatable {
  var step: String
  var alter: Double
  var octave: Int
  var label: String {
    step + ([-2.0: "𝄫", -1.0: "♭", 0.0: "", 1.0: "♯", 2.0: "𝄪"][alter] ?? "(\(alter))")
      + String(octave)
  }
  var staffIndex: Int {
    octave * 7 + (["C", "D", "E", "F", "G", "A", "B"].firstIndex(of: step) ?? 0)
  }
  var midi: Int {
    (octave + 1) * 12 + (["C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11][step] ?? 0)
      + Int(alter)
  }
}
struct Part: Codable, Identifiable {
  var id: String
  var name: String
  var staves: Int
  var program: Int
  var percussion: Bool
}
struct Note: Codable, Identifiable {
  var id: String
  var partId: String
  var index: Int
  var measureIndex: Int
  var measureNumber: String
  var staff: Int
  var voice: String
  var pitch: Pitch?
  var rest: Bool
  var unpitched: Bool
  var grace: Bool
  var chord: Bool
  var type: String
  var dots: Int
  var onset: Double
  var duration: Double
  var transpose: Int
  var ties: [String]
  var label: String { unpitched ? "Unpitched note" : pitch?.label ?? "Rest" }
}
struct Diagnostic: Codable, Identifiable {
  var key: String
  var severity: String
  var message: String
  var partId: String
  var instrument: String
  var measureIndex: Int
  var measure: String
  var staff: Int?
  var voice: String?
  var noteId: String?
  var expected: String?
  var actual: String?
  var id: String { key + message }
}
struct EditState: Codable {
  var dirty: Bool
  var canUndo: Bool
  var canRedo: Bool
  var revision: Int
  var label: String
  var notes: [Note]
}
struct Summary: Codable {
  var title: String
  var measureCount: Int
  var eventCount: Int
  var parts: [Part]
  var initialTempo: Double
  var diagnostics: [Diagnostic]
  var measureLabels: [String]
  var dirty: Bool
  var canUndo: Bool
  var canRedo: Bool
  var revision: Int
}
struct HitTarget: Codable, Identifiable {
  var id: String
  var left: Double
  var top: Double
  var width: Double
  var height: Double
  var partId: String
  var rect: CGRect { CGRect(x: left, y: top, width: width, height: height) }
}
struct PlaybackEvent: Codable {
  var id: String
  var partId: String
  var measureIndex: Int
  var voice: String
  var midi: Int
  var beat: Double
  var duration: Double
  var velocity: Int
  var grace: Bool
}
struct Tempo: Codable {
  var beat: Double
  var bpm: Double
}
struct Playback: Codable {
  var events: [PlaybackEvent]
  var tempos: [Tempo]
  var totalBeats: Double
  var measureBeats: [Double]
  var parts: [Part]
}
enum EditorError: LocalizedError {
  case message(String)
  var errorDescription: String? {
    if case .message(let s) = self { return s }
    return nil
  }
}
func resource(_ name: String, _ ext: String) -> URL {
  #if SWIFT_PACKAGE
    return Bundle.module.url(forResource: name, withExtension: ext, subdirectory: "Resources")!
  #else
    return URL(fileURLWithPath: CommandLine.arguments[1]).appendingPathComponent(name + "." + ext)
  #endif
}
