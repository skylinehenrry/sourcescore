import AudioToolbox
import Foundation

struct SoundPatch: Codable, Identifiable, Equatable {
  var id: String
  var name: String
  var preset: String
  var programs: [Int]
  var aliases: [String]
  var percussion: Bool
  var fixedMidi: Int?
  var shortProgram: Int?
  var longProgram: Int?
  var dynamicsCC: Int?
  var articulationPrograms: [String: Int]?
  var articulationKeys: [String: Int]?
  mutating func readRouting(_ state: [String: Any]) {
    guard let data = state["jucePluginState"] as? Data,
      let source = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      let instrument = (source["instruments"] as? [[String: Any]])?.first,
      let articulations = instrument["articulations"] as? [[String: Any]] else { return }
    var values: [String: Int] = [:]
    for (index, articulation) in articulations.enumerated() {
      guard let options = articulation["mainOptions"] as? [String: Any],
        let text = options["switchValue"] as? String, let value = Int(text), (0...127).contains(value) else { continue }
      let name = ((articulation["id"] as? String ?? "") + " " + (articulation["title"] as? String ?? "")).lowercased()
      if index == 0 || name.contains("sustain") || name.contains("long") { values["default"] = value }
      if name.contains("stacc") || name.contains("spicc") || name.contains("short") {
        values["staccato"] = value
        values["staccatissimo"] = value
      }
      if name.contains("pizz") { values["pizzicato"] = value }
      if name.contains("trem") || name.contains("roll") { values["tremolo"] = value }
    }
    let kind = instrument["switchType"] as? String ?? ""
    articulationKeys = nil
    articulationPrograms = nil
    longProgram = nil
    shortProgram = nil
    if kind == "KEYSWITCH" {
      articulationKeys = values
    } else if kind.hasPrefix("PROGRAM") {
      articulationKeys = nil
      articulationPrograms = values
      longProgram = values["default"]
      shortProgram = values["staccato"]
    }
  }
}

/// Playback preferences and AU presets live outside the authoritative MusicXML.
struct SoundLibrary {
  let directory: URL
  let patches: [SoundPatch]
  static var directory: URL {
    FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("SourceScore/Sounds/Berlin Free Orchestra", isDirectory: true)
  }
  init(directory: URL = Self.directory) {
    self.directory = directory
    let index = directory.appendingPathComponent("index.json")
    let decoded = (try? Data(contentsOf: index)).flatMap { try? JSONDecoder().decode([SoundPatch].self, from: $0) } ?? []
    patches = decoded.filter {
      !$0.preset.contains("/") && !$0.preset.contains("..")
        && FileManager.default.fileExists(atPath: directory.appendingPathComponent($0.preset).path)
    }
  }
  func preset(_ patch: SoundPatch) -> URL { directory.appendingPathComponent(patch.preset) }
  func adding(_ state: [String: Any], name: String, part: Part?) throws -> SoundPatch {
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    let id = UUID().uuidString
    var patch = SoundPatch(id: id, name: name, preset: id + ".aupreset",
      programs: part.map { [$0.program] } ?? [], aliases: [], percussion: part?.percussion ?? false)
    patch.readRouting(state)
    let data = try PropertyListSerialization.data(fromPropertyList: state, format: .xml, options: 0)
    try data.write(to: preset(patch), options: .atomic)
    let index = try JSONEncoder().encode(patches + [patch])
    try index.write(to: directory.appendingPathComponent("index.json"), options: .atomic)
    return patch
  }
  func match(_ part: Part) -> SoundPatch? {
    let name = part.name.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: .current)
    let named = patches.filter { patch in
      patch.aliases.contains { alias in
        name.contains(alias.lowercased())
      }
    }.max { left, right in
      let a = left.aliases.filter { name.contains($0.lowercased()) }.map(\.count).max() ?? 0
      let b = right.aliases.filter { name.contains($0.lowercased()) }.map(\.count).max() ?? 0
      return a < b
    }
    if let named { return named }
    return patches.first { $0.percussion == part.percussion && $0.programs.contains(part.program) }
  }
  static func sineDescription() -> AudioComponentDescription {
    func code(_ value: String) -> UInt32 { value.utf8.reduce(0) { ($0 << 8) | UInt32($1) } }
    return AudioComponentDescription(
      componentType: code("aumu"), componentSubType: code("Y355"),
      componentManufacturer: code("Orto"), componentFlags: 0, componentFlagsMask: 0)
  }
  static var sineInstalled: Bool {
    var description = sineDescription()
    return AudioComponentFindNext(nil, &description) != nil
  }
  static func readPreset(_ url: URL) throws -> [String: Any] {
    let data = try Data(contentsOf: url)
    if url.pathExtension.lowercased() != "aupreset" {
      guard let preset = try JSONSerialization.jsonObject(with: data) as? [String: Any],
        preset["fileFormatVersion"] != nil, preset["renderer"] != nil else {
        throw EditorError.message("Choose a preset saved from SINE Player.")
      }
      try validateSineState(preset)
      let description = sineDescription()
      return ["type": description.componentType, "subtype": description.componentSubType,
        "manufacturer": description.componentManufacturer, "version": 0, "name": "SINE Player",
        "jucePluginState": data]
    }
    guard let state = try PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any] else {
      throw EditorError.message("The instrument preset could not be read.")
    }
    let description = sineDescription()
    guard (state["type"] as? NSNumber)?.uint32Value == description.componentType,
      (state["subtype"] as? NSNumber)?.uint32Value == description.componentSubType,
      (state["manufacturer"] as? NSNumber)?.uint32Value == description.componentManufacturer else {
      throw EditorError.message("This sound requires a SINE Player instrument preset.")
    }
    guard let content = state["jucePluginState"] as? Data,
      let source = try JSONSerialization.jsonObject(with: content) as? [String: Any] else {
      throw EditorError.message("This SINE instrument preset is incomplete.")
    }
    try validateSineState(source)
    return state
  }
  private static func validateSineState(_ source: [String: Any]) throws {
    guard let instruments = source["instruments"] as? [[String: Any]], !instruments.isEmpty else {
      throw EditorError.message("Load an instrument in SINE Player before saving its preset.")
    }
    for instrument in instruments {
      let required = ["id", "instanceId", "midiChannel", "keyRangeLow", "keyRangeHigh", "volume"]
      guard required.allSatisfy({ instrument[$0] != nil }),
        let articulations = instrument["articulations"] as? [[String: Any]], !articulations.isEmpty,
        let microphones = instrument["micPositions"] as? [[String: Any]], !microphones.isEmpty,
        microphones.allSatisfy({ $0["instanceId"] != nil && $0["id"] != nil }),
        articulations.allSatisfy({ a in
          ["id", "instanceId", "mainOptions", "roundRobinOptions", "dynamicsOptions", "envelopeOptions", "legatoOptions"].allSatisfy { a[$0] != nil }
        }) else {
        throw EditorError.message("Save a fresh instrument preset from SINE Player. This preset is incomplete or uses an unsupported articulation format.")
      }
    }
  }
}
