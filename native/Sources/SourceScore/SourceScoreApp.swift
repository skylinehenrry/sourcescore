import AppKit
import Darwin
import SwiftUI

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate {
  weak var model: EditorModel?
  private var reopenObserver: NSObjectProtocol?
  private var pendingFiles: [String] = []
  private weak var editorWindow: NSWindow?
  private var openingEditor = false
  var openEditorWindow: (() -> Void)?
  func applicationDidFinishLaunching(_ notification: Notification) {
    if let url = Bundle.main.url(forResource: "AppIcon", withExtension: "icns"),
      let icon = NSImage(contentsOf: url) { NSApp.applicationIconImage = icon }
    reopenObserver = DistributedNotificationCenter.default().addObserver(
      forName: ApplicationInstance.reopenNotification, object: nil, queue: .main
    ) { [weak self] notification in
      Task { @MainActor in
        self?.bringEditorForward()
        if let files = notification.userInfo?["files"] as? [String] { self?.open(files) }
      }
    }
  }
  func registerEditorWindow(_ window: NSWindow) {
    editorWindow = window
    openingEditor = false
    window.delegate = self
  }
  /// Finder and Dock reopen the running app instead of starting another process.
  func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
    return !bringEditorForward()
  }
  @discardableResult private func bringEditorForward() -> Bool {
    NSApp.unhideWithoutActivation()
    NSApp.activate(ignoringOtherApps: true)
    if let window = editorWindow {
      if window.isMiniaturized { window.deminiaturize(nil) }
      window.makeKeyAndOrderFront(nil)
      window.orderFrontRegardless()
      return true
    }
    if let openEditorWindow {
      if !openingEditor { openingEditor = true; openEditorWindow() }
      return true
    }
    return false
  }
  func windowWillClose(_ notification: Notification) {
    if let window = notification.object as? NSWindow, window === editorWindow { editorWindow = nil }
  }
  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
  func attach(_ model: EditorModel) {
    self.model = model
    DispatchQueue.main.async { model.updateTitle() }
    let files = pendingFiles
    pendingFiles = []
    open(files)
  }
  private func open(_ files: [String]) {
    guard let filename = files.first else { return }
    guard let model else { pendingFiles = files; return }
    Task { await model.open(URL(fileURLWithPath: filename)) }
  }
  func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
    guard let model, model.hasChangesToProtect || model.hasInstrumentSettings else { return .terminateNow }
    Task {
      var accepted = await model.allowReplace()
      if accepted { accepted = await model.finishInstrumentSettings() }
      NSApp.reply(toApplicationShouldTerminate: accepted)
    }
    return .terminateLater
  }
  func application(_ sender: NSApplication, openFiles filenames: [String]) {
    open(filenames)
    sender.reply(toOpenOrPrint: .success)
  }
  func windowShouldClose(_ sender: NSWindow) -> Bool {
    guard let model else { return true }
    if !model.hasChangesToProtect {
      model.stop()
      return true
    }
    Task {
      if await model.allowReplace() {
        model.stop()
        if sender === self.editorWindow { self.editorWindow = nil }
        sender.delegate = nil
        sender.close()
      }
    }
    return false
  }
}
@main struct SourceScoreApp: App {
  @NSApplicationDelegateAdaptor(AppDelegate.self) var delegate
  @StateObject var model: EditorModel
  init() {
    do {
      guard try ApplicationInstance.shared.acquireOrActivateExisting() else { Darwin.exit(0) }
    } catch {
      let alert = NSAlert()
      alert.messageText = "SourceScore could not start"
      alert.informativeText = "Could not reserve the app session: \(error.localizedDescription)"
      alert.runModal()
      Darwin.exit(1)
    }
    _model = StateObject(wrappedValue: EditorModel())
  }
  var body: some Scene {
    WindowGroup(model.displayName + (model.dirty ? " • Edited" : ""), id: "editor") {
      EditorHost(model: model, delegate: delegate).frame(minWidth: 1000, minHeight: 680).preferredColorScheme(.light)
        .tint(.black)
        .onAppear {
          if model.summary == nil, let path = CommandLine.arguments.dropFirst().first(where: {
            $0.lowercased().hasSuffix(".musicxml") || $0.lowercased().hasSuffix(".xml")
          }) {
            Task { await model.open(URL(fileURLWithPath: path)) }
          }
        }
    }.defaultSize(width: 1360, height: 900).commands {
      CommandGroup(replacing: .newItem) {
        Button("New Score…") { model.newScoreSheet = true }.keyboardShortcut("n")
        Button("Open…", action: model.openPanel).keyboardShortcut("o")
        Button("Open Example", action: model.example)
      }
      CommandGroup(replacing: .saveItem) {
        Button("Save") { Task { await model.save() } }.keyboardShortcut("s").disabled(
          model.summary == nil)
        Button("Save As…") { Task { await model.save(as: true) } }.keyboardShortcut(
          "s", modifiers: [.command, .shift]
        ).disabled(model.summary == nil)
      }
      CommandGroup(replacing: .undoRedo) {
        Button("Undo", action: model.undoCommand).keyboardShortcut("z")
        Button("Redo", action: model.redoCommand).keyboardShortcut("z", modifiers: [.command, .shift])
      }
      CommandGroup(replacing: .pasteboard) {
        Button("Cut") { model.copySelection(cut: true) }.keyboardShortcut("x")
        Button("Copy") { model.copySelection() }.keyboardShortcut("c")
        Button("Paste", action: model.pasteSelection).keyboardShortcut("v")
        Button("Select All", action: model.selectAll).keyboardShortcut("a")
      }
      CommandMenu("Navigate") {
        Button("Previous Page") { model.flip(-1) }.keyboardShortcut(.leftArrow, modifiers: .command)
          .disabled(model.page == 0)
        Button("Next Page") { model.flip(1) }.keyboardShortcut(.rightArrow, modifiers: .command)
          .disabled(model.page + 1 >= model.pageCount)
      }
      CommandMenu("Edit Music") {
        Toggle("Note Input", isOn: $model.noteInput)
        Button("Delete Notes / Marking", action: model.deleteSelection)
      }
      CommandMenu("Playback") {
        Button(model.playing ? "Stop" : "Play", action: model.togglePlayback)
        Toggle("Audition Selected and Edited Notes", isOn: $model.audition)
        Toggle("Follow Playback", isOn: $model.followPlayback)
        Toggle("Mixer", isOn: $model.mixerVisible).keyboardShortcut(
          KeyEquivalent(Character(UnicodeScalar(NSF10FunctionKey)!)), modifiers: [])
        Button("Choose SoundFont…", action: model.soundBank)
        Toggle("Use Berlin Free Orchestra", isOn: Binding(get: { model.berlinEnabled }, set: model.useBerlin))
          .disabled(model.soundLibrary.patches.isEmpty)
        Button("Refresh Installed Sounds", action: model.refreshSounds)
        Button("Import SINE Preset…", action: model.importSinePreset)
      }
    }
  }
}
private struct EditorHost: View {
  @ObservedObject var model: EditorModel
  let delegate: AppDelegate
  @Environment(\.openWindow) private var openWindow
  var body: some View {
    EditorWindow(model: model).background(EditorWindowReference(delegate: delegate))
      .onAppear {
        delegate.openEditorWindow = { [openWindow] in openWindow(id: "editor") }
        delegate.attach(model)
      }
  }
}
private struct EditorWindowReference: NSViewRepresentable {
  let delegate: AppDelegate
  func makeNSView(context: Context) -> ReferenceView { ReferenceView(delegate: delegate) }
  func updateNSView(_ view: ReferenceView, context: Context) {}
  final class ReferenceView: NSView {
    weak var appDelegate: AppDelegate?
    init(delegate: AppDelegate) { appDelegate = delegate; super.init(frame: .zero) }
    required init?(coder: NSCoder) { return nil }
    override func viewDidMoveToWindow() {
      super.viewDidMoveToWindow()
      if let window { appDelegate?.registerEditorWindow(window) }
    }
  }
}
struct EditorWindow: View {
  @ObservedObject var model: EditorModel
  var body: some View {
    VStack(spacing: 0) {
      HStack(spacing: 16) {
        if let summary = model.summary {
          Text(summary.title).font(.headline).lineLimit(1)
          Spacer()
          Button {
            model.flip(-1)
          } label: {
            Image(systemName: "chevron.left")
          }.disabled(model.page == 0).help("Previous page · Command–Left")
          Text("\(model.page+1) / \(model.pageCount)").monospacedDigit().font(.caption)
          Button {
            model.flip(1)
          } label: {
            Image(systemName: "chevron.right")
          }.disabled(model.page + 1 >= model.pageCount).help("Next page · Command–Right")
          TextField("Measure", text: $model.measureInput).frame(width: 75).onSubmit(model.go)
          Button("Go", action: model.go)
        } else {
          Text("SourceScore").font(.headline)
          Spacer()
        }
      }.padding(.horizontal, 20).padding(.vertical, 12)
      Divider()
      if model.summary != nil {
        NoteEntryBar(model: model)
        Divider()
      }
      HStack(spacing: 0) {
        if model.instruments, let summary = model.summary {
          VStack(alignment: .leading, spacing: 8) {
            Button("All instruments") { model.showPart(nil) }.buttonStyle(.plain).fontWeight(
              model.partId == nil ? .semibold : .regular)
            Divider()
            ScrollView {
              VStack(alignment: .leading, spacing: 12) {
                ForEach(summary.parts) { part in
                  Button {
                    model.showPart(part.id)
                  } label: {
                    Text(part.name).frame(maxWidth: .infinity, alignment: .leading).fontWeight(
                      model.partId == part.id ? .semibold : .regular)
                  }.buttonStyle(.plain)
                }
              }
            }
          }.padding(16).frame(width: 175)
          Divider()
        }
        if model.summary != nil {
          ScoreCanvas(model: model).frame(maxWidth: .infinity, maxHeight: .infinity).overlay(alignment: .topTrailing) {
            if model.rendering { ProgressView().controlSize(.small).padding(12) }
          }
        } else {
          VStack(spacing: 18) {
            Image(systemName: "music.note").font(.system(size: 42, weight: .light))
            Text("SourceScore").font(.title2)
            HStack(spacing: 16) {
              Button("New score…") { model.newScoreSheet = true }.keyboardShortcut("n")
              Button("Open…", action: model.openPanel).keyboardShortcut("o")
            }
            Button("Orchestral example", action: model.example).buttonStyle(.plain).foregroundStyle(
              .secondary)
          }.frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        if model.inspector, model.summary != nil {
          Divider()
          EditingPanel(model: model)
        }
      }.background(.white)
      if model.mixerVisible, let summary = model.summary {
        Divider()
        InstrumentMixer(model: model, parts: summary.parts)
      }
      if model.diagnostics, let summary = model.summary {
        Divider()
        ScrollView {
          VStack(alignment: .leading, spacing: 10) {
            if summary.diagnostics.isEmpty {
              Text("No timing issues detected").foregroundStyle(.secondary)
            }
            ForEach(summary.diagnostics) { d in
              Button {
                model.page = d.measureIndex / model.barsPerPage
                model.selection = d.noteId.map { [$0] } ?? []
                model.scheduleRender()
              } label: {
                HStack {
                  Text(d.instrument).frame(width: 150, alignment: .leading)
                  Text("m. \(d.measure)").frame(width: 80, alignment: .leading)
                  Text(d.message)
                  Spacer()
                  if let actual = d.actual {
                    Text("\(actual) / \(d.expected ?? "—")").monospacedDigit()
                  }
                }.font(.caption)
              }.buttonStyle(.plain)
            }
          }.padding(14)
        }.frame(maxHeight: 150)
      }
      Divider()
      HStack {
        if model.loading { ProgressView().controlSize(.mini) }
        Text(model.status).lineLimit(1)
        Spacer()
        if let index = model.playbackMeasure, let labels = model.summary?.measureLabels,
          labels.indices.contains(index)
        {
          Text("Playing bar \(labels[index])").monospacedDigit()
        }
        if model.lastEditMilliseconds > 0 {
          Text(String(format: "%.0f ms", model.lastEditMilliseconds)).foregroundStyle(.tertiary)
        }
        if model.dirty { Text("Edited") }
      }.font(.caption).foregroundStyle(.secondary).padding(.horizontal, 16).padding(.vertical, 7)
    }.background(.white).sheet(isPresented: $model.newScoreSheet) { NewScoreSheet(model: model) }
      .toolbar {
        ToolbarItemGroup(placement: .navigation) {
          Button(action: model.openPanel) { Image(systemName: "folder") }.help("Open")
          Button {
            Task { await model.save() }
          } label: {
            Image(systemName: "square.and.arrow.down")
          }.disabled(model.summary == nil).help("Save")
          Button(action: model.undo) { Image(systemName: "arrow.uturn.backward") }.disabled(
            !model.canUndo)
          Button(action: model.redo) { Image(systemName: "arrow.uturn.forward") }.disabled(
            !model.canRedo)
        }
        ToolbarItemGroup(placement: .principal) {
          Button(action: model.togglePlayback) {
            Image(systemName: model.playing || model.preparingPlayback ? "stop.fill" : "play.fill")
          }.disabled(model.summary == nil).help(
            model.playing || model.preparingPlayback ? "Stop playback" : "Play from selected bar")
          if model.preparingPlayback { ProgressView().controlSize(.small).help("Loading instrument sounds") }
          Text("From bar").font(.caption).foregroundStyle(.secondary)
          TextField("Bar", text: Binding(get: { model.playbackBar }, set: model.setPlaybackBar))
            .frame(width: 45).accessibilityLabel("Play from bar").onSubmit(model.playFromBar)
          TextField("BPM", value: $model.bpm, format: .number).frame(width: 42)
          Text("BPM").font(.caption).foregroundStyle(.secondary)
          Toggle(isOn: $model.audition) { Image(systemName: "speaker.wave.2") }.toggleStyle(.button)
            .help("Audition notes")
          Button {
            model.mixerVisible.toggle()
          } label: {
            Image(systemName: "slider.horizontal.3")
          }
          .help("Mixer · Mute or solo instruments").accessibilityLabel("Mixer")
          Toggle(isOn: $model.followPlayback) {
            Image(systemName: "rectangle.and.arrow.up.right.and.arrow.down.left")
          }
          .toggleStyle(.button).help("Follow playback pages").accessibilityLabel("Follow playback")
        }
        ToolbarItemGroup(placement: .automatic) {
          Button {
            model.zoom = max(0.35, model.zoom - 0.1)
          } label: {
            Image(systemName: "minus.magnifyingglass")
          }
          Text("\(Int(model.zoom*100))%").font(.caption)
          Button {
            model.zoom = min(2, model.zoom + 0.1)
          } label: {
            Image(systemName: "plus.magnifyingglass")
          }
          Button {
            model.instruments.toggle()
          } label: {
            Image(systemName: "sidebar.left")
          }
          Button {
            model.inspector.toggle()
          } label: {
            Image(systemName: "sidebar.right")
          }
          Button {
            model.diagnostics.toggle()
          } label: {
            Image(systemName: "exclamationmark.circle")
          }
        }
      }.alert(
        "Operation could not be completed",
        isPresented: Binding(get: { model.error != nil }, set: { if !$0 { model.error = nil } })
      ) {
        Button("OK") { model.error = nil }
      } message: {
        Text(model.error ?? "")
      }
      .sheet(
        isPresented: Binding(
          get: { model.pendingPlan != nil }, set: { if !$0 { model.pendingPlan = nil } })
      ) {
        VStack(alignment: .leading, spacing: 20) {
          Text("Keep the measure balanced").font(.headline)
          Text(model.planDescription)
          HStack {
            Spacer()
            Button("Cancel") { model.pendingPlan = nil }
            Button("Apply", action: model.applyDuration).keyboardShortcut(.defaultAction)
          }
        }.padding(24).frame(width: 440)
      }
  }
  static let sounds = [
    (0, "Piano"), (9, "Glockenspiel"), (40, "Violin"), (41, "Viola"), (42, "Cello"),
    (43, "Double bass"), (46, "Harp"), (47, "Timpani"), (48, "Strings"), (56, "Trumpet"),
    (57, "Trombone"), (58, "Tuba"), (60, "Horn"), (68, "Oboe"), (70, "Bassoon"), (71, "Clarinet"),
    (72, "Piccolo"), (73, "Flute"),
  ]
}

struct InstrumentMixer: View {
  @ObservedObject var model: EditorModel
  var parts: [Part]
  var body: some View {
    VStack(spacing: 8) {
      HStack {
        Text("Mixer").font(.headline)
        if model.berlinEnabled { Text("Berlin Free Orchestra").font(.caption).foregroundStyle(.secondary) }
        Spacer()
        Button("Reset", action: model.resetMix).buttonStyle(.plain).font(.caption)
        Button {
          model.mixerVisible = false
        } label: {
          Image(systemName: "xmark")
        }
        .buttonStyle(.plain).help("Close mixer")
      }.padding(.horizontal, 16).padding(.top, 10)
      ScrollView(.horizontal) {
        HStack(alignment: .top, spacing: 0) {
          ForEach(parts) { part in
            VStack(spacing: 8) {
              Text(part.name).font(.caption).fontWeight(.medium).multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
              Picker(
                "Sound",
                selection: Binding(
                  get: { model.soundChoice(part) },
                  set: { model.selectSound(part, $0) })
              ) {
                if !model.soundLibrary.patches.isEmpty {
                  Section("Berlin Free Orchestra") {
                    ForEach(model.soundLibrary.patches) { Text($0.name).tag($0.id) }
                  }
                }
                Section("Built-in sounds") {
                  ForEach(EditorWindow.sounds, id: \.0) { Text($0.1).tag("apple:\($0.0)") }
                  if !EditorWindow.sounds.contains(where: { $0.0 == part.program }) {
                    Text("Original sound").tag("apple:\(part.program)")
                  }
                }
              }.labelsHidden().controlSize(.small).accessibilityLabel("Sound for \(part.name)")
              if model.chosenPatch(part) != nil {
                Button("Instrument settings…") { model.instrumentSettings(part) }
                  .buttonStyle(.plain).font(.caption2)
              } else {
                Text("Built-in sound").font(.caption2).foregroundStyle(.secondary)
              }
              HStack {
                Toggle("M", isOn: binding(part.id, \.mute)).toggleStyle(.button).help(
                  "Mute \(part.name)"
                ).accessibilityLabel("Mute \(part.name)")
                Toggle("S", isOn: binding(part.id, \.solo)).toggleStyle(.button).help(
                  "Solo \(part.name)"
                ).accessibilityLabel("Solo \(part.name)")
              }
              Slider(value: binding(part.id, \.volume), in: 0...1).accessibilityLabel(
                "Volume for \(part.name)")
              Text("\(Int((model.mix[part.id]?.volume ?? 0.8)*100))%").font(.caption2)
                .monospacedDigit().foregroundStyle(.secondary)
              Slider(value: binding(part.id, \.pan), in: -1...1).accessibilityLabel(
                "Pan for \(part.name)")
            }.padding(.horizontal, 14).padding(.bottom, 12).frame(width: 210)
            Divider()
          }
        }.padding(.horizontal, 6)
      }
    }.background(.white).frame(maxHeight: 245)
  }
  private func binding<T>(_ id: String, _ path: WritableKeyPath<InstrumentMix, T>) -> Binding<T> {
    Binding(
      get: { (model.mix[id] ?? InstrumentMix())[keyPath: path] },
      set: { next in
        var value = model.mix[id] ?? InstrumentMix()
        value[keyPath: path] = next
        model.setMix(id, value)
      })
  }
}
