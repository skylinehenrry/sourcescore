import AppKit
import Darwin
import Foundation

/// A kernel lock survives neither a crash nor a quit, and works across copied app bundles.
final class ApplicationLock {
  private var descriptor: Int32 = -1
  private(set) var acquired = false
  init(url: URL) throws {
    try FileManager.default.createDirectory(
      at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    descriptor = Darwin.open(url.path, O_CREAT | O_RDWR | O_NOFOLLOW, 0o600)
    guard descriptor >= 0 else { throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO) }
    _ = fcntl(descriptor, F_SETFD, FD_CLOEXEC)
    guard flock(descriptor, LOCK_EX | LOCK_NB) == 0 else {
      let code = errno
      Darwin.close(descriptor)
      descriptor = -1
      guard code == EWOULDBLOCK else {
        throw POSIXError(POSIXErrorCode(rawValue: code) ?? .EIO)
      }
      return
    }
    acquired = true
  }
  deinit { if descriptor >= 0 { Darwin.close(descriptor) } }
}

@MainActor final class ApplicationInstance {
  static let shared = ApplicationInstance()
  static let identifier = Bundle.main.bundleIdentifier ?? "local.sourcescore.editor"
  static var reopenNotification: Notification.Name {
    Notification.Name(identifier + ".bring-editor-forward")
  }
  private var lock: ApplicationLock?

  func acquireOrActivateExisting() throws -> Bool {
    let directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("SourceScore", isDirectory: true)
    let lock = try ApplicationLock(url: directory.appendingPathComponent(Self.identifier + ".lock"))
    let peers = NSRunningApplication.runningApplications(withBundleIdentifier: Self.identifier)
      .filter { $0.processIdentifier != getpid() && !$0.isTerminated }
      .sorted { ($0.launchDate ?? .distantFuture) < ($1.launchDate ?? .distantFuture) }
    // Also recognize an older running version that predates the kernel lock.
    guard lock.acquired && !peers.contains(where: { $0.isFinishedLaunching }) else {
      let paths = CommandLine.arguments.dropFirst().filter {
        ["musicxml", "xml"].contains(URL(fileURLWithPath: $0).pathExtension.lowercased())
      }.map { URL(fileURLWithPath: $0).standardizedFileURL.path }
      DistributedNotificationCenter.default().postNotificationName(
        Self.reopenNotification, object: nil, userInfo: ["files": paths], deliverImmediately: true)
      peers.first?.activate(options: [])
      return false
    }
    self.lock = lock
    return true
  }
}
