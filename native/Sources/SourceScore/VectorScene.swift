import AppKit
import Foundation

struct VectorStyle {
  var transform = CGAffineTransform.identity
  var fill = NSColor.black
  var stroke: NSColor?
  var width: CGFloat = 1
  var opacity: CGFloat = 1
  var owner: String?
  var font = "Times New Roman"
  var size: CGFloat = 14
  var bold = false
  var italic = false
}
enum VectorContent {
  case path(CGPath)
  case text(String, CGPoint)
}
struct VectorMark {
  var content: VectorContent
  var style: VectorStyle
}
final class VectorScene {
  var width: CGFloat = 1000, height: CGFloat = 1000,
    viewBox = CGRect(x: 0, y: 0, width: 1000, height: 1000)
  var marks: [VectorMark] = []
  var targets: [HitTarget] = []
  var bars: [BarTarget] = []
  var originalPitches: [String: Pitch] = [:]
  var revision = 0
  var startMeasure = 0
  var measureTops: [Double] = []
  static func parse(_ svg: String) throws -> VectorScene {
    let delegate = SVGReader()
    let parser = XMLParser(data: Data(svg.utf8))
    parser.delegate = delegate
    parser.shouldResolveExternalEntities = false
    guard parser.parse() else {
      throw EditorError.message("The notation vector scene could not be read.")
    }
    return delegate.scene
  }
}
private func numbers(_ value: String) -> [Double] {
  let regex = try! NSRegularExpression(
    pattern: "[-+]?(?:[0-9]*\\.[0-9]+|[0-9]+\\.?[0-9]*)(?:[eE][-+]?[0-9]+)?")
  let ns = value as NSString
  return regex.matches(in: value, range: NSRange(location: 0, length: ns.length)).compactMap {
    Double(ns.substring(with: $0.range))
  }
}
private func color(_ value: String) -> NSColor? {
  let s = value.trimmingCharacters(in: .whitespacesAndNewlines)
  if s == "none" { return nil }
  if s == "black" { return .black }
  if s == "white" { return .white }
  if s.hasPrefix("#") {
    let h = String(s.dropFirst())
    if let n = UInt64(h, radix: 16) {
      if h.count == 3 {
        return NSColor(
          calibratedRed: CGFloat((n >> 8) & 15) / 15, green: CGFloat((n >> 4) & 15) / 15,
          blue: CGFloat(n & 15) / 15, alpha: 1)
      }
      if h.count == 6 {
        return NSColor(
          calibratedRed: CGFloat((n >> 16) & 255) / 255, green: CGFloat((n >> 8) & 255) / 255,
          blue: CGFloat(n & 255) / 255, alpha: 1)
      }
      if h.count == 8 {
        return NSColor(
          calibratedRed: CGFloat((n >> 24) & 255) / 255, green: CGFloat((n >> 16) & 255) / 255,
          blue: CGFloat((n >> 8) & 255) / 255, alpha: CGFloat(n & 255) / 255)
      }
    }
  }
  return .black
}
private func transform(_ value: String) -> CGAffineTransform {
  let regex = try! NSRegularExpression(pattern: "([a-zA-Z]+)\\s*\\(([^)]*)\\)")
  let ns = value as NSString
  var result = CGAffineTransform.identity
  for match in regex.matches(in: value, range: NSRange(location: 0, length: ns.length)) {
    let kind = ns.substring(with: match.range(at: 1))
    let n = numbers(ns.substring(with: match.range(at: 2)))
    var t = CGAffineTransform.identity
    switch kind {
    case "translate":
      if !n.isEmpty { t = CGAffineTransform(translationX: n[0], y: n.count > 1 ? n[1] : 0) }
    case "scale":
      if !n.isEmpty { t = CGAffineTransform(scaleX: n[0], y: n.count > 1 ? n[1] : n[0]) }
    case "matrix":
      if n.count == 6 {
        t = CGAffineTransform(a: n[0], b: n[1], c: n[2], d: n[3], tx: n[4], ty: n[5])
      }
    case "rotate":
      if !n.isEmpty {
        let r = n[0] * Double.pi / 180
        if n.count == 3 {
          t = CGAffineTransform(translationX: n[1], y: n[2]).rotated(by: r).translatedBy(
            x: -n[1], y: -n[2])
        } else {
          t = CGAffineTransform(rotationAngle: r)
        }
      }
    default: break
    }
    result = t.concatenating(result)
  }
  return result
}
private final class SVGReader: NSObject, XMLParserDelegate {
  var scene = VectorScene(), styles = [VectorStyle]()
  var textValue = "", textPoint = CGPoint.zero, inText = false
  func parser(
    _ parser: XMLParser, didStartElement name: String, namespaceURI: String?,
    qualifiedName: String?, attributes a: [String: String]
  ) {
    var style = styles.last ?? VectorStyle()
    var attrs = a
    if let css = a["style"] {
      for item in css.split(separator: ";") {
        let pair = item.split(separator: ":", maxSplits: 1).map {
          String($0).trimmingCharacters(in: .whitespaces)
        }
        if pair.count == 2 { attrs[pair[0]] = pair[1] }
      }
    }
    if let t = attrs["transform"] { style.transform = transform(t).concatenating(style.transform) }
    if let fill = attrs["fill"] { style.fill = color(fill) ?? .clear }
    if let stroke = attrs["stroke"] { style.stroke = color(stroke) }
    if let width = attrs["stroke-width"], let n = numbers(width).first { style.width = n }
    if let opacity = attrs["opacity"], let n = Double(opacity) { style.opacity *= n }
    if let owner = attrs["data-source-note"] { style.owner = owner }
    if let family = attrs["font-family"] {
      style.font = family.replacingOccurrences(of: "\"", with: "").replacingOccurrences(
        of: "'", with: "")
    }
    if let size = attrs["font-size"], let n = numbers(size).first { style.size = n }
    if let weight = attrs["font-weight"] { style.bold = weight == "bold" || weight == "700" }
    if let italic = attrs["font-style"] { style.italic = italic == "italic" }
    styles.append(style)
    let n = { (key: String) -> Double in Double(attrs[key] ?? "0") ?? 0 }
    switch name {
    case "svg":
      scene.width = n("width")
      scene.height = n("height")
      if let box = attrs["viewBox"] {
        let v = numbers(box)
        if v.count == 4 { scene.viewBox = CGRect(x: v[0], y: v[1], width: v[2], height: v[3]) }
      }
    case "path":
      if let d = attrs["d"] {
        scene.marks.append(VectorMark(content: .path(SVGPath.parse(d)), style: style))
      }
    case "rect":
      let path = CGPath(
        rect: CGRect(x: n("x"), y: n("y"), width: n("width"), height: n("height")), transform: nil)
      scene.marks.append(VectorMark(content: .path(path), style: style))
    case "line":
      let path = CGMutablePath()
      path.move(to: CGPoint(x: n("x1"), y: n("y1")))
      path.addLine(to: CGPoint(x: n("x2"), y: n("y2")))
      scene.marks.append(VectorMark(content: .path(path), style: style))
    case "circle", "ellipse":
      let rx = name == "circle" ? n("r") : n("rx")
      let ry = name == "circle" ? n("r") : n("ry")
      let path = CGPath(
        ellipseIn: CGRect(x: n("cx") - rx, y: n("cy") - ry, width: rx * 2, height: ry * 2),
        transform: nil)
      scene.marks.append(VectorMark(content: .path(path), style: style))
    case "text":
      inText = true
      textValue = ""
      textPoint = CGPoint(x: n("x"), y: n("y"))
    default: break
    }
  }
  func parser(_ parser: XMLParser, foundCharacters string: String) {
    if inText { textValue += string }
  }
  func parser(
    _ parser: XMLParser, didEndElement name: String, namespaceURI: String?, qualifiedName: String?
  ) {
    if name == "text" {
      scene.marks.append(VectorMark(content: .text(textValue, textPoint), style: styles.last!))
      inText = false
    }
    _ = styles.popLast()
  }
}
enum SVGPath {
  static func parse(_ value: String) -> CGPath {
    let re = try! NSRegularExpression(
      pattern: "[a-zA-Z]|[-+]?(?:[0-9]*\\.[0-9]+|[0-9]+\\.?[0-9]*)(?:[eE][-+]?[0-9]+)?")
    let ns = value as NSString
    let t = re.matches(in: value, range: NSRange(location: 0, length: ns.length)).map {
      ns.substring(with: $0.range)
    }
    let path = CGMutablePath()
    var i = 0
    var command = "M"
    var p = CGPoint.zero
    var start = CGPoint.zero
    var lastControl = CGPoint.zero
    var previous = ""
    func number() -> Double {
      guard i < t.count, let n = Double(t[i]) else { return 0 }
      i += 1
      return n
    }
    while i < t.count {
      if t[i].first!.isLetter {
        command = t[i]
        i += 1
        if command.uppercased() == "Z" {
          path.closeSubpath()
          p = start
          previous = "Z"
          continue
        }
      }
      let relative = command == command.lowercased()
      let kind = command.uppercased()
      let old = i
      func point() -> CGPoint {
        let x = number()
        let y = number()
        return CGPoint(x: x + (relative ? p.x : 0), y: y + (relative ? p.y : 0))
      }
      switch kind {
      case "M":
        p = point()
        path.move(to: p)
        start = p
        command = relative ? "l" : "L"
      case "L":
        p = point()
        path.addLine(to: p)
      case "H":
        p.x = number() + (relative ? p.x : 0)
        path.addLine(to: p)
      case "V":
        p.y = number() + (relative ? p.y : 0)
        path.addLine(to: p)
      case "C":
        let c1 = point()
        let c2 = point()
        let end = point()
        path.addCurve(to: end, control1: c1, control2: c2)
        p = end
        lastControl = c2
      case "S":
        let c1 =
          ["C", "S"].contains(previous)
          ? CGPoint(x: 2 * p.x - lastControl.x, y: 2 * p.y - lastControl.y) : p
        let c2 = point()
        let end = point()
        path.addCurve(to: end, control1: c1, control2: c2)
        p = end
        lastControl = c2
      case "Q":
        let c = point()
        let end = point()
        path.addQuadCurve(to: end, control: c)
        p = end
        lastControl = c
      case "T":
        let c =
          ["Q", "T"].contains(previous)
          ? CGPoint(x: 2 * p.x - lastControl.x, y: 2 * p.y - lastControl.y) : p
        let end = point()
        path.addQuadCurve(to: end, control: c)
        p = end
        lastControl = c
      case "A":
        let rx = number()
        let ry = number()
        let rotation = number()
        let large = number()
        let sweep = number()
        let end = point()
        arc(
          path, from: p, to: end, rx: rx, ry: ry, rotation: rotation, large: large != 0,
          sweep: sweep != 0)
        p = end
      default: break
      }
      if i == old { i += 1 }
      previous = kind
    }
    return path
  }
  private static func arc(
    _ path: CGMutablePath, from p: CGPoint, to end: CGPoint, rx inputX: Double, ry inputY: Double,
    rotation: Double, large: Bool, sweep: Bool
  ) {
    var rx = abs(inputX)
    var ry = abs(inputY)
    if rx == 0 || ry == 0 {
      path.addLine(to: end)
      return
    }
    let phi = rotation * Double.pi / 180
    let c = cos(phi)
    let s = sin(phi)
    let dx = (p.x - end.x) / 2
    let dy = (p.y - end.y) / 2
    let x = c * dx + s * dy
    let y = -s * dx + c * dy
    let lambda = x * x / (rx * rx) + y * y / (ry * ry)
    if lambda > 1 {
      let scale = sqrt(lambda)
      rx *= scale
      ry *= scale
    }
    let fraction = max(
      0,
      (rx * rx * ry * ry - rx * rx * y * y - ry * ry * x * x) / (rx * rx * y * y + ry * ry * x * x))
    let coefficient = (large == sweep ? -1.0 : 1.0) * sqrt(fraction)
    let cx = coefficient * rx * y / ry
    let cy = -coefficient * ry * x / rx
    let center = CGPoint(
      x: c * cx - s * cy + (p.x + end.x) / 2, y: s * cx + c * cy + (p.y + end.y) / 2)
    let begin = atan2((y - cy) / ry, (x - cx) / rx)
    var delta = atan2((-y - cy) / ry, (-x - cx) / rx) - begin
    if sweep && delta < 0 { delta += 2 * Double.pi }
    if !sweep && delta > 0 { delta -= 2 * Double.pi }
    let count = max(1, Int(ceil(abs(delta) / (Double.pi / 2))))
    func at(_ a: Double) -> CGPoint {
      CGPoint(
        x: center.x + c * rx * cos(a) - s * ry * sin(a),
        y: center.y + s * rx * cos(a) + c * ry * sin(a))
    }
    func tangent(_ a: Double) -> CGPoint {
      CGPoint(x: -c * rx * sin(a) - s * ry * cos(a), y: -s * rx * sin(a) + c * ry * cos(a))
    }
    for k in 0..<count {
      let a = begin + delta * Double(k) / Double(count)
      let b = begin + delta * Double(k + 1) / Double(count)
      let factor = 4 / 3 * tan((b - a) / 4)
      let p0 = at(a)
      let p1 = at(b)
      let v0 = tangent(a)
      let v1 = tangent(b)
      path.addCurve(
        to: p1, control1: CGPoint(x: p0.x + factor * v0.x, y: p0.y + factor * v0.y),
        control2: CGPoint(x: p1.x - factor * v1.x, y: p1.y - factor * v1.y))
    }
  }
}
