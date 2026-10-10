import AppKit
import WebKit

@MainActor final class Engraver: NSObject, WKScriptMessageHandler {
  let webView: WKWebView
  private var ready = false
  private var waiters: [CheckedContinuation<Void, Never>] = []
  override init() {
    let configuration = WKWebViewConfiguration()
    webView = WKWebView(
      frame: CGRect(x: 0, y: 0, width: 1400, height: 2400), configuration: configuration)
    super.init()
    configuration.userContentController.add(self, name: "rendererReady")
    let script = try! String(contentsOf: resource("engraver", "js"), encoding: .utf8)
    let html =
      "<html><head><meta charset='UTF-8'><style>html,body{margin:0;background:white}#score{width:1400px;line-height:0}</style></head><body><div id='score'></div><script>\(script)</script></body></html>"
    webView.loadHTMLString(html, baseURL: nil)
  }
  func userContentController(
    _ userContentController: WKUserContentController, didReceive message: WKScriptMessage
  ) {
    ready = true
    let pending = waiters
    waiters = []
    pending.forEach { $0.resume() }
  }
  func render(_ payload: Data) async throws -> (VectorScene, [Note]) {
    if !ready { await withCheckedContinuation { waiters.append($0) } }
    let object = try JSONSerialization.jsonObject(with: payload)
    let result =
      try await webView.callAsyncJavaScript(
        "return await window.renderNativeScore(payload);", arguments: ["payload": object], in: nil,
        contentWorld: .page) as! [String: Any]
    let scene = try VectorScene.parse(result["svg"] as! String)
    scene.revision = result["revision"] as? Int ?? 0
    scene.targets = try JSONDecoder().decode(
      [HitTarget].self, from: JSONSerialization.data(withJSONObject: result["targets"]!))
    let notes = try JSONDecoder().decode(
      [Note].self, from: JSONSerialization.data(withJSONObject: result["notes"]!))
    for note in notes { if let pitch = note.pitch { scene.originalPitches[note.id] = pitch } }
    if let alignment = result["alignment"] as? [[String: Any]] {
      for measure in alignment {
        let staves = measure["staves"] as? [[String: Double]] ?? []
        if let first = staves.first?["x"],
          staves.contains(where: { abs(($0["x"] ?? first) - first) > 0.05 })
        {
          throw EditorError.message(
            "Instrument measures did not align in this page. Source content is intact.")
        }
      }
    }
    return (scene, notes)
  }
}
