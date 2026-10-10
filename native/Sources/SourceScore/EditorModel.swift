import AppKit
import SwiftUI
import UniformTypeIdentifiers

@MainActor final class EditorModel: ObservableObject {
  let core = CoreEngine(), files = FileStore(), audio = AudioRack()
  lazy var engraver = Engraver()
  @Published var summary: Summary?
  @Published var scene: VectorScene?
  @Published var notes: [String: Note] = [:]
  @Published var selection: Set<String> = []
  @Published var page = 0
  @Published var zoom = 0.8
  @Published var partId: String?
  @Published var inspector = true
  @Published var instruments = false
  @Published var diagnostics = false
  @Published var file: FileReference?
  @Published var dirty = false
  @Published var canUndo = false
  @Published var canRedo = false
  @Published var status = "Open a MusicXML score"
  @Published var error: String?
  @Published var loading = false
  @Published var rendering = false
  @Published var playing = false
  @Published var bpm: Double = 100
  @Published var audition = true
  @Published var activeNotes: Set<String> = []
  @Published var pendingPlan: [String: Any]?
  @Published var planDescription = ""
  @Published var measureInput = ""
  @Published var lastEditMilliseconds: Double = 0
  @Published var programOverrides: [String: Int] = [:]
  @Published var noteInput = false
  @Published var inputType = "quarter"
  @Published var inputDots = 0
  @Published var inputGrace = false
  @Published var inputChord = false
  @Published var inputAlter: Int?
  @Published var editTab = "Notes"
  @Published var barPartId: String?
  @Published var barIndex = 0
  @Published var barStaff = 1
  @Published var notationItems: [NotationItem] = []
  @Published var selectedItemId: String?
  @Published var newScoreSheet = false
  private var leadNoteId: String?
  @Published var mixerVisible = false
  @Published var mix: [String: InstrumentMix] = [:]
  @Published var playbackBar = "1"
  @Published var playbackMeasure: Int?
  @Published var followPlayback = true
  @Published var preparingPlayback = false
  private var playbackGeneration = 0
  private var chosenPlaybackMeasure: Int?
  private var viewportHeight: Double = 900
  private var revision = 0, generation = 0, renderTask: Task<Void, Never>?,
    editTail: Task<Void, Never>?, checkTimer: Timer?
  private var renderBusy = false, needsRender = false
  private var pendingEdits = 0
  var hasChangesToProtect: Bool { dirty || pendingEdits > 0 }
  let barsPerPage = 4
  var primary: Note? {
    (leadNoteId.flatMap { selection.contains($0) ? notes[$0] : nil })
      ?? selection.sorted().last.flatMap { notes[$0] }
  }
  var selectedItem: NotationItem? { notationItems.first { $0.id == selectedItemId } }
  var pageCount: Int { max(1, ((summary?.measureCount ?? 0) + barsPerPage - 1) / barsPerPage) }
  var displayName: String { file?.url.lastPathComponent ?? summary?.title ?? "SourceScore" }
  init() {
    audio.outputError = { [weak self] message in DispatchQueue.main.async { self?.error = message }
    }
    checkTimer = Timer.scheduledTimer(withTimeInterval: 10, repeats: true) { [weak self] _ in
      Task { @MainActor in
        guard let self, let file = self.file, !self.loading else { return }
        if await self.files.changed(file) {
          self.status = "File changed externally — reopen or use Save As"
        }
      }
    }
  }
  func openPanel() {
    let panel = NSOpenPanel()
    panel.allowedContentTypes = [UTType(filenameExtension: "musicxml") ?? .xml, .xml]
    panel.canChooseDirectories = false
    panel.allowsMultipleSelection = false
    if panel.runModal() == .OK, let url = panel.url { Task { await open(url) } }
  }
  func allowReplace() async -> Bool {
    await editTail?.value
    guard dirty else { return true }
    let alert = NSAlert()
    alert.messageText = "Save changes to this score?"
    alert.informativeText = "Your unsaved edits will be lost if you discard them."
    alert.addButton(withTitle: "Save")
    alert.addButton(withTitle: "Discard")
    alert.addButton(withTitle: "Cancel")
    let answer = alert.runModal()
    if answer == .alertFirstButtonReturn { return await save() }
    return answer == .alertSecondButtonReturn
  }
  func open(_ url: URL) async {
    guard !loading, await allowReplace() else { return }
    loading = true
    status = "Reading score…"
    stop()
    do {
      let (source, reference) = try await files.open(url)
      try await load(source, reference: reference)
    } catch { self.error = errorMessage(error) }
    loading = false
  }
  func example() {
    Task {
      guard await allowReplace() else { return }
      loading = true
      do {
        try await load(
          String(contentsOf: resource("example", "musicxml"), encoding: .utf8), reference: nil)
      } catch { self.error = errorMessage(error) }
      loading = false
    }
  }
  private func load(_ source: String, reference: FileReference?) async throws {
    let result = try await core.decode(Summary.self, "open", ["source": source])
    generation += 1
    summary = result
    stop()
    file = reference
    dirty = false
    canUndo = false
    canRedo = false
    revision = result.revision
    bpm = result.initialTempo
    notes = [:]
    selection = []
    leadNoteId = nil
    barPartId = result.parts.first?.id
    barIndex = 0
    barStaff = 1
    notationItems = []
    selectedItemId = nil
    page = 0
    scene = nil
    partId = nil
    programOverrides = [:]
    mix = Dictionary(uniqueKeysWithValues: result.parts.map { ($0.id, InstrumentMix()) })
    audio.setMix(mix)
    playbackBar = result.measureLabels.first ?? "1"
    chosenPlaybackMeasure = 0
    status = "\(result.parts.count) instruments · \(result.measureCount) measures"
    updateTitle()
    scheduleRender()
  }
  func select(_ id: String, extend: Bool = false, range: Bool = false) {
    if extend {
      if selection.contains(id) { selection.remove(id) } else { selection.insert(id) }
    } else if range, let current = primary, let next = notes[id], current.partId == next.partId {
      let list = notes.values.filter { $0.partId == current.partId }.sorted {
        ($0.measureIndex, $0.index) < ($1.measureIndex, $1.index)
      }
      if let a = list.firstIndex(where: { $0.id == current.id }),
        let b = list.firstIndex(where: { $0.id == id })
      {
        selection.formUnion(list[min(a, b)...max(a, b)].map { $0.id })
      }
    } else {
      selection = [id]
    }
    leadNoteId = id
    if let note = notes[id], !playing {
      barPartId = note.partId
      barIndex = note.measureIndex
      barStaff = note.staff
      if editTab != "Notes" { refreshItems() }
      setPlaybackStart(note.measureIndex)
      if audition, let part = effectivePart(note.partId) { audio.preview(note, part: part) }
    }
  }
  func edit(_ method: String, _ args: [String: Any]) {
    guard summary != nil, !loading else { return }
    stop()
    let previous = editTail
    pendingEdits += 1
    editTail = Task {
      defer { pendingEdits -= 1 }
      await previous?.value
      let started = ProcessInfo.processInfo.systemUptime
      do {
        var operationArgs = args
        operationArgs["selectionIds"] = Array(selection)
        if method == "input", args["followCursor"] as? Bool == true, let current = primary {
          operationArgs["id"] = current.id
        }
        let value = try await core.decode(EditState.self, method, operationArgs)
        if value.structural == true {
          notes = [:]
          selection = []
          leadNoteId = nil
        }
        for note in value.notes { notes[note.id] = note }
        if let ids = value.selection, !ids.isEmpty {
          selection = Set(ids)
          leadNoteId = ids.last
        }
        if let diagnostics = value.diagnostics { summary?.diagnostics = diagnostics }
        if let count = value.measureCount { summary?.measureCount = count }
        if let count = value.eventCount { summary?.eventCount = count }
        if let parts = value.parts { summary?.parts = parts }
        if let labels = value.measureLabels { summary?.measureLabels = labels }
        if let current = primary {
          barPartId = current.partId
          barIndex = current.measureIndex
          barStaff = current.staff
        } else {
          barIndex = min(barIndex, max(0, (summary?.measureCount ?? 1) - 1))
        }
        page = min(page, max(0, ((summary?.measureCount ?? 1) - 1) / barsPerPage))
        dirty = value.dirty
        canUndo = value.canUndo
        canRedo = value.canRedo
        revision = value.revision
        status = value.label
        lastEditMilliseconds = (ProcessInfo.processInfo.systemUptime - started) * 1000
        updateTitle()
        if audition, let note = primary, let part = effectivePart(note.partId) {
          audio.preview(note, part: part)
        }
        scheduleRender()
        if editTab != "Notes" { refreshItems() }
        if method == "input", noteInput, !inputChord, !inputGrace, args["chord"] as? Bool != true,
          let id = value.selection?.first
        {
          let next = try await core.decode(Note.self, "input-next", ["id": id])
          notes[next.id] = next
          selection = [next.id]
          leadNoteId = next.id
          barPartId = next.partId
          barIndex = next.measureIndex
          barStaff = next.staff
          if page != next.measureIndex / barsPerPage {
            page = next.measureIndex / barsPerPage
            scheduleRender()
          }
        }
      } catch { self.error = errorMessage(error) }
    }
  }
  func undo() { edit("undo", ["ids": Array(selection)]) }
  func redo() { edit("redo", ["ids": Array(selection)]) }
  func deleteSelection() {
    if let id = selectedItemId, editTab == "Notation" {
      edit("delete-item", ["id": id])
      selectedItemId = nil
    } else if !selection.isEmpty {
      edit("delete", ["ids": Array(selection)])
    }
  }
  func copySelection(cut: Bool = false) {
    if let text = NSApp.keyWindow?.firstResponder as? NSTextView {
      if cut { text.cut(nil) } else { text.copy(nil) }
      return
    }
    let ids = Array(selection)
    Task {
      await editTail?.value
      do {
        let payload = try await core.decode(String.self, "copy", ["ids": ids])
        let type = NSPasteboard.PasteboardType("local.sourcescore.notes")
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(payload, forType: type)
        if cut { edit("delete", ["ids": ids]) }
      } catch { self.error = errorMessage(error) }
    }
  }
  func pasteSelection() {
    if let text = NSApp.keyWindow?.firstResponder as? NSTextView {
      text.paste(nil)
      return
    }
    guard let note = primary,
      let payload = NSPasteboard.general.string(
        forType: NSPasteboard.PasteboardType("local.sourcescore.notes"))
    else {
      error = "Copy a SourceScore passage, then select a destination rest."
      return
    }
    edit("paste", ["id": note.id, "payload": payload])
  }
  func selectBar(_ target: BarTarget) {
    selection = []
    leadNoteId = nil
    barPartId = target.partId
    barIndex = target.measureIndex
    barStaff = target.staff
    inspector = true
    editTab = "Bar"
    setPlaybackStart(target.measureIndex)
    refreshItems()
  }
  func refreshItems() {
    guard let part = barPartId else { return }
    let index = barIndex
    let requestedRevision = revision
    Task {
      do {
        let items = try await core.decode(
          [NotationItem].self, "items", ["partId": part, "measureIndex": index])
        guard barPartId == part, barIndex == index, revision == requestedRevision else { return }
        notationItems = items
        if let id = selectedItemId, !items.contains(where: { $0.id == id }) { selectedItemId = nil }
      } catch { self.error = errorMessage(error) }
    }
  }
  func enter(_ letter: String?, chord: Bool = false) {
    guard let note = primary else {
      error = "Select a rest or note. Click a bar to add a voice if it is empty."
      return
    }
    var args: [String: Any] = [
      "id": note.id, "type": inputType, "dots": inputDots, "chord": chord || inputChord,
      "grace": inputGrace, "followCursor": noteInput,
    ]
    if let letter {
      args["letter"] = letter
      args["alter"] = inputAlter as Any? ?? NSNull()
    }
    edit("input", args)
  }
  func addMarking(_ kind: String, _ symbol: String = "", _ text: String = "") {
    guard let note = primary else {
      error = "Select a note or rest for the marking."
      return
    }
    edit("marking", ["id": note.id, "kind": kind, "symbol": symbol, "text": text])
    editTab = "Notation"
  }
  func addSpan(_ kind: String) {
    edit("span", ["ids": Array(selection), "kind": kind])
    editTab = "Notation"
  }
  func setBar(_ kind: String, _ values: [String: String]) {
    guard let part = barPartId else { return }
    edit(
      "signature",
      ["partId": part, "index": barIndex, "staff": barStaff, "kind": kind, "values": values])
  }
  func createVoice(_ voice: String) {
    guard let part = barPartId else { return }
    edit(
      "create-voice", ["partId": part, "measureIndex": barIndex, "staff": barStaff, "voice": voice])
    editTab = "Notes"
  }
  func createScore(title: String, instruments: [String], bars: Int, beats: Int, unit: Int) {
    Task {
      guard await allowReplace() else { return }
      do {
        let source = try await core.decode(
          String.self, "new-score",
          ["title": title, "instruments": instruments, "bars": bars, "beats": beats, "unit": unit])
        try await load(source, reference: nil)
        newScoreSheet = false
      } catch { self.error = errorMessage(error) }
    }
  }
  func duration(_ type: String, _ dots: Int) {
    guard let note = primary else { return }
    edit("resize", ["id": note.id, "type": type, "dots": dots])
  }
  func legacyDurationPreview(_ type: String, _ dots: Int) {
    guard let note = primary else { return }
    Task {
      await editTail?.value
      do {
        let data = try await core.call(
          "plan-duration", ["id": note.id, "type": type, "dots": dots])
        pendingPlan = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        planDescription = pendingPlan?["description"] as? String ?? ""
      } catch { self.error = errorMessage(error) }
    }
  }
  func applyDuration() {
    guard let plan = pendingPlan else { return }
    pendingPlan = nil
    edit("duration", ["plan": plan])
  }
  func adjacent(_ delta: Int) {
    Task {
      do {
        let note = try await core.decode(
          Note.self, "adjacent", ["id": primary?.id as Any? ?? NSNull(), "delta": delta])
        notes[note.id] = note
        selection = [note.id]
        if !playing { setPlaybackStart(note.measureIndex) }
        let next = note.measureIndex / barsPerPage
        if page != next {
          page = next
          scheduleRender()
        }
      } catch { self.error = errorMessage(error) }
    }
  }
  func flip(_ delta: Int) {
    let next = max(0, min(pageCount - 1, page + delta))
    guard next != page else { return }
    page = next
    selection = []
    if !playing { setPlaybackStart(next * barsPerPage) }
    scheduleRender()
  }
  func go() {
    guard let summary else { return }
    let index =
      summary.measureLabels.firstIndex(of: measureInput) ?? (Int(measureInput).map { $0 - 1 } ?? -1)
    guard index >= 0 && index < summary.measureCount else {
      error = "Measure not found."
      return
    }
    page = index / barsPerPage
    setPlaybackStart(index)
    selection = []
    measureInput = ""
    scheduleRender()
  }
  func showPart(_ id: String?) {
    partId = id
    selection = []
    scheduleRender()
  }
  func scheduleRender() {
    renderTask?.cancel()
    renderTask = Task {
      try? await Task.sleep(nanoseconds: 35_000_000)
      guard !Task.isCancelled else { return }
      await renderPage()
    }
  }
  func setViewportHeight(_ height: Double) {
    let next = max(200, height / zoom)
    guard abs(next - viewportHeight) > 15 else { return }
    viewportHeight = next
    scheduleRender()
  }
  private func renderPage() async {
    if renderBusy {
      needsRender = true
      return
    }
    renderBusy = true
    rendering = true
    let token = generation
    let currentPage = page
    let wanted = revision
    do {
      var args: [String: Any] = ["start": page * barsPerPage, "count": barsPerPage]
      if let partId { args["partId"] = partId }
      let payload = try await core.call("page", args)
      let (scene, pageNotes) = try await engraver.render(payload, height: viewportHeight)
      if generation == token && page == currentPage && revision == wanted {
        self.scene = scene
        for note in pageNotes { notes[note.id] = note }
        status = "Page \(page+1) of \(pageCount) · \(scene.targets.count) selectable events"
      } else {
        needsRender = true
      }
    } catch { if generation == token { self.error = errorMessage(error) } }
    renderBusy = false
    rendering = false
    if needsRender {
      needsRender = false
      scheduleRender()
    }
  }
  @discardableResult func save(as saveAs: Bool = false) async -> Bool {
    guard summary != nil, !loading else { return false }
    await editTail?.value
    loading = true
    defer { loading = false }
    do {
      _ = try await core.call("validate-save")
      let source = try await core.decode(String.self, "source")
      var target = file
      if saveAs || target == nil {
        let panel = NSSavePanel()
        panel.allowedContentTypes = [UTType(filenameExtension: "musicxml") ?? .xml, .xml]
        panel.nameFieldStringValue = file?.url.lastPathComponent ?? "Score.musicxml"
        panel.directoryURL = file?.url.deletingLastPathComponent()
        guard panel.runModal() == .OK, let url = panel.url else { return false }
        let grant = try await files.target(url)
        if let original = file, grant.url == original.url, grant.hash != original.hash {
          throw EditorError.message(
            "The original changed externally. Save As must use a different destination.")
        }
        target = grant
      }
      let result = try await files.save(source, to: target!)
      file = result.reference
      let state = try await core.decode(EditState.self, "mark-saved")
      dirty = state.dirty
      status =
        result.unchanged
        ? "Saved — unchanged bytes" : result.backup != nil ? "Saved — backup created" : "Saved"
      updateTitle()
      return true
    } catch {
      self.error = errorMessage(error)
      return false
    }
  }
  func effectivePart(_ id: String) -> Part? {
    guard var p = summary?.parts.first(where: { $0.id == id }) else { return nil }
    p.program = programOverrides[id] ?? p.program
    return p
  }
  func togglePlayback() {
    if playing || preparingPlayback {
      stop()
      return
    }
    playFromBar()
  }
  func setPlaybackStart(_ index: Int) {
    guard let labels = summary?.measureLabels, labels.indices.contains(index) else { return }
    chosenPlaybackMeasure = index
    playbackBar = labels[index]
  }
  func setPlaybackBar(_ text: String) {
    playbackBar = text
    chosenPlaybackMeasure = nil
  }
  func setMix(_ id: String, _ value: InstrumentMix) {
    mix[id] = value
    audio.setMix(mix)
  }
  func setProgram(_ id: String, _ program: Int) {
    programOverrides[id] = program
    if let part = effectivePart(id) { audio.changeSound(part) }
  }
  func soloOnly(_ id: String) {
    for key in mix.keys {
      mix[key]?.solo = key == id
      if key == id { mix[key]?.mute = false }
    }
    audio.setMix(mix)
  }
  func resetMix() {
    mix = Dictionary(uniqueKeysWithValues: (summary?.parts ?? []).map { ($0.id, InstrumentMix()) })
    audio.setMix(mix)
  }
  func playFromBar() {
    guard let summary, !loading else { return }
    guard bpm.isFinite, bpm > 0, bpm <= 1000 else {
      error = "Choose a playback tempo between 1 and 1000 BPM."
      return
    }
    let start: Int
    do {
      start =
        try chosenPlaybackMeasure
        ?? PlaybackTimeline.resolve(playbackBar, labels: summary.measureLabels)
    } catch {
      self.error = errorMessage(error)
      return
    }
    stop()
    let token = playbackGeneration
    preparingPlayback = true
    Task {
      await editTail?.value
      do {
        var arrangement = try await core.decode(Playback.self, "playback")
        guard token == playbackGeneration else { return }
        arrangement.parts = arrangement.parts.map { effectivePart($0.id) ?? $0 }
        guard arrangement.measureBeats.indices.contains(start) else {
          throw EditorError.message("That bar is not available for playback.")
        }
        let timeline = PlaybackTimeline(starts: arrangement.measureBeats)
        preparingPlayback = false
        playing = true
        playbackMeasure = start
        if followPlayback && page != start / barsPerPage {
          page = start / barsPerPage
          scheduleRender()
        }
        audio.setMix(mix)
        audio.play(
          arrangement,
          startBeat: arrangement.measureBeats[start],
          bpm: bpm,
          progress: { [weak self] beat, ids in
            DispatchQueue.main.async {
              guard let self, token == self.playbackGeneration, self.playing else { return }
              if self.activeNotes != ids { self.activeNotes = ids }
              let index = timeline.measure(at: beat)
              if self.playbackMeasure != index { self.playbackMeasure = index }
              if self.followPlayback && self.page != index / self.barsPerPage {
                self.page = index / self.barsPerPage
                self.selection = []
                self.scheduleRender()
              }
            }
          },
          finished: { [weak self] in
            DispatchQueue.main.async {
              guard let self, token == self.playbackGeneration else { return }
              self.playing = false
              self.activeNotes = []
              self.playbackMeasure = nil
            }
          })
      } catch {
        if token == playbackGeneration {
          preparingPlayback = false
          self.error = errorMessage(error)
        }
      }
    }
  }
  func stop() {
    playbackGeneration += 1
    audio.stop()
    playing = false
    preparingPlayback = false
    playbackMeasure = nil
    activeNotes = []
  }
  func soundBank() {
    let panel = NSOpenPanel()
    panel.allowedContentTypes = [
      UTType(filenameExtension: "sf2") ?? .data, UTType(filenameExtension: "dls") ?? .data,
    ]
    if panel.runModal() == .OK, let url = panel.url {
      stop()
      audio.queue.async { [audio] in
        audio.bank = url
        audio.programs.removeAll()
      }
      status = "Sound bank: \(url.lastPathComponent)"
    }
  }
  func updateTitle() {
    NSApp.windows.first?.title = displayName + (dirty ? " • Edited" : "")
    NSApp.windows.first?.isDocumentEdited = dirty
  }
  private func errorMessage(_ error: Error) -> String {
    (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
  }
}
