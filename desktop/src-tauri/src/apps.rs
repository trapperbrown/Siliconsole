//! Per-app overlay dashboards: while a listed program runs, the overlay shows its dashboard.
//! Process names come from a Toolhelp snapshot via kernel32, so no extra crate is needed.
use std::collections::BTreeSet;
use std::sync::Mutex;
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager};

use crate::config::CONFIG;
use crate::storage::SettingsState;

pub const EVENT_APP_DASHBOARD: &str = "overlay://app-dashboard";

/// The dashboard id chosen by a running program, if any.
#[derive(Default)]
pub struct AppDashboard(Mutex<Option<String>>);

const TH32CS_SNAPPROCESS: u32 = 0x2;
const INVALID_HANDLE_VALUE: isize = -1;

#[repr(C)]
struct ProcessEntry32W {
    size: u32,
    usage: u32,
    process_id: u32,
    default_heap_id: usize,
    module_id: u32,
    threads: u32,
    parent_process_id: u32,
    pri_class_base: i32,
    flags: u32,
    exe_file: [u16; 260],
}

#[link(name = "kernel32")]
unsafe extern "system" {
    fn CreateToolhelp32Snapshot(flags: u32, process_id: u32) -> isize;
    fn Process32FirstW(snapshot: isize, entry: *mut ProcessEntry32W) -> i32;
    fn Process32NextW(snapshot: isize, entry: *mut ProcessEntry32W) -> i32;
    fn CloseHandle(handle: isize) -> i32;
}

/// Lowercase file names of every running process.
fn running_exes() -> BTreeSet<String> {
    let mut names = BTreeSet::new();
    unsafe {
        let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snap == INVALID_HANDLE_VALUE {
            return names;
        }
        let mut e: ProcessEntry32W = std::mem::zeroed();
        e.size = std::mem::size_of::<ProcessEntry32W>() as u32;
        let mut ok = Process32FirstW(snap, &mut e);
        while ok != 0 {
            let len = e.exe_file.iter().position(|&c| c == 0).unwrap_or(e.exe_file.len());
            names.insert(String::from_utf16_lossy(&e.exe_file[..len]).to_lowercase());
            ok = Process32NextW(snap, &mut e);
        }
        CloseHandle(snap);
    }
    names
}

/// Program names for the Settings picker, minus Windows housekeeping that nobody wants a dashboard for.
#[tauri::command]
pub fn running_apps() -> Vec<String> {
    const SKIP: [&str; 8] = ["svchost.exe", "system", "[system process]", "registry", "smss.exe", "csrss.exe", "wininit.exe", "services.exe"];
    running_exes().into_iter().filter(|n| n.ends_with(".exe") && !SKIP.contains(&n.as_str())).collect()
}

#[tauri::command]
pub fn app_dashboard(app: AppHandle) -> Option<String> {
    app.state::<AppDashboard>().0.lock().unwrap().clone()
}

/// Polls every `history.appWatchMs`; skips the snapshot entirely while no rules exist.
pub async fn watch(app: AppHandle) {
    let mut tick = tokio::time::interval(Duration::from_millis(CONFIG.history.app_watch_ms as u64));
    loop {
        tick.tick().await;
        let rules = app.state::<SettingsState>().get().app_dashboards.unwrap_or_default();
        let next = if rules.is_empty() {
            None
        } else {
            let running = running_exes();
            rules.iter().find(|r| running.contains(&r.exe.to_lowercase())).map(|r| r.dashboard_id.clone())
        };
        let state = app.state::<AppDashboard>();
        let mut current = state.0.lock().unwrap();
        if *current != next {
            *current = next.clone();
            let _ = app.emit(EVENT_APP_DASHBOARD, next);
        }
    }
}
