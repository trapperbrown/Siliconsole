//! Rust-side frame consumers: tray value, threshold alerts and CSV logging. They live in Rust so
//! they keep working while the window is hidden in the tray and its webview is throttled.
use std::collections::{HashMap, VecDeque};
use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::PathBuf;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

use tauri::image::Image;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::NotificationExt;

use crate::config::{app_data_dir, CONFIG};
use crate::generated::{SensorCatalogMessage, SensorFrameMessage, Theme, UserSettings};
use crate::pipe::ConnState;
use crate::storage::SettingsState;

pub const TRAY_ID: &str = "main";

struct SensorMeta {
    name: String,
    sensor_type: String,
    hardware: String,
    hardware_type: String,
}

struct CsvLog {
    path: PathBuf,
    out: BufWriter<File>,
    ids: Vec<String>,
    last_row: Option<Instant>,
}

#[derive(Default)]
pub struct Monitor {
    sensors: Mutex<HashMap<String, SensorMeta>>,
    last_alert: Mutex<HashMap<String, Instant>>,
    csv: Mutex<Option<CsvLog>>,
    csv_error: Mutex<Option<String>>,
    alert_log: Mutex<Option<VecDeque<AlertEntry>>>,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct AlertEntry {
    time: i64,
    text: String,
}

pub const EVENT_ALERTS: &str = "alerts://changed";

/// Default tray text color when no theme has chosen one: the default theme's accent.
static DEFAULT_TRAY_COLOR: LazyLock<String> = LazyLock::new(|| {
    let t: Theme = serde_json::from_str(include_str!("../../../shared/themes/midnight.json")).expect("default theme");
    t.accent
});

// ---------- formatting (mirrors desktop/src/lib/format.ts) ----------

fn temp_unit(s: &UserSettings) -> &str {
    s.temperature_unit.as_deref().unwrap_or(&CONFIG.units.temperature)
}

fn convert(sensor_type: &str, v: f64, unit: &str) -> f64 {
    if sensor_type == "Temperature" && unit == "F" { v * 9.0 / 5.0 + 32.0 } else { v }
}

fn unit_label(sensor_type: &str, unit: &str) -> String {
    if sensor_type == "Temperature" {
        return if unit == "F" { "°F".into() } else { "°C".into() };
    }
    CONFIG.sensor_units.get(sensor_type).cloned().unwrap_or_default()
}

fn format(sensor_type: &str, v: f64, unit: &str) -> String {
    let decimals = CONFIG.sensors_page.type_decimals.get(sensor_type).copied().unwrap_or(CONFIG.sensors_page.value_decimals) as usize;
    let label = unit_label(sensor_type, unit);
    format!("{:.*} {}", decimals, convert(sensor_type, v, unit), label).trim_end().to_string()
}

// ---------- hooks called by pipe.rs ----------

pub fn on_status(app: &AppHandle, state: ConnState) {
    if state != ConnState::Connected {
        reset_tray(app);
    }
}

pub fn on_catalog(app: &AppHandle, cat: SensorCatalogMessage) {
    let hw: HashMap<_, _> = cat.hardware.iter().map(|h| (h.id.clone(), (h.name.clone(), h.hardware_type.clone()))).collect();
    let map = cat
        .sensors
        .into_iter()
        .map(|s| {
            let (hardware, hardware_type) = hw.get(&s.hardware_id).cloned().unwrap_or_default();
            let meta = SensorMeta { name: s.name, hardware, hardware_type, sensor_type: s.sensor_type };
            (s.id, meta)
        })
        .collect();
    *app.state::<Monitor>().sensors.lock().unwrap() = map;
}

pub fn on_frame(app: &AppHandle, frame: &SensorFrameMessage) {
    let settings = app.state::<SettingsState>().get();
    let values: HashMap<&str, f64> = frame.values.iter().filter_map(|v| v.value.map(|x| (v.id.as_str(), x))).collect();
    update_tray(app, &settings, &values);
    check_alerts(app, &settings, &values, frame.timestamp);
    write_csv(app, &settings, frame.timestamp, &values);
}

/// Settings that change what we log or show take effect on the next frame.
pub fn on_settings_changed(app: &AppHandle, previous: &UserSettings, next: &UserSettings) {
    let m = app.state::<Monitor>();
    let csv_changed = serde_json::to_string(&previous.csv_log).ok() != serde_json::to_string(&next.csv_log).ok()
        || previous.temperature_unit != next.temperature_unit;
    if csv_changed {
        *m.csv.lock().unwrap() = None;
        *m.csv_error.lock().unwrap() = None;
    }
    if previous.tray_sensor_id != next.tray_sensor_id && next.tray_sensor_id.is_none() {
        reset_tray(app);
    }
}

// ---------- tray ----------

/// 5x7 bitmap digits (each row is 5 bits, most significant bit on the left).
const GLYPHS: [[u8; 7]; 11] = [
    [0x0E, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0E], // 0
    [0x04, 0x0C, 0x04, 0x04, 0x04, 0x04, 0x0E], // 1
    [0x0E, 0x11, 0x01, 0x02, 0x04, 0x08, 0x1F], // 2
    [0x1F, 0x02, 0x04, 0x02, 0x01, 0x11, 0x0E], // 3
    [0x02, 0x06, 0x0A, 0x12, 0x1F, 0x02, 0x02], // 4
    [0x1F, 0x10, 0x1E, 0x01, 0x01, 0x11, 0x0E], // 5
    [0x06, 0x08, 0x10, 0x1E, 0x11, 0x11, 0x0E], // 6
    [0x1F, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08], // 7
    [0x0E, 0x11, 0x11, 0x0E, 0x11, 0x11, 0x0E], // 8
    [0x0E, 0x11, 0x11, 0x0F, 0x01, 0x02, 0x0C], // 9
    [0x00, 0x00, 0x00, 0x1F, 0x00, 0x00, 0x00], // -
];
const GLYPH_W: usize = 5;
const GLYPH_H: usize = 7;

fn hex_rgb(hex: &str) -> [u8; 3] {
    let n = u32::from_str_radix(hex.trim_start_matches('#'), 16).unwrap_or(0xFFFFFF);
    [(n >> 16) as u8, (n >> 8) as u8, n as u8]
}

/// Renders up to three characters as large as they fit on a transparent square icon.
fn render_icon(text: &str, color: [u8; 3]) -> Image<'static> {
    let size = CONFIG.tray.icon_size_px as usize;
    let mut rgba = vec![0u8; size * size * 4];
    let chars: Vec<usize> = text.chars().filter_map(|c| if c == '-' { Some(10) } else { c.to_digit(10).map(|d| d as usize) }).take(3).collect();
    if !chars.is_empty() {
        let n = chars.len();
        let scale = (size / (n * (GLYPH_W + 1))).min(size / GLYPH_H).max(1);
        let total_w = n * GLYPH_W * scale + (n - 1) * scale;
        let x0 = size.saturating_sub(total_w) / 2;
        let y0 = size.saturating_sub(GLYPH_H * scale) / 2;
        for (i, g) in chars.iter().enumerate() {
            let gx = x0 + i * (GLYPH_W + 1) * scale;
            for (row, bits) in GLYPHS[*g].iter().enumerate() {
                for col in 0..GLYPH_W {
                    if bits & (1 << (GLYPH_W - 1 - col)) == 0 {
                        continue;
                    }
                    for dy in 0..scale {
                        for dx in 0..scale {
                            let (x, y) = (gx + col * scale + dx, y0 + row * scale + dy);
                            if x < size && y < size {
                                let p = (y * size + x) * 4;
                                rgba[p..p + 4].copy_from_slice(&[color[0], color[1], color[2], 255]);
                            }
                        }
                    }
                }
            }
        }
    }
    Image::new_owned(rgba, size as u32, size as u32)
}

