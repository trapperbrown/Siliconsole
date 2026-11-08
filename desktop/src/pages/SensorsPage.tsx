import { memo, useDeferredValue, useMemo, useState } from "react";
import type { HardwareEntry, SensorEntry } from "../generated/schema-types";
import { ServiceHelp } from "../components/StatusIndicator";
import { formatValue } from "../lib/format";
import { useSettings, settings as settingsStore } from "../lib/settings";
import { telemetry, useSensor, useTelemetryMeta } from "../lib/telemetry";

interface Group {
  hw: HardwareEntry;
  depth: number;
  sensors: SensorEntry[];
}

const COLUMNS = "grid grid-cols-[minmax(12rem,1fr)_7rem_7rem_7rem_7rem_3rem] items-center gap-2";

/** Hardware in tree order (parents before their sub-hardware), each with its matching sensors. */
function buildGroups(hardware: HardwareEntry[], sensors: SensorEntry[], query: string): Group[] {
  const q = query.trim().toLowerCase();
  const byHw = new Map<string, SensorEntry[]>();
  for (const s of sensors) {
    const hw = hardware.find((h) => h.id === s.hardwareId);
    const hay = `${s.name} ${s.sensorType} ${hw?.name ?? ""}`.toLowerCase();
    if (q && !hay.includes(q)) continue;
    let list = byHw.get(s.hardwareId);
    if (!list) byHw.set(s.hardwareId, (list = []));
    list.push(s);
  }
  const out: Group[] = [];
  const visit = (hw: HardwareEntry, depth: number) => {
    const list = byHw.get(hw.id);
    if (list?.length) out.push({ hw, depth, sensors: list });
    for (const child of hardware.filter((h) => h.parentId === hw.id)) visit(child, depth + 1);
  };
  for (const root of hardware.filter((h) => !h.parentId)) visit(root, 0);
  return out;
}

export function SensorsPage({ onPin }: { onPin?: (sensorId: string) => void }) {
  const t = useTelemetryMeta();
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const catalog = t.catalog;
  const groups = useMemo(() => (catalog ? buildGroups(catalog.hardware, catalog.sensors, deferredQuery) : []), [catalog, deferredQuery]);
  const searching = deferredQuery.trim().length > 0;

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="flex h-full flex-col">
      <ServiceHelp />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input className="field w-72" placeholder="Search sensors" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search sensors" />
        <span className="text-sm text-muted">{catalog ? `${groups.reduce((n, g) => n + g.sensors.length, 0)} of ${catalog.sensors.length} sensors` : ""}</span>
        <div className="ml-auto flex gap-2">
          <button className="btn" onClick={() => setCollapsed(new Set())}>
            Expand all
          </button>
          <button className="btn" onClick={() => setCollapsed(new Set(groups.map((g) => g.hw.id)))}>
            Collapse all
          </button>
          <button className="btn" data-tip="Start min, max and average over from the current values" onClick={() => telemetry.resetStats()}>
            Reset min/max
          </button>
        </div>
      </div>
      <div className="panel min-h-0 flex-1 overflow-auto">
        <div className={`${COLUMNS} sticky top-0 z-10 border-b border-border bg-surface-solid px-3 py-2 text-xs font-semibold text-muted`}>
          <span>Sensor</span>
          <span className="text-right">Current</span>
          <span className="text-right">Min</span>
          <span className="text-right">Max</span>
          <span className="text-right">Average</span>
          <span className="text-center">Pin</span>
        </div>
        {groups.map((g) => {
          const open = searching || !collapsed.has(g.hw.id);
          return (
            <div key={g.hw.id}>
              <button
                className="flex w-full items-center gap-2 border-b border-border px-3 py-1.5 text-left text-sm font-semibold hover:text-accent"
                style={{ paddingLeft: `${0.75 + g.depth * 1.25}rem` }}
                onClick={() => toggle(g.hw.id)}
                aria-expanded={open}
              >
                <span className="w-3 text-muted" aria-hidden>
                  {open ? "▾" : "▸"}
                </span>
                {g.hw.name}
                <span className="font-normal text-muted">{g.hw.hardwareType}</span>
              </button>
              {open && g.sensors.map((s) => <SensorRow key={s.id} sensor={s} depth={g.depth} onPin={onPin} />)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const SensorRow = memo(function SensorRow({ sensor, depth, onPin }: { sensor: SensorEntry; depth: number; onPin?: (id: string) => void }) {
  const live = useSensor(sensor.id);
  useSettings();
  const unit = settingsStore.temperatureUnit;
  const f = (v: number | null | undefined) => formatValue(sensor.sensorType, v, unit);
  return (
    <div className={`${COLUMNS} border-b border-border px-3 py-1 text-sm hover:bg-surface`} style={{ paddingLeft: `${2.25 + depth * 1.25}rem` }}>
      <span className="truncate" title={sensor.id}>
        {sensor.name} <span className="text-xs text-muted">{sensor.sensorType}</span>
      </span>
      <span className="text-right tabular-nums">{f(live?.value)}</span>
      <span className="text-right tabular-nums text-muted">{f(live?.min)}</span>
      <span className="text-right tabular-nums text-muted">{f(live?.max)}</span>
      <span className="text-right tabular-nums text-muted">{f(live?.avg)}</span>
      <span className="text-center">
        {onPin && (
          <button className="text-muted hover:text-accent" data-tip="Add this sensor to the current dashboard" aria-label={`Pin ${sensor.name} to the active dashboard`} onClick={() => onPin(sensor.id)}>
            ＋
          </button>
        )}
      </span>
    </div>
  );
});
