import CryptoKit
import Darwin
import Foundation

struct FileReference: Sendable {
  var url: URL
  var hash: String
}
struct SavedFile: Sendable {
  var reference: FileReference
  var backup: URL?
  var unchanged: Bool
}
actor FileStore {
  static func digest(_ data: Data) -> String {
    SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
  }
  func open(_ url: URL) throws -> (String, FileReference) {
    let canonical = url.resolvingSymlinksInPath()
    try checkPath(canonical)
    let data = try Data(contentsOf: canonical)
    guard data.count <= 200_000_000, let text = String(data: data, encoding: .utf8) else {
      throw EditorError.message("Open a UTF-8 MusicXML file smaller than 200 MB.")
    }
    if let encoding = text.prefix(250).range(
      of: "encoding\\s*=\\s*[\"']([^\"']+)", options: .regularExpression)
    {
      let declaration = String(text[encoding]).lowercased()
      if !declaration.contains("utf-8") && !declaration.contains("utf8")
        && !declaration.contains("us-ascii")
      {
        throw EditorError.message(
          "This file's encoding is unsupported. Its bytes have not been changed.")
      }
    }
    return (text, FileReference(url: canonical, hash: Self.digest(data)))
  }
  private func checkPath(_ url: URL) throws {
    guard ["xml", "musicxml"].contains(url.pathExtension.lowercased()) else {
      throw EditorError.message("Choose an uncompressed .musicxml or .xml file.")
    }
  }
  func changed(_ file: FileReference) -> Bool {
    guard let data = try? Data(contentsOf: file.url) else { return true }
    return Self.digest(data) != file.hash
  }
  func target(_ url: URL) throws -> FileReference {
    try checkPath(url)
    return FileReference(
      url: url.resolvingSymlinksInPath(),
      hash: FileManager.default.fileExists(atPath: url.path)
        ? Self.digest(try Data(contentsOf: url)) : "")
  }
  func save(_ text: String, to file: FileReference) throws -> SavedFile {
    try checkPath(file.url)
    let data = Data(text.utf8)
    let fm = FileManager.default
    let exists = fm.fileExists(atPath: file.url.path)
    let previous = exists ? try Data(contentsOf: file.url) : Data()
    guard (exists ? Self.digest(previous) : "") == file.hash else {
      throw EditorError.message(
        "The file changed outside SourceScore. Reopen it or use Save As with a different filename.")
    }
    if exists && data == previous {
      return SavedFile(reference: file, backup: nil, unchanged: true)
    }
    let folder = file.url.deletingLastPathComponent()
    let temp = folder.appendingPathComponent(".sourcescore-\(UUID().uuidString).tmp")
    let fd = Darwin.open(temp.path, O_WRONLY | O_CREAT | O_EXCL, 0o600)
    guard fd >= 0 else {
      throw EditorError.message("Cannot prepare an atomic save: \(String(cString:strerror(errno)))")
    }
    defer {
      Darwin.close(fd)
      try? fm.removeItem(at: temp)
    }
    if exists {
      var statValue = stat()
      if stat(file.url.path, &statValue) == 0 { fchmod(fd, statValue.st_mode & 0o7777) }
    }
    try data.withUnsafeBytes { bytes in
      var sent = 0
      while sent < bytes.count {
        let count = Darwin.write(fd, bytes.baseAddress!.advanced(by: sent), bytes.count - sent)
        if count <= 0 { throw EditorError.message("The temporary score write failed.") }
        sent += count
      }
    }
    guard fsync(fd) == 0 else {
      throw EditorError.message("Cannot finish the temporary score write.")
    }
    var backup: URL?
    if exists {
      let backups = folder.appendingPathComponent(".sourcescore-backups", isDirectory: true)
      try fm.createDirectory(at: backups, withIntermediateDirectories: true)
      let url = backups.appendingPathComponent(
        file.url.lastPathComponent + "." + UUID().uuidString + ".bak")
      try previous.write(to: url, options: .withoutOverwriting)
      let backupHandle = try FileHandle(forWritingTo: url)
      try backupHandle.synchronize()
      try backupHandle.close()
      backup = url
    }
    let finalExists = fm.fileExists(atPath: file.url.path)
    let final = finalExists ? Self.digest(try Data(contentsOf: file.url)) : ""
    guard final == file.hash else {
      throw EditorError.message(
        "The destination changed during saving. The original was not overwritten.")
    }
    let result =
      exists
      ? Darwin.rename(temp.path, file.url.path)
      : Darwin.renamex_np(temp.path, file.url.path, UInt32(RENAME_EXCL))
    guard result == 0 else {
      throw EditorError.message("Atomic replacement failed; the backup is retained.")
    }
    return SavedFile(
      reference: FileReference(url: file.url, hash: Self.digest(data)), backup: backup,
      unchanged: false)
  }
}