fn reset_tray(app: &AppHandle) {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let _ = tray.set_icon(app.default_window_icon().cloned());
        let _ = tray.set_tooltip(Some(&CONFIG.tray.fallback_tooltip));
    }
}

/// Windows cuts tray tooltips at 127 characters.
const TOOLTIP_MAX_CHARS: usize = 127;

/// Hottest temperature of each CPU and GPU, e.g. "CPU 54 °C", so the tooltip is useful without a tray sensor.
fn headline_temps(sensors: &HashMap<String, SensorMeta>, values: &HashMap<&str, f64>, unit: &str) -> Vec<String> {
    let mut hottest: Vec<(&str, &str, f64)> = vec![];
    for (id, m) in sensors {
        let label = match m.hardware_type.as_str() {
            "Cpu" => "CPU",
            t if t.starts_with("Gpu") => "GPU",
            _ => continue,
        };
        if m.sensor_type != "Temperature" {
            continue;
        }
        let Some(&v) = values.get(id.as_str()) else { continue };
        match hottest.iter_mut().find(|h| h.1 == m.hardware) {
            Some(h) => h.2 = h.2.max(v),
            None => hottest.push((label, &m.hardware, v)),
        }
    }
    hottest.sort_by(|a, b| a.0.cmp(b.0).then(a.1.cmp(b.1)));
    hottest.iter().map(|(label, _, v)| format!("{label} {}", format("Temperature", *v, unit))).collect()
}

