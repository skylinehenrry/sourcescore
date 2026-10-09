use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{collections::HashMap, fs::{self, OpenOptions}, io::Write, path::{Path, PathBuf}, sync::Mutex};
use uuid::Uuid;

const MAX_BYTES: u64 = 200_000_000;
#[derive(Clone)]
pub struct Session { pub path: PathBuf, pub hash: String }
#[derive(Default)]
pub struct FileState { pub sessions: Mutex<HashMap<String, Session>>, pub grants: Mutex<HashMap<String, Session>> }
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct OpenResult { pub session_id: String, pub path: String, pub base64: String, pub hash: String }
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SaveResult { pub path: String, pub hash: String, pub backup: Option<String>, pub unchanged: bool }

fn digest(bytes: &[u8]) -> String { format!("{:x}", Sha256::digest(bytes)) }
fn score_path(path: &Path) -> Result<(), String> {
    if !matches!(path.extension().and_then(|s| s.to_str()).map(|s| s.to_lowercase()).as_deref(), Some("musicxml" | "xml")) {
        return Err("Choose an uncompressed .musicxml or .xml file.".into());
    }
    Ok(())
}
fn read(path: &Path) -> Result<Vec<u8>, String> {
    let metadata = fs::metadata(path).map_err(|e| format!("Cannot read score: {e}"))?;
    if !metadata.is_file() || metadata.len() > MAX_BYTES { return Err("Choose a regular MusicXML file smaller than 200 MB.".into()); }
    fs::read(path).map_err(|e| format!("Cannot read score: {e}"))
}
pub fn open(state: &FileState, path: &str) -> Result<OpenResult, String> {
    let path = fs::canonicalize(path).map_err(|e| format!("Cannot open score: {e}"))?;
    score_path(&path)?;
    let bytes = read(&path)?;
    std::str::from_utf8(&bytes).map_err(|_| "Only UTF-8 MusicXML is supported for editing.")?;
    let hash = digest(&bytes); let session_id = Uuid::new_v4().to_string();
    state.sessions.lock().map_err(|_| "File state unavailable")?.insert(session_id.clone(), Session { path: path.clone(), hash: hash.clone() });
    Ok(OpenResult { session_id, path: path.to_string_lossy().into(), base64: STANDARD.encode(bytes), hash })
}
fn check_xml(bytes: &[u8]) -> Result<(), String> {
    use quick_xml::events::Event;
    let mut reader = quick_xml::Reader::from_reader(bytes);
    reader.config_mut().check_end_names = true;
    let mut depth: usize = 0; let mut roots = 0;
    loop {
        match reader.read_event() {
            Ok(Event::Start(event)) => {
                if depth == 0 { roots += 1; if event.local_name().as_ref() != b"score-partwise" { return Err("Only score-partwise MusicXML can be saved.".into()); } }
                depth += 1;
            }
            Ok(Event::Empty(event)) if depth == 0 => { roots += 1; if event.local_name().as_ref() != b"score-partwise" { return Err("Invalid MusicXML root.".into()); } }
            Ok(Event::End(_)) => { depth = depth.checked_sub(1).ok_or("Unbalanced XML")?; }
            Ok(Event::Eof) => break,
            Err(e) => return Err(format!("XML validation prevented saving: {e}")),
            _ => {}
        }
    }
    if roots != 1 || depth != 0 { return Err("XML validation prevented saving: incomplete document.".into()); }
    Ok(())
}

