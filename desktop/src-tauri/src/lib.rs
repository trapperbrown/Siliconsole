mod apps;
mod config;
mod generated;
mod monitor;
mod pipe;
mod storage;

use std::sync::Mutex;

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, WebviewWindow, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

use crate::config::CONFIG;
use crate::generated::UserSettings;

/// Applies side effects of a settings change.
pub fn on_settings_changed(app: &AppHandle, previous: &UserSettings, next: &UserSettings) {
    if previous.poll_interval_ms != next.poll_interval_ms {
        if let Some(ms) = next.poll_interval_ms {
            let _ = app.state::<pipe::Telemetry>().set_interval(ms);
        }
    }
    if previous.start_with_windows != next.start_with_windows {
        let launcher = app.autolaunch();
        let _ = if next.start_with_windows.unwrap_or(CONFIG.startup.start_with_windows) { launcher.enable() } else { launcher.disable() };
    }
    if serde_json::to_string(&previous.overlay).ok() != serde_json::to_string(&next.overlay).ok() {
        place_overlays(app, next, overlay_visible(app));
    }
    monitor::on_settings_changed(app, previous, next);
}

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct MonitorInfo {
    name: String,
    label: String,
    primary: bool,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

/// Connected monitors, for the overlay monitor picker. Positions and sizes are in physical pixels.
#[tauri::command]
fn list_monitors(app: AppHandle) -> Vec<MonitorInfo> {
    let primary = app.primary_monitor().ok().flatten().and_then(|m| m.name().cloned());
    app.available_monitors()
        .unwrap_or_default()
        .iter()
        .enumerate()
        .map(|(i, m)| MonitorInfo {
            name: m.name().cloned().unwrap_or_else(|| format!("monitor-{i}")),
            label: format!("Display {}", i + 1),
            primary: m.name().cloned() == primary,
            x: m.position().x,
            y: m.position().y,
            width: m.size().width,
            height: m.size().height,
        })
        .collect()
}

/// The monitors chosen in settings that are plugged in, or the primary monitor if none are.
fn overlay_monitors(app: &AppHandle, s: &UserSettings) -> Vec<tauri::Monitor> {
    let wanted = s.overlay.as_ref().and_then(|o| o.monitors.clone()).unwrap_or_default();
    let picked: Vec<_> = app.available_monitors().unwrap_or_default().into_iter().filter(|m| m.name().is_some_and(|n| wanted.contains(n))).collect();
    if picked.is_empty() { app.primary_monitor().ok().flatten().into_iter().collect() } else { picked }
}

/// Overlay window i: "overlay" from tauri.conf.json, then "overlay-1", "overlay-2"... cloned from its config.
fn overlay_window(app: &AppHandle, i: usize) -> Option<WebviewWindow> {
    let label = if i == 0 { "overlay".to_string() } else { format!("overlay-{i}") };
    if let Some(w) = app.get_webview_window(&label) {
        return Some(w);
    }
    let mut conf = app.config().app.windows.iter().find(|w| w.label == "overlay")?.clone();
    conf.label = label;
    WebviewWindowBuilder::from_config(app, &conf).ok()?.build().ok()
}

fn overlay_windows(app: &AppHandle) -> Vec<WebviewWindow> {
    app.webview_windows().into_iter().filter(|(label, _)| label.starts_with("overlay")).map(|(_, w)| w).collect()
}

fn overlay_visible(app: &AppHandle) -> bool {
    overlay_windows(app).iter().any(|w| w.is_visible().unwrap_or(false))
}

/// One overlay per chosen monitor, sized from settings (clamped to that monitor) and pinned to the chosen corner.
/// Overlays on monitors no longer chosen are closed. With `show`, all of them are shown click-through.
/// Runs on its own thread: on Windows, creating a window from the main thread (sync commands, event handlers,
/// the hotkey callback) deadlocks, while other threads hand creation to the event loop safely.
fn place_overlays(app: &AppHandle, s: &UserSettings, show: bool) {
    let (app, s) = (app.clone(), s.clone());
    std::thread::spawn(move || {
        let monitors = overlay_monitors(&app, &s);
        let o = s.overlay.clone().unwrap_or_default();
        let c = &CONFIG.overlay;
        for (i, monitor) in monitors.iter().enumerate() {
            let Some(w) = overlay_window(&app, i) else { continue };
            let scale = monitor.scale_factor();
            let margin = c.margin_px as f64;
            let screen = monitor.size().to_logical::<f64>(scale);
            let min = c.min_size_px as f64;
            let width = (o.width_px.unwrap_or(c.width_px) as f64).clamp(min, (screen.width - 2.0 * margin).max(min));
            let height = (o.height_px.unwrap_or(c.height_px) as f64).clamp(min, (screen.height - 2.0 * margin).max(min));
            let _ = w.set_size(LogicalSize::new(width, height));
            let corner = o.corner.as_deref().unwrap_or(&c.corner);
            let x = if corner.ends_with("left") { margin } else { screen.width - width - margin };
            let y = if corner.starts_with("top") { margin } else { screen.height - height - margin };
            let origin = monitor.position().to_logical::<f64>(scale);
            let _ = w.set_position(LogicalPosition::new(origin.x + x, origin.y + y));
            if show {
                let _ = w.show();
                let _ = w.set_always_on_top(true);
                let _ = w.set_ignore_cursor_events(true);
            }
        }
        for w in overlay_windows(&app) {
            let index = w.label().strip_prefix("overlay-").and_then(|n| n.parse().ok()).unwrap_or(0);
            if index >= monitors.len() {
                let _ = w.close();
            }
        }
    });
}

/// Shows or hides the overlay on every chosen monitor: borderless, always on top, click-through.
fn toggle_overlay(app: &AppHandle) {
    if overlay_visible(app) {
        overlay_windows(app).iter().for_each(|w| {
            let _ = w.hide();
        });
        return;
    }
    place_overlays(app, &app.state::<storage::SettingsState>().get(), true);
}

#[tauri::command]
fn toggle_overlay_cmd(app: AppHandle) {
    toggle_overlay(&app);
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", format!("Show {}", CONFIG.app_name), true, None::<&str>)?;
    let overlay = MenuItem::with_id(app, "overlay", "Toggle overlay", true, Some(CONFIG.overlay.hotkey.as_str()))?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &overlay, &quit])?;
    TrayIconBuilder::with_id(monitor::TRAY_ID)
        .icon(app.default_window_icon().cloned().expect("bundle icon"))
        .tooltip(&CONFIG.tray.fallback_tooltip)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, e| match e.id.as_ref() {
            "show" => show_main(app),
            "overlay" => toggle_overlay(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, e| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e {
                show_main(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![CONFIG.startup.minimized_arg.as_str()]),
        ))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        toggle_overlay(app);
                    }
                })
                .build(),
        )
        .manage(pipe::Telemetry::default())
        .manage(monitor::Monitor::default())
        .manage(apps::AppDashboard::default())
        .manage(storage::SettingsState(Mutex::new(storage::load_settings())))
        .invoke_handler(tauri::generate_handler![
            pipe::get_snapshot,
            pipe::request_history,
            storage::get_settings,
            storage::save_settings,
            storage::list_documents,
            storage::save_document,
            storage::delete_document,
            storage::export_file,
            storage::import_file,
            storage::pick_folder,
            monitor::test_alert,
            monitor::csv_status,
            monitor::alert_history,
            monitor::clear_alert_history,
            monitor::list_logs,
            monitor::read_log,
            apps::running_apps,
            apps::app_dashboard,
            toggle_overlay_cmd,
            list_monitors,
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            build_tray(&handle)?;
            if let Err(e) = app.global_shortcut().register(CONFIG.overlay.hotkey.as_str()) {
                eprintln!("could not register overlay hotkey {}: {e}", CONFIG.overlay.hotkey);
            }
            tauri::async_runtime::spawn(pipe::run(handle.clone()));
            tauri::async_runtime::spawn(apps::watch(handle.clone()));

            let settings = app.state::<storage::SettingsState>().get();
            let minimized = settings.start_minimized.unwrap_or(CONFIG.startup.start_minimized)
                || std::env::args().any(|a| a == CONFIG.startup.minimized_arg);
            if !minimized {
                show_main(&handle);
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the main window keeps the app running in the tray; Quit lives in the tray menu.
            if window.label() == "main" {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
