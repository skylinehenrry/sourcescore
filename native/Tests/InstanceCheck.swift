import AppKit
import Foundation

@main struct InstanceCheck {
  static func main() throws {
    let arguments = CommandLine.arguments
    let lock = try ApplicationLock(url: URL(fileURLWithPath: arguments[1]))
    guard lock.acquired else { print("blocked"); return }
    print("acquired")
    fflush(stdout)
    if arguments.count > 2 { Thread.sleep(forTimeInterval: Double(arguments[2]) ?? 1) }
    withExtendedLifetime(lock) {}
  }
}