fn update_tray(app: &AppHandle, s: &UserSettings, values: &HashMap<&str, f64>) {
    let Some(tray) = app.tray_by_id(TRAY_ID) else { return };
    let monitor = app.state::<Monitor>();
    let sensors = monitor.sensors.lock().unwrap();
    let unit = temp_unit(s);
    let mut lines = vec![];
    let picked = s.tray_sensor_id.as_deref().and_then(|id| Some((sensors.get(id)?, values.get(id)?)));
    if let Some((meta, v)) = picked {
        let shown = convert(&meta.sensor_type, *v, unit).round() as i64;
        let color = hex_rgb(s.tray_text_color.as_deref().unwrap_or(&DEFAULT_TRAY_COLOR));
        let _ = tray.set_icon(Some(render_icon(&shown.to_string(), color)));
        lines.push(format!("{}: {}", meta.name, format(&meta.sensor_type, *v, unit)));
    }
    lines.extend(headline_temps(&sensors, values, unit));
    let text = if lines.is_empty() { CONFIG.tray.fallback_tooltip.clone() } else { lines.join("\n") };
    let _ = tray.set_tooltip(Some(&text.chars().take(TOOLTIP_MAX_CHARS).collect::<String>()));
}

// ---------- alerts ----------

fn check_alerts(app: &AppHandle, s: &UserSettings, values: &HashMap<&str, f64>, ts: i64) {
    let Some(rules) = &s.alerts else { return };
    let m = app.state::<Monitor>();
    let unit = temp_unit(s);
    let cooldown = Duration::from_secs(CONFIG.alerts.cooldown_seconds as u64);
    for rule in rules.iter().filter(|r| r.enabled) {
        let Some(v) = values.get(rule.sensor_id.as_str()).copied() else { continue };
        let breach = match (rule.above, rule.below) {
            (Some(hi), _) if v > hi => Some(("above", hi)),
            (_, Some(lo)) if v < lo => Some(("below", lo)),
            _ => None,
        };
        let Some((dir, limit)) = breach else { continue };
        {
            let mut last = m.last_alert.lock().unwrap();
            if last.get(&rule.sensor_id).is_some_and(|t| t.elapsed() < cooldown) {
                continue;
            }
            last.insert(rule.sensor_id.clone(), Instant::now());
        }
        let sensors = m.sensors.lock().unwrap();
        let Some(meta) = sensors.get(&rule.sensor_id) else { continue };
        let body = format!(
            "{} ({}) is {}, {} the {} limit.",
            meta.name,
            meta.hardware,
            format(&meta.sensor_type, v, unit),
            dir,
            format(&meta.sensor_type, limit, unit)
        );
        drop(sensors);
        notify(app, &body);
        record_alert(app, ts, body);
    }
}

// ---------- alert history: alert-history.json next to settings.json ----------

fn alert_log_path() -> PathBuf {
    app_data_dir().join("alert-history.json")
}

fn with_alert_log<T>(app: &AppHandle, f: impl FnOnce(&mut VecDeque<AlertEntry>) -> T) -> T {
    let m = app.state::<Monitor>();
    let mut guard = m.alert_log.lock().unwrap();
    let log = guard.get_or_insert_with(|| {
        std::fs::read_to_string(alert_log_path()).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
    });
    f(log)
}

fn save_alert_log(app: &AppHandle, log: &VecDeque<AlertEntry>) {
    if let Ok(json) = serde_json::to_string(log) {
        let _ = std::fs::create_dir_all(app_data_dir());
        let _ = std::fs::write(alert_log_path(), json);
    }
    let _ = app.emit(EVENT_ALERTS, ());
}

fn record_alert(app: &AppHandle, time: i64, text: String) {
    with_alert_log(app, |log| {
        log.push_front(AlertEntry { time, text });
        log.truncate(CONFIG.history.max_alerts as usize);
        save_alert_log(app, log);
    });
}

