import AppKit
import AVFoundation
import CoreAudioKit

@MainActor final class InstrumentEditor: NSObject, NSWindowDelegate {
  private let window: NSWindow
  private let onClose: () -> Void
  init(controller: NSViewController, name: String, onClose: @escaping () -> Void) {
    self.onClose = onClose
    let size = controller.view.frame.size
    window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: max(900, size.width), height: max(600, size.height)),
      styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
    super.init()
    window.title = name + " — Instrument settings"
    window.contentViewController = controller
    window.isReleasedWhenClosed = false
    window.delegate = self
    window.center()
  }
  func show() { window.makeKeyAndOrderFront(nil) }
  func close() { window.close() }
  func windowWillClose(_ notification: Notification) { onClose() }
}
