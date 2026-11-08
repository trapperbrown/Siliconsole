import { useMemo, useState } from "react";
import type { Widget, WidgetSettings } from "../generated/schema-types";
import { config } from "../lib/config";
import { convert, toNative, unitLabel } from "../lib/format";
import { settings } from "../lib/settings";
import { useTelemetryMeta } from "../lib/telemetry";
import { WIDGETS } from "../widgets/registry";

type NumKey = "min" | "max" | "warning" | "critical";

/** Edits one widget. Range and thresholds are typed in display units and stored natively (Celsius). */
export function WidgetSettingsPanel({ widget, onSave, onClose }: { widget: Widget; onSave: (w: Widget) => void; onClose: () => void }) {
  const t = useTelemetryMeta();
  const kind = WIDGETS[widget.type];
  const [ids, setIds] = useState<string[]>(widget.sensorIds);
  const [s, setS] = useState<WidgetSettings>(widget.settings);
  const [query, setQuery] = useState("");
  const unit = settings.temperatureUnit;
  const sensorType = t.sensors.get(ids[0] ?? "")?.sensorType;

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = t.catalog?.sensors ?? [];
    const hits = all.filter((x) => !q || `${x.name} ${x.sensorType} ${t.hardware.get(x.hardwareId)?.name ?? ""}`.toLowerCase().includes(q));
    // Selected sensors first so the current binding is always visible.
    return [...hits.filter((x) => widget.sensorIds.includes(x.id)), ...hits.filter((x) => !widget.sensorIds.includes(x.id))];
  }, [query, t.catalog, widget.sensorIds]);

  const toggle = (id: string) => {
    if (!kind.multi) return setIds([id]);
    setIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : prev.length < config.dashboards.maxSensorsPerWidget ? [...prev, id] : prev));
  };

  const shown = (k: NumKey) => {
    const v = s[k];
    return v === null || v === undefined ? "" : String(+convert(sensorType, v, unit).toFixed(2));
  };
  const setNum = (k: NumKey, text: string) => {
    const n = parseFloat(text);
    setS({ ...s, [k]: text.trim() === "" || Number.isNaN(n) ? null : toNative(sensorType, n, unit) });
  };
  const unitHint = unitLabel(sensorType, unit);
  const has = (f: (typeof kind.fields)[number]) => kind.fields.includes(f);

  return (
    <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-bg/70 p-6" role="dialog" aria-modal aria-label={`${kind.label} settings`} onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div className="modal-card panel flex max-h-full w-[46rem] flex-col gap-3 bg-surface-solid p-4">
        <h2 className="font-semibold">{kind.label} settings</h2>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <label className="flex flex-col gap-1">
            Label
            <input className="field" value={s.label ?? ""} placeholder="Sensor name" maxLength={64} onChange={(e) => setS({ ...s, label: e.target.value || null })} />
          </label>
          {has("unit") && (
            <label className="flex flex-col gap-1">
              Unit label override
              <input className="field" value={s.unit ?? ""} placeholder={unitHint || "none"} maxLength={16} onChange={(e) => setS({ ...s, unit: e.target.value || null })} />
            </label>
          )}
          {has("decimals") && (
            <label className="flex flex-col gap-1">
              Decimals
              <input className="field" type="number" min={0} max={6} value={s.decimals ?? ""} placeholder={String(config.widgetDefaults.decimals)} onChange={(e) => setS({ ...s, decimals: e.target.value === "" ? null : Math.min(6, Math.max(0, parseInt(e.target.value, 10))) })} />
            </label>
          )}
          {has("history") && (
            <label className="flex flex-col gap-1">
              History window (seconds)
              <input className="field" type="number" min={1} value={s.historySeconds ?? ""} placeholder={String(config.widgetDefaults.historySeconds)} onChange={(e) => setS({ ...s, historySeconds: e.target.value === "" ? null : Math.max(1, parseInt(e.target.value, 10)) })} />
            </label>
          )}
          {has("range") &&
            (["min", "max"] as const).map((k) => (
              <label key={k} className="flex flex-col gap-1">
                {k === "min" ? "Range min" : "Range max"} {unitHint && <span className="text-muted">({unitHint})</span>}
                <input className="field" inputMode="decimal" value={shown(k)} placeholder="auto" onChange={(e) => setNum(k, e.target.value)} />
              </label>
            ))}
          {has("thresholds") &&
            (["warning", "critical"] as const).map((k) => (
              <label key={k} className="flex flex-col gap-1">
                <span className={k === "warning" ? "text-warning" : "text-critical"}>
                  {k === "warning" ? "Warning at" : "Critical at"} {unitHint && <span className="text-muted">({unitHint})</span>}
                </span>
                <input className="field" inputMode="decimal" value={shown(k)} placeholder="off" onChange={(e) => setNum(k, e.target.value)} />
              </label>
            ))}
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium">{kind.multi ? `Sensors (${ids.length} selected)` : "Sensor"}</span>
          <input className="field ml-auto w-64" placeholder="Search sensors" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search sensors" />
        </div>
        <div className="min-h-40 flex-1 overflow-auto rounded-theme border border-border">
          {matches.map((x) => (
            <label key={x.id} className="flex cursor-pointer items-center gap-2 border-b border-border px-2 py-1 text-sm hover:bg-surface">
              <input type={kind.multi ? "checkbox" : "radio"} name="sensor" checked={ids.includes(x.id)} onChange={() => toggle(x.id)} />
              <span className="truncate">{x.name}</span>
              <span className="text-xs text-muted">{x.sensorType}</span>
              <span className="ml-auto truncate text-xs text-muted">{t.hardware.get(x.hardwareId)?.name}</span>
            </label>
          ))}
        </div>
        <div className="flex justify-end gap-2">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-accent" onClick={() => onSave({ ...widget, sensorIds: ids, settings: s })}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
