import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { AlertRule, CsvLogSettings } from "../generated/schema-types";
import { config } from "../lib/config";
import { convert, toNative, unitLabel } from "../lib/format";
import { ipc } from "../lib/ipc";
import { settings, useSettings } from "../lib/settings";
import { useDashboards } from "../lib/dashboards";
import { useTelemetryMeta } from "../lib/telemetry";
import { overlayOptions } from "../Overlay";
import type { OverlayCorner, OverlaySettings } from "../generated/schema-types";

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
          <span className="w-40 text-muted">Polling interval</span>
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
      </Section>

      <Section title="Tray and overlay">
        <div className="flex items-center gap-3 text-sm">
          <span className="w-40 shrink-0 text-muted">Tray icon value</span>
          <SensorSelect value={s.traySensorId ?? null} allowNone label="Tray sensor" onChange={(id) => save({ traySensorId: id })} />
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="w-40 shrink-0 text-muted">Overlay dashboard</span>
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
          Scale the dashboard to fit the overlay
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
      </Section>

      <Section title="Alerts">
        <p className="text-sm text-muted">Windows notifications when a sensor crosses a limit, at most once every {config.alerts.cooldownSeconds} seconds per sensor.</p>
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
