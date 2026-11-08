//! User data under %APPDATA%: settings, dashboards and custom themes, plus import and export through
//! native file dialogs. The webview never passes file paths; Rust owns every path it touches.
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde_json::Value;
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_dialog::DialogExt;

use crate::config::{app_data_dir, CONFIG};
use crate::generated::UserSettings;

pub const EVENT_SETTINGS: &str = "settings://changed";

pub struct SettingsState(pub Mutex<UserSettings>);

fn settings_path() -> PathBuf {
    app_data_dir().join("settings.json")
}

pub fn load_settings() -> UserSettings {
    fs::read_to_string(settings_path())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

/// Write to a temp file then rename, so a crash never leaves a half-written file.
fn write_atomic(path: &Path, contents: &str) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, contents).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| e.to_string())
}

/// Ids become file names, so allow only the same safe pattern the schemas use.
fn safe_id(id: &str) -> Result<&str, String> {
    let ok = !id.is_empty()
        && id.len() <= 64
        && id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        && !id.starts_with('-');
    if ok { Ok(id) } else { Err(format!("invalid id: {id}")) }
}

impl SettingsState {
    pub fn get(&self) -> UserSettings {
        self.0.lock().unwrap().clone()
    }
}

#[tauri::command]
pub fn get_settings(state: State<SettingsState>) -> UserSettings {
    state.get()
}

#[tauri::command]
pub fn save_settings(app: AppHandle, state: State<SettingsState>, settings: UserSettings) -> Result<(), String> {
    if let Some(ms) = settings.poll_interval_ms {
        let p = &CONFIG.polling;
        if ms < p.min_interval_ms || ms > p.max_interval_ms {
            return Err(format!("poll interval must be {} to {} ms", p.min_interval_ms, p.max_interval_ms));
        }
    }
    if let Some(folder) = settings.csv_log.as_ref().and_then(|c| c.folder.as_deref()) {
        if !std::path::Path::new(folder).is_absolute() {
            return Err("the CSV log folder must be an absolute path".into());
        }
    }
    write_atomic(&settings_path(), &serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?)?;
    let previous = std::mem::replace(&mut *state.0.lock().unwrap(), settings.clone());
    crate::on_settings_changed(&app, &previous, &settings);
    let _ = app.emit(EVENT_SETTINGS, &settings);
    Ok(())
}

// ---------- dashboards and themes: one JSON file per id ----------

fn collection_dir(kind: &str) -> Result<PathBuf, String> {
    match kind {
        "dashboards" | "themes" => Ok(app_data_dir().join(kind)),
        _ => Err(format!("unknown collection: {kind}")),
    }
}

#[tauri::command]
pub fn list_documents(kind: String) -> Result<Vec<Value>, String> {
    let dir = collection_dir(&kind)?;
    let Ok(entries) = fs::read_dir(&dir) else { return Ok(vec![]) };
    let mut docs: Vec<Value> = entries
        .flatten()
        .filter(|e| e.path().extension().is_some_and(|x| x == "json"))
        .filter_map(|e| fs::read_to_string(e.path()).ok())
        .filter_map(|s| serde_json::from_str(&s).ok())
        .collect();
    docs.sort_by(|a, b| a["name"].as_str().cmp(&b["name"].as_str()));
    Ok(docs)
}

/// The frontend validates documents against the shared schemas before saving.
#[tauri::command]
pub fn save_document(kind: String, doc: Value) -> Result<(), String> {
    let id = safe_id(doc["id"].as_str().ok_or("document has no id")?)?.to_owned();
    let path = collection_dir(&kind)?.join(format!("{id}.json"));
    write_atomic(&path, &serde_json::to_string_pretty(&doc).map_err(|e| e.to_string())?)
}

#[tauri::command]
pub fn delete_document(kind: String, id: String) -> Result<(), String> {
    let path = collection_dir(&kind)?.join(format!("{}.json", safe_id(&id)?));
    match fs::remove_file(path) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
        _ => Ok(()),
    }
}

// ---------- import / export via native dialogs ----------

#[tauri::command]
pub async fn export_file(app: AppHandle, default_name: String, extension: String, contents: String) -> Result<bool, String> {
    let Some(path) = app
        .dialog()
        .file()
        .set_file_name(&default_name)
        .add_filter(&extension, &[extension.as_str()])
        .blocking_save_file()
    else {
        return Ok(false);
    };
    let path = path.into_path().map_err(|e| e.to_string())?;
    fs::write(path, contents).map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
pub async fn import_file(app: AppHandle, extension: String) -> Result<Option<String>, String> {
    let Some(path) = app.dialog().file().add_filter(&extension, &[extension.as_str()]).blocking_pick_file() else {
        return Ok(None);
    };
    let path = path.into_path().map_err(|e| e.to_string())?;
    let len = fs::metadata(&path).map_err(|e| e.to_string())?.len();
    let max = CONFIG.files.max_import_bytes as u64;
    if len > max {
        return Err(format!("file is larger than {max} bytes"));
    }
    fs::read_to_string(path).map(Some).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn pick_folder(app: AppHandle) -> Result<Option<String>, String> {
    Ok(app
        .dialog()
        .file()
        .blocking_pick_folder()
        .and_then(|p| p.into_path().ok())
        .map(|p| p.to_string_lossy().into_owned()))
}
