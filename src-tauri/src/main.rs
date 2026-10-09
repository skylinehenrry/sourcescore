#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod files;
use tauri::{Emitter, Manager};
use files::{FileState, OpenResult, SaveResult};

#[tauri::command]
async fn open_score(state: tauri::State<'_, FileState>, path: String) -> Result<OpenResult, String> { files::open(&state, &path) }
#[tauri::command]
async fn save_score(state: tauri::State<'_, FileState>, session_id: String, source: String) -> Result<SaveResult, String> { files::save(&state, &session_id, &source) }
#[tauri::command]
async fn prepare_save_as(state: tauri::State<'_, FileState>, path: String) -> Result<String, String> { files::prepare_save_as(&state, &path) }
#[tauri::command]
async fn save_as_score(state: tauri::State<'_, FileState>, grant: String, session_id: Option<String>, source: String) -> Result<OpenResult, String> { files::save_as(&state, &grant, session_id.as_deref(), &source) }
#[tauri::command]
fn release_score(state: tauri::State<FileState>, session_id: String) { if let Ok(mut sessions) = state.sessions.lock() { sessions.remove(&session_id); } }
#[tauri::command]
fn exit_app(app: tauri::AppHandle) { app.exit(0); }
#[tauri::command]
fn take_pending_file(state: tauri::State<PendingFile>) -> Option<String> { state.0.lock().ok()?.take() }
#[tauri::command]
async fn check_score(state: tauri::State<'_, FileState>, session_id: String) -> Result<bool, String> {
    files::changed(&state, &session_id)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(FileState::default())
        .invoke_handler(tauri::generate_handler![open_score, save_score, prepare_save_as, save_as_score, release_score, exit_app, take_pending_file, check_score])
        .setup(|app| {
            use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
            let open = MenuItem::with_id(app, "open", "Open…", true, Some("CmdOrCtrl+O"))?;
            let save = MenuItem::with_id(app, "save", "Save", true, Some("CmdOrCtrl+S"))?;
            let save_as = MenuItem::with_id(app, "save-as", "Save As…", true, Some("CmdOrCtrl+Shift+S"))?;
            let undo = MenuItem::with_id(app, "undo", "Undo", true, Some("CmdOrCtrl+Z"))?;
            let redo = MenuItem::with_id(app, "redo", "Redo", true, Some("CmdOrCtrl+Shift+Z"))?;
            let quit = MenuItem::with_id(app, "quit", "Quit SourceScore", true, Some("CmdOrCtrl+Q"))?;
            let about = PredefinedMenuItem::about(app, Some("About SourceScore"), None)?;
            let app_menu = Submenu::with_items(app, "SourceScore", true, &[&about, &PredefinedMenuItem::separator(app)?, &quit])?;
            let file_menu = Submenu::with_items(app, "File", true, &[&open, &save, &save_as])?;
            let edit_menu = Submenu::with_items(app, "Edit", true, &[&undo, &redo, &PredefinedMenuItem::separator(app)?, &PredefinedMenuItem::cut(app, None)?, &PredefinedMenuItem::copy(app, None)?, &PredefinedMenuItem::paste(app, None)?, &PredefinedMenuItem::select_all(app, None)?])?;
            app.set_menu(Menu::with_items(app, &[&app_menu, &file_menu, &edit_menu])?)?;
            app.on_menu_event(|app, event| { let _ = app.emit("menu-action", event.id().as_ref()); });
            if let Some(path) = std::env::args().skip(1).find(|a| a.ends_with(".musicxml") || a.ends_with(".xml")) {
                // The frontend queries this pending path once its listeners are ready.
                app.manage(PendingFile(std::sync::Mutex::new(Some(path))));
            } else { app.manage(PendingFile(std::sync::Mutex::new(None))); }
            Ok(())
        })
        .build(tauri::generate_context!()).expect("Could not start SourceScore")
        .run(|app, event| {
            if let tauri::RunEvent::Opened { urls } = event {
                if let Some(path) = urls.first().and_then(|url| url.to_file_path().ok()) {
                    let path = path.to_string_lossy().to_string();
                    if let Some(state) = app.try_state::<PendingFile>() { if let Ok(mut pending) = state.0.lock() { *pending = Some(path.clone()); } }
                    let _ = app.emit("open-path", path);
                }
            }
        });
}
struct PendingFile(std::sync::Mutex<Option<String>>);
