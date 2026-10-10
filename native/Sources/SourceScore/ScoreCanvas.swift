import AppKit
import SwiftUI

struct ScoreCanvas: NSViewRepresentable {
  @ObservedObject var model: EditorModel
  func makeNSView(context: Context) -> NSScrollView {
    let scroll = NSScrollView()
    scroll.hasVerticalScroller = true
    scroll.hasHorizontalScroller = true
    scroll.drawsBackground = true
    scroll.backgroundColor = .white
    let canvas = CanvasView()
    canvas.model = model
    scroll.documentView = canvas
    return scroll
  }
  func updateNSView(_ scroll: NSScrollView, context: Context) {
    let canvas = scroll.documentView as! CanvasView
    canvas.model = model
    let oldPage = canvas.page
    canvas.page = model.page
    canvas.frame.size = CGSize(
      width: max(scroll.contentSize.width, (model.scene?.width ?? 1000) * model.zoom),
      height: max(scroll.contentSize.height, (model.scene?.height ?? 1000) * model.zoom))
    canvas.needsDisplay = true
    canvas.updateAccessibility()
    if oldPage != model.page { canvas.scroll(.zero) }
  }
}
final class CanvasView: NSView {
  weak var model: EditorModel?
  var page = -1
  private var drag: (id: String, y: CGFloat)?
  override var isFlipped: Bool { true }
  override var acceptsFirstResponder: Bool { true }
  func updateAccessibility() {
    guard let model, let scene = model.scene else { return }
    setAccessibilityElement(true)
    setAccessibilityRole(.group)
    setAccessibilityLabel("Engraved score")
    let elements = scene.targets.map { target -> NoteAccessibility in
      let element = NoteAccessibility()
      element.canvas = self
      element.noteId = target.id
      element.setAccessibilityParent(self)
      element.setAccessibilityRole(.button)
      element.setAccessibilityEnabled(true)
      let note = model.notes[target.id]
      let part = model.summary?.parts.first(where: { $0.id == target.partId })
      element.setAccessibilityLabel(
        "\(note?.label ?? "Note"), \(part?.name ?? target.partId), measure \(note?.measureNumber ?? ""), staff \(note?.staff ?? 1)"
      )
      let rect = CGRect(
        x: target.left * model.zoom, y: target.top * model.zoom, width: target.width * model.zoom,
        height: target.height * model.zoom)
      if let window = window {
        element.setAccessibilityFrame(window.convertToScreen(convert(rect, to: nil)))
      }
      element.setAccessibilityValue(model.selection.contains(target.id) ? "Selected" : "")
      return element
    }
    setAccessibilityChildren(elements)
  }
  override func draw(_ dirtyRect: NSRect) {
    NSColor.white.setFill()
    dirtyRect.fill()
    guard let model, let scene = model.scene, let c = NSGraphicsContext.current?.cgContext else {
      return
    }
    let zoom = model.zoom
    c.saveGState()
    c.scaleBy(x: zoom, y: zoom)
    let sx = scene.width / scene.viewBox.width
    let sy = scene.height / scene.viewBox.height
    for mark in scene.marks {
      c.saveGState()
      if let owner = mark.style.owner, let original = scene.originalPitches[owner],
        let next = model.notes[owner]?.pitch
      {
        c.translateBy(x: 0, y: CGFloat(original.staffIndex - next.staffIndex) * 5)
      }
      c.scaleBy(x: sx, y: sy)
      c.translateBy(x: -scene.viewBox.minX, y: -scene.viewBox.minY)
      c.concatenate(mark.style.transform)
      c.setAlpha(mark.style.opacity)
      let selected =
        mark.style.owner.map { model.selection.contains($0) || model.activeNotes.contains($0) }
        ?? false
      let fill = selected ? NSColor.controlAccentColor : mark.style.fill
      switch mark.content {
      case .path(let path):
        if fill.alphaComponent > 0 {
          c.addPath(path)
          c.setFillColor(fill.cgColor)
          c.fillPath()
        }
        if let stroke = mark.style.stroke {
          c.addPath(path)
          c.setStrokeColor(stroke.cgColor)
          c.setLineWidth(mark.style.width)
          c.strokePath()
        }
      case .text(let text, let point):
        var font =
          NSFont(name: mark.style.font, size: mark.style.size)
          ?? NSFont.systemFont(ofSize: mark.style.size)
        var traits: NSFontTraitMask = []
        if mark.style.bold { traits.insert(.boldFontMask) }
        if mark.style.italic { traits.insert(.italicFontMask) }
        font = NSFontManager.shared.convert(font, toHaveTrait: traits)
        (text as NSString).draw(
          at: CGPoint(x: point.x, y: point.y - font.ascender),
          withAttributes: [.font: font, .foregroundColor: fill])
      }
      c.restoreGState()
    }
    for target in scene.targets where model.selection.contains(target.id) {
      var rect = target.rect
      if let original = scene.originalPitches[target.id], let next = model.notes[target.id]?.pitch {
        rect.origin.y += CGFloat(original.staffIndex - next.staffIndex) * 5
      }
      c.setStrokeColor(NSColor.controlAccentColor.withAlphaComponent(0.7).cgColor)
      c.setLineWidth(1)
      c.stroke(rect.insetBy(dx: -2, dy: -2))
    }
    c.restoreGState()
  }
  override func mouseDown(with event: NSEvent) {
    window?.makeFirstResponder(self)
    guard let model, let scene = model.scene else { return }
    let location = convert(event.locationInWindow, from: nil)
    let p = CGPoint(x: location.x / model.zoom, y: location.y / model.zoom)
    let candidates = scene.targets.filter { $0.rect.insetBy(dx: -4, dy: -4).contains(p) }
    let selected = candidates.min {
      hypot($0.rect.midX - p.x, $0.rect.midY - p.y) < hypot($1.rect.midX - p.x, $1.rect.midY - p.y)
    }
    if let target = selected {
      drag = (target.id, p.y)
      model.select(
        target.id, extend: event.modifierFlags.contains(.command),
        range: event.modifierFlags.contains(.shift))
    } else {
      model.selection = []
      needsDisplay = true
    }
  }
  override func mouseUp(with event: NSEvent) {
    guard let drag, let model else { return }
    self.drag = nil
    let y = convert(event.locationInWindow, from: nil).y / model.zoom
    let delta = Int(round((drag.y - y) / 5))
    if abs(drag.y - y) >= 5 && delta != 0 {
      model.edit("drag", ["ids": [drag.id], "delta": delta])
    }
  }
  override func keyDown(with event: NSEvent) {
    guard let model else { return }
    if event.modifierFlags.contains(.option) && [123, 124].contains(event.keyCode) {
      model.flip(event.keyCode == 124 ? 1 : -1)
      return
    }
    switch event.keyCode {
    case 126, 125:
      model.edit(
        event.modifierFlags.contains(.shift) ? "octave" : "semitone",
        ["ids": Array(model.selection), "delta": event.keyCode == 126 ? 1 : -1])
    case 123, 124: model.adjacent(event.keyCode == 124 ? 1 : -1)
    case 49: model.togglePlayback()
    case 53: model.selection = []
    default:
      if let key = event.characters, let number = Int(key), number >= 1 && number <= 7 {
        model.duration(
          ["64th", "32nd", "16th", "eighth", "quarter", "half", "whole"][number - 1],
          model.primary?.dots ?? 0)
      } else {
        super.keyDown(with: event)
      }
    }
  }
}
final class NoteAccessibility: NSAccessibilityElement {
  weak var canvas: CanvasView?
  var noteId = ""
  override func accessibilityPerformPress() -> Bool {
    guard let canvas else { return false }
    let id = noteId
    DispatchQueue.main.async { [weak canvas] in
      guard let canvas, let model = canvas.model else { return }
      canvas.window?.makeFirstResponder(canvas)
      model.select(id)
      canvas.needsDisplay = true
    }
    return true
  }
}