/// Newest first.
#[tauri::command]
pub fn alert_history(app: AppHandle) -> Vec<AlertEntry> {
    with_alert_log(&app, |log| log.iter().cloned().collect())
}

#[tauri::command]
pub fn clear_alert_history(app: AppHandle) {
    with_alert_log(&app, |log| {
        log.clear();
        save_alert_log(&app, log);
    });
}

fn notify(app: &AppHandle, body: &str) {
    let _ = app.notification().builder().title(format!("{} alert", CONFIG.app_name)).body(body).show();
}

#[tauri::command]
pub fn test_alert(app: AppHandle) {
    notify(&app, "This is a test alert. Threshold alerts will look like this.");
}

// ---------- CSV logging ----------

#[repr(C)]
#[derive(Default)]
struct SystemTime {
    year: u16,
    month: u16,
    day_of_week: u16,
    day: u16,
    hour: u16,
    minute: u16,
    second: u16,
    millis: u16,
}

#[link(name = "kernel32")]
unsafe extern "system" {
    fn FileTimeToLocalFileTime(utc: *const u64, local: *mut u64) -> i32;
    fn FileTimeToSystemTime(ft: *const u64, st: *mut SystemTime) -> i32;
}

/// Unix milliseconds to local wall-clock time, via Win32 so no date crate is needed.
fn local_time(unix_ms: i64) -> SystemTime {
    const UNIX_EPOCH_AS_FILETIME: u64 = 116_444_736_000_000_000;
    const TICKS_PER_MS: u64 = 10_000;
    let utc = UNIX_EPOCH_AS_FILETIME + unix_ms as u64 * TICKS_PER_MS;
    let mut local = 0u64;
    let mut st = SystemTime::default();
    unsafe {
        FileTimeToLocalFileTime(&utc, &mut local);
        FileTimeToSystemTime(&local, &mut st);
    }
    st
}

/// Supports %Y %m %d %H %M %S, which is all csvLog.timestampFormat uses.
fn format_time(fmt: &str, t: &SystemTime) -> String {
    fmt.replace("%Y", &format!("{:04}", t.year))
        .replace("%m", &format!("{:02}", t.month))
        .replace("%d", &format!("{:02}", t.day))
        .replace("%H", &format!("{:02}", t.hour))
        .replace("%M", &format!("{:02}", t.minute))
        .replace("%S", &format!("{:02}", t.second))
}

fn csv_field(s: &str, delim: &str) -> String {
    if s.contains(delim) || s.contains('"') || s.contains('\n') { format!("\"{}\"", s.replace('"', "\"\"")) } else { s.to_string() }
}

fn open_csv(app: &AppHandle, folder: &str, ids: &[String], unit: &str, now_ms: i64) -> std::io::Result<CsvLog> {
    let c = &CONFIG.csv_log;
    let t = local_time(now_ms);
    let name = format!("{}_{}.csv", c.file_prefix, format_time("%Y%m%d_%H%M%S", &t));
    let path = PathBuf::from(folder).join(name);
    let mut out = BufWriter::new(File::create(&path)?);
    out.write_all(b"\xEF\xBB\xBF")?; // UTF-8 BOM so Excel shows the degree sign correctly
    let monitor = app.state::<Monitor>();
    let sensors = monitor.sensors.lock().unwrap();
    let mut header = vec!["Timestamp".to_string()];
    for id in ids {
        header.push(match sensors.get(id) {
            Some(m) => {
                let u = unit_label(&m.sensor_type, unit);
                csv_field(&if u.is_empty() { format!("{} [{}]", m.name, m.hardware) } else { format!("{} [{}] ({})", m.name, m.hardware, u) }, &c.delimiter)
            }
            None => csv_field(id, &c.delimiter),
        });
    }
    write!(out, "{}\r\n", header.join(&c.delimiter))?;
    out.flush()?;
    Ok(CsvLog { path, out, ids: ids.to_vec(), last_row: None })
}

