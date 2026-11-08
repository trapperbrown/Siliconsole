//! Named pipe client. Connects to the sensor service, reconnects with backoff, and forwards every
//! service message to the webviews as Tauri events. The webview never touches the pipe.
use std::os::windows::process::CommandExt;
use std::process::Command;
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::value::RawValue;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::windows::named_pipe::ClientOptions;
use tokio::sync::mpsc;

use crate::config::CONFIG;
use crate::generated::{ClientHello, HistoryRequest, SensorCatalogMessage, SensorFrameMessage, ServiceHello, SetInterval};
use crate::storage::SettingsState;

pub const EVENT_STATUS: &str = "telemetry://status";
pub const EVENT_HELLO: &str = "telemetry://hello";
pub const EVENT_SYSTEM_INFO: &str = "telemetry://system_info";
pub const EVENT_CATALOG: &str = "telemetry://catalog";
pub const EVENT_FRAME: &str = "telemetry://frame";
pub const EVENT_HISTORY: &str = "telemetry://history";

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const SC_ERROR_SERVICE_DOES_NOT_EXIST: i32 = 1060;

#[derive(Serialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "snake_case")]
pub enum ConnState {
    Connected,
    Reconnecting,
    NotInstalled,
}

#[derive(Serialize, Clone, Debug)]
pub struct Status {
    pub state: ConnState,
    pub detail: Option<String>,
}

#[derive(Default)]
struct Cache {
    hello: Option<Box<RawValue>>,
    system_info: Option<Box<RawValue>>,
    catalog: Option<Box<RawValue>>,
}

pub struct Telemetry {
    status: Mutex<Status>,
    cache: Mutex<Cache>,
    tx: Mutex<Option<mpsc::UnboundedSender<Vec<u8>>>>,
    next_request_id: AtomicI64,
}

impl Default for Telemetry {
    fn default() -> Self {
        Self {
            status: Mutex::new(Status { state: ConnState::Reconnecting, detail: None }),
            cache: Mutex::default(),
            tx: Mutex::default(),
            next_request_id: AtomicI64::new(1),
        }
    }
}

impl Telemetry {
    fn send<T: Serialize>(&self, msg: &T) -> Result<(), String> {
        let tx = self.tx.lock().unwrap();
        let tx = tx.as_ref().ok_or("not connected to the sensor service")?;
        tx.send(encode(msg)?).map_err(|_| "connection closed".to_string())
    }

