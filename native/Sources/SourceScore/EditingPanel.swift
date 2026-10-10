import SwiftUI

let editingDurations = [
  "64th", "32nd", "16th", "eighth", "quarter", "half", "whole", "breve", "long", "128th", "256th",
]
struct NoteEntryBar: View {
  @ObservedObject var model: EditorModel
  var body: some View {
    HStack(spacing: 10) {
      Toggle("Note input · N", isOn: $model.noteInput).toggleStyle(.button)
      Picker("Value", selection: $model.inputType) {
        ForEach(editingDurations, id: \.self) { Text($0.capitalized) }
      }.frame(width: 125)
      Picker("Dots", selection: $model.inputDots) {
        Text("None").tag(0)
        Text("·").tag(1)
        Text("··").tag(2)
      }.frame(width: 90)
      Picker("Accidental", selection: $model.inputAlter) {
        Text("Key signature").tag(nil as Int?)
        ForEach(-2...2, id: \.self) { Text(["𝄫", "♭", "♮", "♯", "𝄪"][$0 + 2]).tag(Optional($0)) }
      }.frame(width: 200)
      Toggle("Chord", isOn: $model.inputChord).toggleStyle(.button)
      Toggle("Grace", isOn: $model.inputGrace).toggleStyle(.button)
      Button("Rest · R") { model.enter(nil) }
      Button(action: model.deleteSelection) { Image(systemName: "trash") }.help(
        "Delete selected note or marking")
      Spacer()
    }.controlSize(.small).padding(.horizontal, 16).padding(.vertical, 8)
  }
}
struct EditingPanel: View {
  @ObservedObject var model: EditorModel
  @StateObject private var form = EditingDraft()
  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 14) {
        Picker("Editing", selection: $model.editTab) {
          Text("Notes").tag("Notes")
          Text("Notation").tag("Notation")
          Text("Bar").tag("Bar")
        }.pickerStyle(.segmented).labelsHidden()
        if let part = model.summary?.parts.first(where: { $0.id == model.barPartId }) {
          Text("\(part.name) · Bar \(model.barIndex+1) · Staff \(model.barStaff)").font(.caption)
            .foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
        }
        if model.editTab == "Notes" {
          noteControls
        } else if model.editTab == "Notation" {
          notationControls
        } else {
          barControls
        }
      }.padding(16).font(.caption)
    }.frame(width: 275).onChange(of: model.editTab) { _, tab in
      if tab != "Notes" { model.refreshItems() }
    }
  }
  @ViewBuilder var noteControls: some View {
    if let note = model.primary {
      Text(note.label).font(.title)
      if let pitch = note.pitch {
        HStack {
          Picker(
            "Step",
            selection: Binding(
              get: { pitch.step },
              set: {
                model.edit(
                  "pitch",
                  [
                    "id": note.id,
                    "pitch": ["step": $0, "alter": pitch.alter, "octave": pitch.octave],
                  ])
              })
          ) { ForEach(["C", "D", "E", "F", "G", "A", "B"], id: \.self) { Text($0) } }
          Stepper(
            "Octave \(pitch.octave)",
            value: Binding(
              get: { pitch.octave },
              set: {
                model.edit(
                  "pitch",
                  [
                    "id": note.id,
                    "pitch": ["step": pitch.step, "alter": pitch.alter, "octave": $0],
                  ])
              }), in: 0...9)
        }
        HStack {
          ForEach(-2...2, id: \.self) { alter in
            Button(["𝄫", "♭", "♮", "♯", "𝄪"][alter + 2]) {
              model.edit("accidental", ["ids": Array(model.selection), "alter": alter])
            }.buttonStyle(.borderless).frame(maxWidth: .infinity)
          }
        }
        Button("Enharmonic spelling") { model.edit("respell", ["id": note.id, "direction": 1]) }
          .buttonStyle(.plain)
      }
      Picker(
        "Duration", selection: Binding(get: { note.type }, set: { model.duration($0, note.dots) })
      ) {
        if note.type.isEmpty { Text(note.fullMeasureRest == true ? "Full bar" : "Unspecified").tag("") }
        ForEach(editingDurations, id: \.self) { Text($0.capitalized) }
      }
      Picker("Dots", selection: Binding(get: { note.dots }, set: { model.duration(note.type, $0) }))
      { ForEach(0...2, id: \.self) { Text(String($0)) } }
      Picker(
        "Voice",
        selection: Binding(
          get: { note.voice }, set: { model.edit("voice", ["id": note.id, "voice": $0]) })
      ) { ForEach(1...8, id: \.self) { Text(String($0)).tag(String($0)) } }
      if let part = model.summary?.parts.first(where: { $0.id == note.partId }), part.staves > 1 {
        Picker(
          "Staff",
          selection: Binding(
            get: { note.staff }, set: { model.edit("staff", ["id": note.id, "staff": $0]) })
        ) { ForEach(1...part.staves, id: \.self) { Text(String($0)) } }
      }
      Button("Delete note / replace with rest", action: model.deleteSelection)
      Divider()
      HStack {
        TextField("Actual", text: $form.tupletActual)
        Text(":")
        TextField("Normal", text: $form.tupletNormal)
      }
      Button("Create tuplet in selected rest") {
        model.edit(
          "tuplet",
          [
            "id": note.id, "actual": Int(form.tupletActual) ?? 3,
            "normal": Int(form.tupletNormal) ?? 2,
          ])
      }
      Divider()
      Button("Play this instrument") {
        model.soloOnly(note.partId)
        model.setPlaybackStart(note.measureIndex)
        model.mixerVisible = true
        model.playFromBar()
      }
      Text("N input · A–G notes · Shift+A–G chord · R rest · 1–9 value · Delete erase").font(
        .caption2
      ).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
    } else {
      Text("Select a note or rest. For an empty bar, add a voice in Bar tools.").foregroundStyle(
        .secondary)
    }
  }
  var notationControls: some View {
    VStack(alignment: .leading, spacing: 12) {
      Picker("Add", selection: $form.markingKind) {
        ForEach(
          [
            "dynamic", "articulation", "ornament", "technique", "fermata", "text", "tempo", "lyric",
          ], id: \.self
        ) { Text($0.capitalized) }
      }
      if ["text", "tempo", "lyric"].contains(form.markingKind) {
        TextField(form.markingKind.capitalized, text: $form.markingText)
      } else {
        Picker("Mark", selection: $form.markingSymbol) { ForEach(symbols, id: \.self) { Text($0) } }
          .onChange(of: form.markingKind) { _, _ in form.markingSymbol = symbols.first ?? "" }
      }
      Button("Add marking") {
        model.addMarking(form.markingKind, form.markingSymbol, form.markingText)
      }.disabled(
        model.primary == nil)
      HStack {
        Picker("Span", selection: $form.spanKind) {
          ForEach(
            [
              "slur", "tie", "crescendo", "diminuendo", "pedal", "octave-up", "octave-down",
              "glissando", "slide",
            ], id: \.self
          ) { Text($0) }
        }
        Button("Add") { model.addSpan(form.spanKind) }.disabled(model.selection.count < 2)
      }
      Text("Command-click both endpoints.").font(.caption2).foregroundStyle(.secondary)
      Divider()
      ForEach(model.notationItems) { item in
        Button {
          model.selectedItemId = item.id
        } label: {
          Text(item.label).frame(maxWidth: .infinity, alignment: .leading).fontWeight(
            model.selectedItemId == item.id ? .semibold : .regular)
        }.buttonStyle(.plain)
      }
      if let item = model.selectedItem {
        Divider()
        Text(item.label).font(.headline)
        ForEach(item.fields) { field in
          PropertyRow(model: model, item: item, field: field).id(item.id + field.key + field.value)
        }
        Button("Delete this marking") {
          model.edit("delete-item", ["id": item.id])
          model.selectedItemId = nil
        }
      }
    }
  }
  var barControls: some View {
    VStack(alignment: .leading, spacing: 12) {
      HStack {
        Picker("Voice", selection: $form.voice) {
          ForEach(1...8, id: \.self) { Text(String($0)).tag(String($0)) }
        }
        Button("Add voice") { model.createVoice(form.voice) }
      }
      Divider()
      HStack {
        Picker("Clef", selection: $form.clefSign) {
          ForEach(["G", "F", "C", "percussion", "TAB", "none"], id: \.self) { Text($0) }
        }
        TextField("Line", text: $form.clefLine).frame(width: 35)
      }
      Button("Set clef") { model.setBar("clef", ["sign": form.clefSign, "line": form.clefLine]) }
      HStack {
        TextField("Fifths −7…7", text: $form.keyFifths)
        Picker("Mode", selection: $form.keyMode) {
          Text("Major").tag("major")
          Text("Minor").tag("minor")
        }
      }
      Button("Set key signature") {
        model.setBar("key", ["fifths": form.keyFifths, "mode": form.keyMode])
      }
      HStack {
        TextField("Beats", text: $form.meterBeats)
        Text("/")
        TextField("Unit", text: $form.meterUnit)
      }
      Button("Set time signature") {
        model.setBar("time", ["beats": form.meterBeats, "unit": form.meterUnit])
      }
      Text("Empty bars fit the meter. Music keeps its rhythm; undo a meter change if new timing issues prevent saving.").font(.caption2).foregroundStyle(
        .secondary)
      Divider()
      Picker("Barline", selection: $form.barStyle) {
        ForEach(
          ["regular", "light-light", "light-heavy", "heavy-light", "dashed", "dotted", "none"],
          id: \.self
        ) { Text($0) }
      }
      Picker("Repeat", selection: $form.repeatDirection) {
        Text("None").tag("")
        Text("Start").tag("forward")
        Text("End").tag("backward")
      }
      Button("Set barline / repeat") {
        model.setBar("barline", ["style": form.barStyle, "repeat": form.repeatDirection])
      }
      Divider()
      Button("Insert bar before") { model.edit("insert-bar", ["index": model.barIndex]) }
      Button("Append bar") { model.edit("insert-bar", ["index": model.summary?.measureCount ?? 0]) }
      Button("Delete this bar") { model.edit("delete-bar", ["index": model.barIndex]) }
      Button("Show objects in this bar") { model.editTab = "Notation" }
    }
  }
  var symbols: [String] {
    switch form.markingKind {
    case "dynamic":
      return [
        "pppp", "ppp", "pp", "p", "mp", "mf", "f", "ff", "fff", "ffff", "sfz", "fp", "sfp", "rfz",
      ]
    case "articulation":
      return [
        "staccato", "staccatissimo", "accent", "strong-accent", "tenuto", "detached-legato",
        "breath-mark", "caesura", "scoop", "plop", "doit", "falloff",
      ]
    case "ornament":
      return [
        "trill-mark", "turn", "inverted-turn", "delayed-turn", "mordent", "inverted-mordent",
        "shake", "schleifer", "tremolo",
      ]
    case "technique":
      return [
        "up-bow", "down-bow", "open-string", "stopped", "snap-pizzicato", "fingering", "pluck",
        "tap", "heel", "toe",
      ]
    default:
      return [
        "normal", "angled", "square", "double-angled", "double-square", "double-dot", "half-curve",
        "curlew",
      ]
    }
  }
}
struct PropertyRow: View {
  @ObservedObject var model: EditorModel
  var item: NotationItem
  var field: PropertyField
  @StateObject private var draft = EditingDraft()
  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      Text(field.label).foregroundStyle(.secondary)
      if field.readOnly == true {
        Text(field.value).textSelection(.enabled)
      } else if let options = field.options {
        Picker(
          field.label,
          selection: Binding(
            get: { field.value },
            set: { model.edit("item-property", ["id": item.id, "key": field.key, "value": $0]) })
        ) { ForEach(options, id: \.self) { Text($0) } }.labelsHidden()
      } else {
        TextField(field.label, text: $draft.text).onAppear { draft.text = field.value }.onSubmit {
          model.edit("item-property", ["id": item.id, "key": field.key, "value": draft.text])
        }
      }
    }
  }
}
struct NewScoreSheet: View {
  @ObservedObject var model: EditorModel
  @StateObject private var form = EditingDraft()
  var body: some View {
    VStack(alignment: .leading, spacing: 18) {
      Text("New score").font(.title2)
      TextField("Title", text: $form.title)
      TextField("Instruments, separated by commas", text: $form.instruments)
      Stepper("\(form.bars) bars", value: $form.bars, in: 1...1000)
      HStack {
        Stepper("\(form.beats) beats", value: $form.beats, in: 1...32)
        Picker("Unit", selection: $form.unit) {
          ForEach([1, 2, 4, 8, 16, 32], id: \.self) { Text(String($0)) }
        }
      }
      HStack {
        Spacer()
        Button("Cancel") { model.newScoreSheet = false }
        Button("Create") {
          model.createScore(
            title: form.title,
            instruments: form.instruments.split(separator: ",").map {
              $0.trimmingCharacters(in: .whitespaces)
            }.filter { !$0.isEmpty }, bars: form.bars, beats: form.beats, unit: form.unit)
        }.keyboardShortcut(.defaultAction)
      }
    }.padding(24).frame(width: 460)
  }
}

final class EditingDraft: ObservableObject {
  @Published var markingKind = "dynamic"
  @Published var markingSymbol = "mf"
  @Published var markingText = ""
  @Published var spanKind = "slur"
  @Published var voice = "2"
  @Published var clefSign = "G"
  @Published var clefLine = "2"
  @Published var keyFifths = "0"
  @Published var keyMode = "major"
  @Published var meterBeats = "4"
  @Published var meterUnit = "4"
  @Published var barStyle = "regular"
  @Published var repeatDirection = ""
  @Published var tupletActual = "3"
  @Published var tupletNormal = "2"
  @Published var text = ""
  @Published var title = "Untitled score"
  @Published var instruments = "Piano"
  @Published var bars = 8
  @Published var beats = 4
  @Published var unit = 4
}