fn write_csv(app: &AppHandle, s: &UserSettings, ts: i64, values: &HashMap<&str, f64>) {
    let Some(cfg) = &s.csv_log else { return };
    let m = app.state::<Monitor>();
    let mut guard = m.csv.lock().unwrap();
    let Some(folder) = cfg.folder.as_deref().filter(|f| cfg.enabled && !cfg.sensor_ids.is_empty() && std::path::Path::new(f).is_absolute()) else {
        *guard = None;
        return;
    };
    let unit = temp_unit(s);
    if guard.is_none() {
        match open_csv(app, folder, &cfg.sensor_ids, unit, ts) {
            Ok(log) => *guard = Some(log),
            Err(e) => {
                *m.csv_error.lock().unwrap() = Some(format!("Could not create a log file in {folder}: {e}"));
                return;
            }
        }
    }
    let log = guard.as_mut().unwrap();
    let interval = Duration::from_millis(CONFIG.csv_log.interval_ms as u64);
    if log.last_row.is_some_and(|t| t.elapsed() + Duration::from_millis(50) < interval) {
        return;
    }
    log.last_row = Some(Instant::now());
    let sensors = m.sensors.lock().unwrap();
    let delim = &CONFIG.csv_log.delimiter;
    let mut row = vec![format_time(&CONFIG.csv_log.timestamp_format, &local_time(ts))];
    for id in &log.ids {
        row.push(match (values.get(id.as_str()), sensors.get(id)) {
            (Some(v), Some(meta)) => format!("{:.3}", convert(&meta.sensor_type, *v, unit)),
            _ => String::new(),
        });
    }
    let result = write!(log.out, "{}\r\n", row.join(delim)).and_then(|_| log.out.flush());
    if let Err(e) = result {
        *m.csv_error.lock().unwrap() = Some(format!("Writing {} failed: {e}", log.path.display()));
        *guard = None;
    }
}

#[derive(serde::Serialize)]
pub struct CsvStatus {
    path: Option<String>,
    error: Option<String>,
}

#[tauri::command]
pub fn csv_status(app: AppHandle) -> CsvStatus {
    let m = app.state::<Monitor>();
    let path = m.csv.lock().unwrap().as_ref().map(|l| l.path.to_string_lossy().into_owned());
    let error = m.csv_error.lock().unwrap().clone();
    CsvStatus { path, error }
}

// ---------- reading past CSV logs for the History page ----------

#[derive(serde::Serialize)]
pub struct LogFile {
    name: String,
    bytes: u64,
    modified: i64,
}

/// Only files we write ourselves: the configured folder, our prefix, .csv, no path parts.
fn log_path(app: &AppHandle, name: Option<&str>) -> Result<PathBuf, String> {
    let s = app.state::<SettingsState>().get();
    let folder = s.csv_log.and_then(|c| c.folder).filter(|f| std::path::Path::new(f).is_absolute()).ok_or("Choose a log folder in Settings first.")?;
    let Some(name) = name else { return Ok(PathBuf::from(folder)) };
    let ok = name.starts_with(&CONFIG.csv_log.file_prefix) && name.ends_with(".csv") && !name.contains(['/', '\\', ':']) && !name.contains("..");
    if ok { Ok(PathBuf::from(folder).join(name)) } else { Err(format!("not a {} log file: {name}", CONFIG.app_name)) }
}

/// Newest first.
#[tauri::command]
pub fn list_logs(app: AppHandle) -> Result<Vec<LogFile>, String> {
    let dir = log_path(&app, None)?;
    let Ok(entries) = std::fs::read_dir(&dir) else { return Ok(vec![]) };
    let mut files: Vec<LogFile> = entries
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().into_string().ok()?;
            log_path(&app, Some(&name)).ok()?;
            let meta = e.metadata().ok()?;
            let modified = meta.modified().ok()?.duration_since(std::time::UNIX_EPOCH).ok()?.as_millis() as i64;
            Some(LogFile { name, bytes: meta.len(), modified })
        })
        .collect();
    files.sort_by(|a, b| b.modified.cmp(&a.modified));
    Ok(files)
}

#[tauri::command]
pub fn read_log(app: AppHandle, name: String) -> Result<String, String> {
    let path = log_path(&app, Some(&name))?;
    let len = std::fs::metadata(&path).map_err(|e| e.to_string())?.len();
    let max = CONFIG.history.max_log_bytes as u64;
    if len > max {
        return Err(format!("{name} is larger than {} MB, too big to chart.", max / 1_048_576));
    }
    std::fs::read_to_string(&path).map(|s| s.trim_start_matches('\u{FEFF}').to_string()).map_err(|e| e.to_string())
}