    pub fn set_interval(&self, interval_ms: i64) -> Result<(), String> {
        self.send(&SetInterval { r#type: "set_interval".into(), interval_ms })
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    status: Status,
    hello: Option<Box<RawValue>>,
    system_info: Option<Box<RawValue>>,
    catalog: Option<Box<RawValue>>,
}

/// Lets a webview that loads late (or reloads) catch up on state it missed as events.
#[tauri::command]
pub fn get_snapshot(state: State<Telemetry>) -> Snapshot {
    let cache = state.cache.lock().unwrap();
    Snapshot {
        status: state.status.lock().unwrap().clone(),
        hello: cache.hello.clone(),
        system_info: cache.system_info.clone(),
        catalog: cache.catalog.clone(),
    }
}

#[tauri::command]
pub fn request_history(state: State<Telemetry>, ids: Vec<String>, max_samples: Option<i64>) -> Result<i64, String> {
    let request_id = state.next_request_id.fetch_add(1, Ordering::Relaxed);
    state.send(&HistoryRequest { r#type: "history_request".into(), request_id, ids, max_samples })?;
    Ok(request_id)
}

fn encode<T: Serialize>(msg: &T) -> Result<Vec<u8>, String> {
    let json = serde_json::to_vec(msg).map_err(|e| e.to_string())?;
    let mut buf = Vec::with_capacity(4 + json.len());
    buf.extend_from_slice(&(json.len() as u32).to_le_bytes());
    buf.extend_from_slice(&json);
    Ok(buf)
}

async fn read_message<R: AsyncReadExt + Unpin>(r: &mut R) -> std::io::Result<Vec<u8>> {
    let len = r.read_u32_le().await? as usize;
    if len == 0 || len > CONFIG.ipc.max_message_bytes as usize {
        return Err(std::io::Error::new(std::io::ErrorKind::InvalidData, format!("bad message length {len}")));
    }
    let mut buf = vec![0u8; len];
    r.read_exact(&mut buf).await?;
    Ok(buf)
}

#[derive(Deserialize)]
struct TypeOnly<'a> {
    #[serde(borrow)]
    r#type: &'a str,
}

fn set_status(app: &AppHandle, state: ConnState, detail: Option<String>) {
    let t = app.state::<Telemetry>();
    let status = Status { state, detail };
    {
        let mut cur = t.status.lock().unwrap();
        if cur.state == status.state && cur.detail == status.detail {
            return;
        }
        *cur = status.clone();
    }
    let _ = app.emit(EVENT_STATUS, status);
    crate::monitor::on_status(app, state);
}

/// `Some(false)` only when the service control manager says the service does not exist.
fn service_installed() -> Option<bool> {
    let out = Command::new("sc.exe")
        .args(["query", &CONFIG.service.name])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .ok()?;
    Some(out.status.code() != Some(SC_ERROR_SERVICE_DOES_NOT_EXIST))
}

pub async fn run(app: AppHandle) {
    let r = &CONFIG.reconnect;
    let mut delay = r.initial_delay_ms as f64;
    let mut last_check: Option<(Instant, Option<bool>)> = None;
    loop {
        let result = session(&app).await;
        let was_connected = matches!(result, Ok(true));
        if was_connected {
            delay = r.initial_delay_ms as f64;
        }

        // Asking the SCM spawns a process, so only do it every serviceCheckIntervalMs.
        let installed = match last_check {
            Some((at, v)) if at.elapsed() < Duration::from_millis(r.service_check_interval_ms as u64) => v,
            _ => {
                let v = service_installed();
                last_check = Some((Instant::now(), v));
                v
            }
        };
        if installed == Some(false) {
            set_status(&app, ConnState::NotInstalled, None);
        } else {
            let detail = match result {
                Err(e) => e,
                Ok(_) => "Connection to the sensor service was lost".into(),
            };
            set_status(&app, ConnState::Reconnecting, Some(detail));
        }

        tokio::time::sleep(Duration::from_millis(delay as u64)).await;
        delay = (delay * r.multiplier).min(r.max_delay_ms as f64);
    }
}

/// One connection. Returns Ok(true) if the handshake succeeded before the connection ended.
async fn session(app: &AppHandle) -> Result<bool, String> {
    let path = format!(r"\\.\pipe\{}", CONFIG.ipc.pipe_name);
    let client = ClientOptions::new().open(&path).map_err(|e| match e.kind() {
        std::io::ErrorKind::NotFound => "The sensor service is not running".to_string(),
        _ => format!("Could not open the sensor pipe: {e}"),
    })?;
    let (mut rd, mut wr) = tokio::io::split(client);

    let hello = ClientHello { r#type: "hello".into(), protocol_version: CONFIG.ipc.protocol_version, client: CONFIG.app_name.clone() };
    wr.write_all(&encode(&hello)?).await.map_err(|e| e.to_string())?;

    let first = read_message(&mut rd).await.map_err(|e| e.to_string())?;
    let service_hello: ServiceHello = serde_json::from_slice(&first).map_err(|e| format!("unexpected handshake reply: {e}"))?;
    if service_hello.protocol_version != CONFIG.ipc.protocol_version {
        return Err(format!(
            "Protocol mismatch: the service speaks version {}, this app speaks {}. Reinstall to update both.",
            service_hello.protocol_version, CONFIG.ipc.protocol_version
        ));
    }

    let (tx, mut rx) = mpsc::unbounded_channel::<Vec<u8>>();
    let writer = tauri::async_runtime::spawn(async move {
        while let Some(buf) = rx.recv().await {
            if wr.write_all(&buf).await.is_err() {
                break;
            }
        }
    });
    let telemetry = app.state::<Telemetry>();
    *telemetry.tx.lock().unwrap() = Some(tx);

    let wanted = app.state::<SettingsState>().get().poll_interval_ms.unwrap_or(CONFIG.polling.default_interval_ms);
    if wanted != service_hello.interval_ms {
        let _ = telemetry.set_interval(wanted);
    }
    forward(app, EVENT_HELLO, first, |c, raw| c.hello = Some(raw));
    set_status(app, ConnState::Connected, None);

    loop {
        let Ok(bytes) = read_message(&mut rd).await else { break };
        let Ok(TypeOnly { r#type }) = serde_json::from_slice::<TypeOnly>(&bytes) else { continue };
        match r#type {
            "system_info" => forward(app, EVENT_SYSTEM_INFO, bytes, |c, raw| c.system_info = Some(raw)),
            "sensor_catalog" => {
                if let Ok(cat) = serde_json::from_slice::<SensorCatalogMessage>(&bytes) {
                    crate::monitor::on_catalog(app, cat);
                }
                forward(app, EVENT_CATALOG, bytes, |c, raw| c.catalog = Some(raw));
            }
            "sensor_frame" => {
                if let Ok(frame) = serde_json::from_slice::<SensorFrameMessage>(&bytes) {
                    crate::monitor::on_frame(app, &frame);
                }
                forward(app, EVENT_FRAME, bytes, |_, _| {});
            }
            "history_response" => forward(app, EVENT_HISTORY, bytes, |_, _| {}),
            _ => {}
        }
    }

    *telemetry.tx.lock().unwrap() = None;
    writer.abort();
    Ok(true)
}

/// Emits raw JSON to every webview without re-serializing, optionally caching it for snapshots.
fn forward(app: &AppHandle, event: &str, bytes: Vec<u8>, cache: impl FnOnce(&mut Cache, Box<RawValue>)) {
    let Ok(text) = String::from_utf8(bytes) else { return };
    let Ok(raw) = RawValue::from_string(text) else { return };
    cache(&mut app.state::<Telemetry>().cache.lock().unwrap(), raw.clone());
    let _ = app.emit(event, raw);
}
