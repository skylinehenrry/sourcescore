import Foundation
import JavaScriptCore

final class CoreEngine: @unchecked Sendable {
  private let queue = DispatchQueue(label: "SourceScore.source", qos: .userInteractive)
  private var context: JSContext!
  init() {
    queue.sync {
      context = JSContext()!
      context.evaluateScript("var console={log:function(){},warn:function(){},error:function(){}};")
      context.evaluateScript(try! String(contentsOf: resource("core", "js"), encoding: .utf8))
    }
  }
  func call(_ method: String, _ args: [String: Any] = [:]) async throws -> Data {
    try await withCheckedThrowingContinuation { continuation in
      queue.async { [self] in
        context.exception = nil
        let result = context.objectForKeyedSubscript("SourceScoreCore")?.invokeMethod(
          "call", withArguments: [method, args])?.toString()
        if let exception = context.exception {
          continuation.resume(throwing: EditorError.message(exception.toString()))
          return
        }
        guard let result, let data = result.data(using: .utf8) else {
          continuation.resume(
            throwing: EditorError.message("The source engine did not return a result."))
          return
        }
        do {
          let object = try JSONSerialization.jsonObject(with: data) as! [String: Any]
          guard object["ok"] as? Bool == true else {
            throw EditorError.message(
              object["error"] as? String ?? "The edit could not be completed.")
          }
          let value = object["value"] ?? NSNull()
          let valueData = try JSONSerialization.data(
            withJSONObject: value, options: [.fragmentsAllowed])
          continuation.resume(returning: valueData)
        } catch { continuation.resume(throwing: error) }
      }
    }
  }
  func decode<T: Decodable>(_ type: T.Type, _ method: String, _ args: [String: Any] = [:])
    async throws -> T
  { try JSONDecoder().decode(type, from: await call(method, args)) }
}