/** Same-directory temporary write, fsync, recoverable backup, final conflict check, rename. */
pub fn atomic_save(path: &Path, expected: &str, bytes: &[u8]) -> Result<SaveResult, String> {
    score_path(path)?; check_xml(bytes)?;
    let exists = path.exists();
    let original = if exists { read(path)? } else { Vec::new() };
    let original_hash = if exists { digest(&original) } else { String::new() };
    if original_hash != expected { return Err("This file changed outside SourceScore. Reopen it, or use Save As to preserve your edits in another file.".into()); }
    if exists && original == bytes { return Ok(SaveResult { path: path.to_string_lossy().into(), hash: original_hash, backup: None, unchanged: true }); }
    let parent = path.parent().ok_or("The destination has no folder")?;
    let mut temp = tempfile::NamedTempFile::new_in(parent).map_err(|e| format!("Cannot prepare safe save: {e}"))?;
    if exists { temp.as_file().set_permissions(fs::metadata(path).map_err(|e| e.to_string())?.permissions()).map_err(|e| e.to_string())?; }
    temp.write_all(bytes).map_err(|e| format!("Cannot write score: {e}"))?;
    temp.as_file().sync_all().map_err(|e| format!("Cannot flush score: {e}"))?;
    let backup = if exists {
        let folder = parent.join(".sourcescore-backups");
        fs::create_dir_all(&folder).map_err(|e| format!("Backup creation failed; original not overwritten: {e}"))?;
        let name = format!("{}.{}.bak", path.file_name().unwrap().to_string_lossy(), Uuid::new_v4());
        let backup = folder.join(name);
        let mut file = OpenOptions::new().write(true).create_new(true).open(&backup).map_err(|e| format!("Cannot create backup: {e}"))?;
        file.set_permissions(fs::metadata(path).map_err(|e| e.to_string())?.permissions()).map_err(|e| e.to_string())?;
        file.write_all(&original).and_then(|_| file.sync_all()).map_err(|e| format!("Cannot complete backup: {e}"))?;
        Some(backup.to_string_lossy().to_string())
    } else { None };
    // Refuse a change detected while the temporary write/backup was being prepared.
    let final_hash = if path.exists() { digest(&read(path)?) } else { String::new() };
    if final_hash != expected { return Err("The destination changed during saving. The original was not overwritten; please use Save As.".into()); }
    if exists { temp.persist(path).map_err(|e| format!("Atomic save failed; backup retained: {e}"))?; }
    else { temp.persist_noclobber(path).map_err(|e| format!("Destination appeared during save; it was not overwritten: {e}"))?; }
    // Files are flushed before the atomic rename. Do not open the parent for reading:
    // a macOS file-panel grant can authorize the file without directory enumeration,
    // and a directory open can wait for filesystem authorization after the commit.
    // Power-loss durability of the directory entry remains filesystem-dependent.
    Ok(SaveResult { path: path.to_string_lossy().into(), hash: digest(bytes), backup, unchanged: false })
}
pub fn save(state: &FileState, session_id: &str, source: &str) -> Result<SaveResult, String> {
    let mut sessions = state.sessions.lock().map_err(|_| "File state unavailable")?;
    let session = sessions.get_mut(session_id).ok_or("Open the file again before saving.")?;
    let result = atomic_save(&session.path, &session.hash, source.as_bytes())?;
    session.hash = result.hash.clone(); Ok(result)
}
pub fn changed(state: &FileState, session_id: &str) -> Result<bool, String> {
    let sessions = state.sessions.lock().map_err(|_| "File state unavailable")?;
    let session = sessions.get(session_id).ok_or("The score is no longer open")?;
    match read(&session.path) { Ok(bytes) => Ok(digest(&bytes) != session.hash), Err(_) => Ok(true) }
}
pub fn prepare_save_as(state: &FileState, path: &str) -> Result<String, String> {
    let path = Path::new(path); score_path(path)?;
    let target = if path.exists() { fs::canonicalize(path).map_err(|e| e.to_string())? }
        else { fs::canonicalize(path.parent().ok_or("Choose a destination folder.")?).map_err(|e| e.to_string())?.join(path.file_name().ok_or("Choose a filename.")?) };
    let hash = if target.exists() { digest(&read(&target)?) } else { String::new() };
    let token = Uuid::new_v4().to_string();
    state.grants.lock().map_err(|_| "File state unavailable")?.insert(token.clone(), Session { path: target, hash });
    Ok(token)
}
pub fn save_as(state: &FileState, grant: &str, session_id: Option<&str>, source: &str) -> Result<OpenResult, String> {
    let target = state.grants.lock().map_err(|_| "File state unavailable")?.remove(grant).ok_or("Choose the destination again.")?;
    if let Some(id) = session_id {
        let sessions = state.sessions.lock().map_err(|_| "File state unavailable")?;
        if let Some(session) = sessions.get(id) {
            if session.path == target.path && session.hash != target.hash { return Err("The original file changed externally. Save As must use a different destination.".into()); }
        }
    }
    atomic_save(&target.path, &target.hash, source.as_bytes())?;
    open(state, target.path.to_str().ok_or("Unsupported filename")?)
}

