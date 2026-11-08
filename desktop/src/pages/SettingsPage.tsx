import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { AlertRule, AppDashboardRule, CsvLogSettings } from "../generated/schema-types";
import { config } from "../lib/config";
import { convert, toNative, unitLabel } from "../lib/format";
import { ipc } from "../lib/ipc";
import { settings, useSettings } from "../lib/settings";
import { useDashboards } from "../lib/dashboards";
import { useTelemetryMeta } from "../lib/telemetry";
import { fitOverlay, overlayOptions } from "../Overlay";
import type { OverlayCorner, OverlaySettings } from "../generated/schema-types";
import { UpdateCheck } from "../components/UpdateCheck";

const CORNERS: [OverlayCorner, string][] = [
  ["top-left", "Top left"],
  ["top-right", "Top right"],
  ["bottom-left", "Bottom left"],
  ["bottom-right", "Bottom right"],
];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="panel flex flex-col gap-3 p-4">
      <h2 className="font-semibold text-accent">{title}</h2>
      {children}
    </section>
  );
}

/** A select of every sensor, grouped by hardware. */
function SensorSelect({ value, onChange, label, allowNone }: { value: string | null; onChange: (id: string | null) => void; label: string; allowNone?: boolean }) {
  const t = useTelemetryMeta();
  const groups = useMemo(() => (t.catalog?.hardware ?? []).map((h) => ({ h, sensors: (t.catalog?.sensors ?? []).filter((s) => s.hardwareId === h.id) })).filter((g) => g.sensors.length), [t.catalog]);
  return (
    <select className="field min-w-0 flex-1" value={value ?? ""} onChange={(e) => onChange(e.target.value || null)} aria-label={label}>
      {allowNone && <option value="">None</option>}
      {!allowNone && !value && <option value="">Pick a sensor</option>}
      {value && !t.sensors.has(value) && <option value={value}>Not on this machine: {value}</option>}
      {groups.map(({ h, sensors }) => (
        <optgroup key={h.id} label={h.name}>
          {sensors.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} ({s.sensorType})
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

interface MonitorInfo {
  name: string;
  label: string;
  primary: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The monitors drawn the way Windows arranges them. Click a screen to show or hide the overlay on it. */
function MonitorPicker({ value, onChange }: { value: string[]; onChange: (names: string[]) => void }) {
  const [monitors, setMonitors] = useState<MonitorInfo[]>([]);
  useEffect(() => {
    invoke<MonitorInfo[]>("list_monitors").then(setMonitors).catch(() => setMonitors([]));
  }, []);
  if (!monitors.length) return <span className="text-muted">No monitors found</span>;
  // Names saved for a monitor that is unplugged are ignored; with none left, the primary monitor is used.
  const live = value.filter((n) => monitors.some((m) => m.name === n));
  const isOn = (m: MonitorInfo) => (live.length ? live.includes(m.name) : m.primary);
  const on = monitors.filter(isOn).map((m) => m.name);
  const toggle = (m: MonitorInfo) => {
    const next = on.includes(m.name) ? on.filter((n) => n !== m.name) : [...on, m.name];
    if (next.length) onChange(next); // at least one monitor always shows the overlay
  };
  const minX = Math.min(...monitors.map((m) => m.x));
  const minY = Math.min(...monitors.map((m) => m.y));
  const spanX = Math.max(...monitors.map((m) => m.x + m.width)) - minX;
  const spanY = Math.max(...monitors.map((m) => m.y + m.height)) - minY;
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <div className="relative h-24 max-w-full flex-1" style={{ aspectRatio: `${spanX} / ${spanY}`, flexGrow: 0, flexBasis: "auto" }}>
        {monitors.map((m) => (
          <button
            key={m.name}
            aria-pressed={isOn(m)}
            data-tip={`${isOn(m) ? "Hide" : "Show"} the overlay on ${m.label}`}
            className={`absolute flex flex-col items-center justify-center rounded-theme border text-xs ${isOn(m) ? "border-accent bg-accent text-accent-text" : "border-border bg-surface text-muted hover:border-accent"}`}
            style={{ left: `${((m.x - minX) / spanX) * 100}%`, top: `${((m.y - minY) / spanY) * 100}%`, width: `calc(${(m.width / spanX) * 100}% - 3px)`, height: `calc(${(m.height / spanY) * 100}% - 3px)` }}
            onClick={() => toggle(m)}
          >
            <span className="font-semibold">{m.label.replace("Display ", "")}</span>
            <span className="text-[10px]">
              {m.width}x{m.height}
              {m.primary ? " main" : ""}
            </span>
          </button>
        ))}
      </div>
      {monitors.length > 1 && (
        <button className="btn ml-auto" data-tip="Show the overlay on every monitor" onClick={() => onChange(monitors.map((m) => m.name))}>
          All
        </button>
      )}
    </div>
  );
}

/** "While game.exe runs, the overlay shows Gaming." The first matching rule wins. */
function AppRules({ rules, onChange }: { rules: AppDashboardRule[]; onChange: (r: AppDashboardRule[]) => void }) {
  const store = useDashboards();
  const [running, setRunning] = useState<string[]>([]);
  const refresh = () => invoke<string[]>("running_apps").then(setRunning);
  useEffect(() => void refresh(), []);
  const set = (i: number, patch: Partial<AppDashboardRule>) => onChange(rules.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="flex flex-col gap-2 text-sm">
      <span className="text-muted" data-tip="Type a program's file name, like game.exe, or pick one that is running now. Checked every few seconds.">
        Per-app dashboards: while a program runs, the overlay switches to its dashboard, then switches back when it closes.
      </span>
      <datalist id="running-apps">
        {running.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
      {rules.map((r, i) => (
        <div key={`${i}-${r.exe}`} className="flex items-center gap-2">
          <input className="field flex-1" list="running-apps" placeholder="game.exe" defaultValue={r.exe} onFocus={refresh} onBlur={(e) => e.target.value.trim() && set(i, { exe: e.target.value.trim() })} aria-label="Program file name" />
          <span className="text-muted">shows</span>
          <select className="field flex-1" value={r.dashboardId} onChange={(e) => set(i, { dashboardId: e.target.value })} aria-label="Dashboard for this program">
            {store.list.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <button className="btn" onClick={() => onChange(rules.filter((_, j) => j !== i))}>
            Remove
          </button>
        </div>
      ))}
      <div>
        <button className="btn" disabled={!store.list.length} onClick={() => onChange([...rules, { exe: "game.exe", dashboardId: store.list[0].id }])}>
          Add program
        </button>
      </div>
    </div>
  );
}

function AlertRow({ rule, onChange, onRemove }: { rule: AlertRule; onChange: (r: AlertRule) => void; onRemove: () => void }) {
  const t = useTelemetryMeta();
  const type = t.sensors.get(rule.sensorId)?.sensorType;
  const unit = settings.temperatureUnit;
  const shown = (v: number | null) => (v === null ? "" : String(+convert(type, v, unit).toFixed(2)));
  const parse = (text: string) => (text.trim() === "" || Number.isNaN(parseFloat(text)) ? null : toNative(type, parseFloat(text), unit));
  const [above, setAbove] = useState(shown(rule.above));
  const [below, setBelow] = useState(shown(rule.below));
  const label = unitLabel(type, unit);
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <input type="checkbox" checked={rule.enabled} onChange={(e) => onChange({ ...rule, enabled: e.target.checked })} aria-label="Alert enabled" />
      <SensorSelect value={rule.sensorId} label="Alert sensor" onChange={(id) => id && onChange({ ...rule, sensorId: id })} />
      <label className="flex items-center gap-1">
        above
        <input className="field w-20" inputMode="decimal" value={above} onChange={(e) => setAbove(e.target.value)} onBlur={() => onChange({ ...rule, above: parse(above) })} />
        {label}
      </label>
      <label className="flex items-center gap-1">
        below
        <input className="field w-20" inputMode="decimal" value={below} onChange={(e) => setBelow(e.target.value)} onBlur={() => onChange({ ...rule, below: parse(below) })} />
        {label}
      </label>
      <button className="btn" onClick={onRemove} aria-label="Remove alert">
        Remove
      </button>
    </div>
  );
}

export function SettingsPage() {
  const s = useSettings();
  const t = useTelemetryMeta();
  const store = useDashboards();
  const [error, setError] = useState<string | null>(null);
  const [csv, setCsv] = useState<{ path: string | null; error: string | null }>({ path: null, error: null });

  useEffect(() => {
    const poll = () => invoke<{ path: string | null; error: string | null }>("csv_status").then(setCsv);
    poll();
    const id = setInterval(poll, config.polling.defaultIntervalMs);
    return () => clearInterval(id);
  }, []);

  const save = async (patch: Parameters<typeof settings.update>[0]) => {
    try {
      setError(null);
      await settings.update(patch);
    } catch (e) {
      setError(String(e));
    }
  };

  const unit = settings.temperatureUnit;
  const interval = s.pollIntervalMs ?? config.polling.defaultIntervalMs;
  const alerts = s.alerts ?? [];
  const log: CsvLogSettings = s.csvLog ?? { enabled: false, folder: null, sensorIds: [] };
  const setAlerts = (next: AlertRule[]) => save({ alerts: next });
  const ov = overlayOptions(s);
  const setOverlay = (patch: OverlaySettings) => save({ overlay: { ...(s.overlay ?? {}), ...patch } });
  const px = (text: string) => Math.max(config.overlay.minSizePx, parseInt(text, 10) || config.overlay.minSizePx);
  const overlayDash = store.get(s.overlayDashboardId ?? undefined) ?? store.active();
  const overlayHidden = overlayDash ? fitOverlay(overlayDash, ov.heightPx, ov).hidden : 0;
  const defaultAlertSensor = t.catalog?.sensors.find((x) => x.sensorType === "Temperature")?.id;

  return (
    <div className="grid h-full content-start gap-3 overflow-auto lg:grid-cols-2">
      {error && <p className="text-sm text-critical lg:col-span-2">{error}</p>}
      <Section title="General">
        <div className="flex items-center gap-3 text-sm">
          <span className="w-40 text-muted">Temperature unit</span>
          {(["C", "F"] as const).map((u) => (
            <label key={u} className="flex items-center gap-1">
              <input type="radio" name="unit" checked={unit === u} onChange={() => save({ temperatureUnit: u })} />°{u}
            </label>
          ))}
        </div>
        <label className="flex items-center gap-3 text-sm">
          <span className="w-40 text-muted" data-tip="How often sensors are read. Faster updates use a little more CPU.">Polling interval</span>
          <input
            type="range"
            min={config.polling.minIntervalMs}
            max={config.polling.maxIntervalMs}
            step={config.polling.minIntervalMs}
            value={interval}
            onChange={(e) => save({ pollIntervalMs: parseInt(e.target.value, 10) })}
            className="flex-1"
          />
          <span className="w-16 text-right tabular-nums">{interval} ms</span>
        </label>
        <label className="flex items-center gap-3 text-sm">
          <input type="checkbox" checked={s.startMinimized ?? config.startup.startMinimized} onChange={(e) => save({ startMinimized: e.target.checked })} />
          Start minimized to the tray
        </label>
        <label className="flex items-center gap-3 text-sm">
          <input type="checkbox" checked={s.startWithWindows ?? config.startup.startWithWindows} onChange={(e) => save({ startWithWindows: e.target.checked })} />
          Start with Windows
        </label>
        <UpdateCheck />
      </Section>

      <Section title="Tray and overlay">
        <div className="flex items-center gap-3 text-sm">
          <span className="w-40 shrink-0 text-muted" data-tip="Shows this sensor as digits in the Windows tray icon.">Tray icon value</span>
          <SensorSelect value={s.traySensorId ?? null} allowNone label="Tray sensor" onChange={(id) => save({ traySensorId: id })} />
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="w-40 shrink-0 text-muted" data-tip="Which dashboard the in-game overlay shows. The Compact overlay preset is made for this.">Overlay dashboard</span>
          <select className="field flex-1" value={s.overlayDashboardId ?? ""} onChange={(e) => save({ overlayDashboardId: e.target.value || null })} aria-label="Overlay dashboard">
            <option value="">Active dashboard</option>
            {store.list.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="w-40 shrink-0 text-muted">Overlay hotkey</span>
          <kbd className="rounded-theme border border-border px-2 py-0.5">{config.overlay.hotkey.replace("CommandOrControl", "Ctrl")}</kbd>
          <button className="btn ml-auto" onClick={() => invoke("toggle_overlay_cmd")}>
            Toggle overlay now
          </button>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="w-40 shrink-0 text-muted">Overlay size (px)</span>
          <input className="field w-24" type="number" min={config.overlay.minSizePx} defaultValue={ov.widthPx} key={`w${ov.widthPx}`} onBlur={(e) => setOverlay({ widthPx: px(e.target.value) })} aria-label="Overlay width" />
          <span className="text-muted">by</span>
          <input className="field w-24" type="number" min={config.overlay.minSizePx} defaultValue={ov.heightPx} key={`h${ov.heightPx}`} onBlur={(e) => setOverlay({ heightPx: px(e.target.value) })} aria-label="Overlay height" />
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="w-40 shrink-0 text-muted" data-tip="Click a screen to turn the overlay on or off for it. Each chosen screen gets its own copy.">
            Show overlay on
          </span>
          <MonitorPicker value={s.overlay?.monitors ?? []} onChange={(monitors) => setOverlay({ monitors })} />
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="w-40 shrink-0 text-muted">Overlay position</span>
          <select className="field flex-1" value={ov.corner} onChange={(e) => setOverlay({ corner: e.target.value as OverlayCorner })} aria-label="Overlay position">
            {CORNERS.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-3 text-sm">
          <input type="checkbox" checked={ov.fit} onChange={(e) => setOverlay({ fit: e.target.checked })} />
          <span data-tip="Shrinks the dashboard to fit the overlay, down to a readable minimum. Below that, widgets are hidden instead.">
          Scale the dashboard to fit the overlay</span>
        </label>
        <label className="flex items-center gap-3 text-sm">
          <span className="w-40 shrink-0 text-muted">Overlay scale</span>
          <input type="range" className="flex-1" min={config.overlay.minScale} max={config.overlay.maxScale} step={0.05} value={ov.scale} disabled={ov.fit} onChange={(e) => setOverlay({ scale: parseFloat(e.target.value) })} />
          <span className="w-12 text-right tabular-nums">{ov.fit ? "auto" : `${Math.round(ov.scale * 100)}%`}</span>
        </label>
        <label className="flex items-center gap-3 text-sm">
          <span className="w-40 shrink-0 text-muted">Overlay opacity</span>
          <input type="range" className="flex-1" min={config.overlay.minOpacity} max={1} step={0.05} value={ov.opacity} onChange={(e) => setOverlay({ opacity: parseFloat(e.target.value) })} />
          <span className="w-12 text-right tabular-nums">{Math.round(ov.opacity * 100)}%</span>
        </label>
        <p className={`text-xs ${overlayHidden ? "text-warning" : "text-muted"}`}>
          {overlayHidden
            ? `At this size ${overlayHidden} widget${overlayHidden === 1 ? " is" : "s are"} hidden. The overlay hides whole widgets, lowest on the dashboard first, instead of cutting them off. Make the overlay taller or move important widgets up.`
            : "Every widget fits. If the overlay gets too small, whole widgets are hidden, lowest on the dashboard first."}
        </p>
        <AppRules rules={s.appDashboards ?? []} onChange={(appDashboards) => save({ appDashboards })} />
      </Section>

      <Section title="Alerts">
        <p className="text-sm text-muted">Windows notifications when a sensor crosses a limit, at most once every {config.alerts.cooldownSeconds} seconds per sensor. Past alerts are listed on the History page.</p>
        {alerts.map((rule, i) => (
          <AlertRow
            key={`${i}-${rule.sensorId}`}
            rule={rule}
            onChange={(r) => setAlerts(alerts.map((x, j) => (j === i ? r : x)))}
            onRemove={() => setAlerts(alerts.filter((_, j) => j !== i))}
          />
        ))}
        <div className="flex gap-2">
          <button
            className="btn"
            disabled={!defaultAlertSensor}
            onClick={() => defaultAlertSensor && setAlerts([...alerts, { sensorId: defaultAlertSensor, enabled: true, above: config.alerts.defaultCritical, below: null }])}
          >
            Add alert
          </button>
          <button className="btn" onClick={() => invoke("test_alert")}>
            Send test alert
          </button>
        </div>
      </Section>

      <Section title="CSV logging">
        <div className="flex items-center gap-3 text-sm">
          <span className="w-40 shrink-0 text-muted">Folder</span>
          <span className="selectable min-w-0 flex-1 truncate">{log.folder ?? "Not chosen"}</span>
          <button className="btn" onClick={async () => { const folder = await ipc.pickFolder(); if (folder) save({ csvLog: { ...log, folder } }); }}>
            Choose folder
          </button>
        </div>
        <div className="flex flex-col gap-1 text-sm">
          <span className="text-muted">Sensors to log ({log.sensorIds.length})</span>
          {log.sensorIds.map((id, i) => (
            <div key={`${i}-${id}`} className="flex gap-2">
              <SensorSelect value={id} label="Logged sensor" onChange={(next) => next && save({ csvLog: { ...log, sensorIds: log.sensorIds.map((x, j) => (j === i ? next : x)) } })} />
              <button className="btn" onClick={() => save({ csvLog: { ...log, sensorIds: log.sensorIds.filter((_, j) => j !== i) } })}>
                Remove
              </button>
            </div>
          ))}
          <SensorSelect value={null} label="Add logged sensor" onChange={(id) => id && !log.sensorIds.includes(id) && save({ csvLog: { ...log, sensorIds: [...log.sensorIds, id] } })} />
        </div>
        <label className="flex items-center gap-3 text-sm">
          <input type="checkbox" checked={log.enabled} disabled={!log.folder || log.sensorIds.length === 0} onChange={(e) => save({ csvLog: { ...log, enabled: e.target.checked } })} />
          Logging enabled
        </label>
        {csv.path && <p className="selectable text-xs text-success">Writing {csv.path}</p>}
        {csv.error && <p className="text-xs text-critical">{csv.error}</p>}
      </Section>
    </div>
  );
}