#[cfg(test)]
mod tests {
    use super::*;
    const XML: &str = "\u{feff}<?xml version=\"1.0\" encoding=\"UTF-8\"?>\r\n<score-partwise><!-- preserve --><part-list/></score-partwise>";
    #[test] fn noop_is_byte_identical_and_creates_no_backup() {
        let folder = tempfile::tempdir().unwrap(); let path = folder.path().join("test.musicxml"); fs::write(&path, XML).unwrap();
        let state = FileState::default(); let loaded = open(&state, path.to_str().unwrap()).unwrap();
        let result = save(&state, &loaded.session_id, XML).unwrap();
        assert!(result.unchanged); assert!(result.backup.is_none()); assert_eq!(fs::read(path).unwrap(), XML.as_bytes());
    }
    #[test] fn changed_save_has_exact_backup_and_updates_revision() {
        let folder = tempfile::tempdir().unwrap(); let path = folder.path().join("test.xml"); fs::write(&path, XML).unwrap();
        let state = FileState::default(); let loaded = open(&state, path.to_str().unwrap()).unwrap(); let edited = XML.replace("preserve", "edited");
        let result = save(&state, &loaded.session_id, &edited).unwrap();
        assert_eq!(fs::read(result.backup.unwrap()).unwrap(), XML.as_bytes()); assert_eq!(fs::read(&path).unwrap(), edited.as_bytes());
        assert!(save(&state, &loaded.session_id, &edited).unwrap().unchanged);
    }
    #[test] fn external_change_is_never_overwritten() {
        let folder = tempfile::tempdir().unwrap(); let path = folder.path().join("test.xml"); fs::write(&path, XML).unwrap();
        let state = FileState::default(); let loaded = open(&state, path.to_str().unwrap()).unwrap(); fs::write(&path, XML.replace("preserve", "external")).unwrap();
        assert!(save(&state, &loaded.session_id, XML).unwrap_err().contains("changed outside"));
        assert!(fs::read_to_string(&path).unwrap().contains("external"));
    }
    #[test] fn malformed_xml_does_not_touch_disk() {
        let folder = tempfile::tempdir().unwrap(); let path = folder.path().join("test.xml"); fs::write(&path, XML).unwrap();
        assert!(atomic_save(&path, &digest(XML.as_bytes()), b"<score-partwise><note></score-partwise>").is_err());
        assert_eq!(fs::read(path).unwrap(), XML.as_bytes());
    }
    #[test] fn save_as_detects_target_changes() {
        let folder = tempfile::tempdir().unwrap(); let path = folder.path().join("test.xml"); fs::write(&path, XML).unwrap();
        let state = FileState::default(); let grant = prepare_save_as(&state, path.to_str().unwrap()).unwrap(); fs::write(&path, "external").unwrap();
        assert!(save_as(&state, &grant, None, XML).is_err()); assert_eq!(fs::read_to_string(path).unwrap(), "external");
    }
    #[test] fn new_save_as_and_existing_backup() {
        let folder = tempfile::tempdir().unwrap(); let path = folder.path().join("test.musicxml"); let state = FileState::default();
        let grant = prepare_save_as(&state, path.to_str().unwrap()).unwrap(); let result = save_as(&state, &grant, None, XML).unwrap();
        assert_eq!(STANDARD.decode(result.base64).unwrap(), XML.as_bytes());
        let grant = prepare_save_as(&state, path.to_str().unwrap()).unwrap(); save_as(&state, &grant, None, &XML.replace("preserve", "new")).unwrap();
        assert_eq!(fs::read_dir(folder.path().join(".sourcescore-backups")).unwrap().count(), 1);
    }
    #[test] fn backup_failure_preserves_original() {
        let folder = tempfile::tempdir().unwrap(); let path = folder.path().join("test.xml"); fs::write(&path, XML).unwrap();
        fs::write(folder.path().join(".sourcescore-backups"), "occupied").unwrap();
        let result = atomic_save(&path, &digest(XML.as_bytes()), XML.replace("preserve", "edited").as_bytes());
        assert!(result.unwrap_err().contains("Backup creation failed")); assert_eq!(fs::read(path).unwrap(), XML.as_bytes());
    }
    #[test] fn save_as_cannot_bypass_an_original_file_conflict() {
        let folder = tempfile::tempdir().unwrap(); let path = folder.path().join("test.xml"); fs::write(&path, XML).unwrap();
        let state = FileState::default(); let loaded = open(&state, path.to_str().unwrap()).unwrap();
        fs::write(&path, XML.replace("preserve", "external")).unwrap(); assert!(changed(&state, &loaded.session_id).unwrap());
        let grant = prepare_save_as(&state, path.to_str().unwrap()).unwrap();
        assert!(save_as(&state, &grant, Some(&loaded.session_id), XML).unwrap_err().contains("different destination"));
        assert!(fs::read_to_string(path).unwrap().contains("external"));
    }
}
