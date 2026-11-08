import { memo, useDeferredValue, useMemo, useState, type CSSProperties } from "react";
import type { HardwareEntry, SensorEntry } from "../generated/schema-types";
import { ChevronIcon, HardwareIcon, PlusIcon, SearchIcon } from "../components/Icons";
import { ServiceHelp } from "../components/StatusIndicator";
import { formatValue } from "../lib/format";
import { useSettings, settings as settingsStore } from "../lib/settings";
import { telemetry, useSensor, useTelemetryMeta } from "../lib/telemetry";
import { fraction } from "../widgets/common";

interface Group {
  hw: HardwareEntry;
  depth: number;
  /** Every sensor on this hardware, for the headline values. */
  all: SensorEntry[];
  /** Sensors matching the search and filter. */
  sensors: SensorEntry[];
}

const COLUMNS = "grid grid-cols-[minmax(10rem,1fr)_6.5rem_6rem_6rem_6rem_7rem_2.5rem] items-center gap-3";

/** Order and headings for sensor types inside a card. Unlisted types go last under their own name. */
const TYPES: [string, string][] = [
  ["Temperature", "Temperatures"],
  ["Load", "Load"],
  ["Clock", "Clocks"],
  ["Power", "Power"],
  ["Voltage", "Voltages"],
  ["Current", "Current"],
  ["Fan", "Fans"],
  ["Control", "Fan control"],
  ["Throughput", "Throughput"],
  ["Data", "Data"],
  ["SmallData", "Memory"],
  ["Level", "Levels"],
];
const FILTERS = ["Temperature", "Load", "Clock", "Power", "Voltage", "Fan"];
const typeRank = (t: string) => {
  const i = TYPES.findIndex(([k]) => k === t);
  return i < 0 ? TYPES.length : i;
};
const typeHeading = (t: string) => TYPES.find(([k]) => k === t)?.[1] ?? t;

const HARDWARE_LABELS: Record<string, string> = {
  Cpu: "Processor",
  GpuNvidia: "Graphics card",
  GpuAmd: "Graphics",
  GpuIntel: "Graphics",
  Memory: "Memory",
  Storage: "Drive",
  Network: "Network adapter",
  Motherboard: "Motherboard",
  SuperIO: "Motherboard sensors",
  Battery: "Battery",
  Psu: "Power supply",
  Cooler: "Cooler",
  EmbeddedController: "Embedded controller",
};

/** Hardware in tree order (parents before their sub-hardware), each with its matching sensors. */
function buildGroups(hardware: HardwareEntry[], sensors: SensorEntry[], query: string, filter: string | null): Group[] {
  const q = query.trim().toLowerCase();
  const all = new Map<string, SensorEntry[]>();
  for (const s of sensors) {
    let list = all.get(s.hardwareId);
    if (!list) all.set(s.hardwareId, (list = []));
    list.push(s);
  }
  const hwName = new Map(hardware.map((h) => [h.id, h.name]));
  const out: Group[] = [];
  const visit = (hw: HardwareEntry, depth: number) => {
    const every = all.get(hw.id) ?? [];
    const matching = every
      .filter((s) => (!filter || s.sensorType === filter) && (!q || `${s.name} ${s.sensorType} ${hwName.get(s.hardwareId) ?? ""}`.toLowerCase().includes(q)))
      .sort((a, b) => typeRank(a.sensorType) - typeRank(b.sensorType));
    if (matching.length) out.push({ hw, depth, all: every, sensors: matching });
    // Only indent under a parent that is actually listed (a motherboard often has no sensors of its own).
    for (const child of hardware.filter((h) => h.parentId === hw.id)) visit(child, matching.length ? depth + 1 : depth);
  };
  for (const root of hardware.filter((h) => !h.parentId)) visit(root, 0);
  return out;
}

/** The one or two readings worth showing on a collapsed card. */
function headline(sensors: SensorEntry[]): SensorEntry[] {
  const temp =
    sensors.find((s) => s.sensorType === "Temperature" && /Package|Tctl|^GPU Core$|Composite|^CPU Core$|^System$/.test(s.name)) ??
    sensors.find((s) => s.sensorType === "Temperature" && !/Limit|Resolution|Warning|Critical/.test(s.name));
  const load = sensors.find((s) => s.sensorType === "Load" && /^CPU Total$|^GPU Core$|^Memory$|^Total Activity$|Utilization/.test(s.name));
  const rate = !temp && !load ? sensors.find((s) => s.sensorType === "Throughput" || s.sensorType === "Fan") : undefined;
  return [temp, load, rate].filter((s): s is SensorEntry => !!s);
}

export function SensorsPage({ onPin }: { onPin?: (sensorId: string) => void }) {
  const t = useTelemetryMeta();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<string | null>(null);
  const deferredQuery = useDeferredValue(query);
  // Every card starts collapsed; searching or filtering opens the ones with matches.
  const [open, setOpen] = useState<Set<string>>(new Set());
  const catalog = t.catalog;
  const groups = useMemo(() => (catalog ? buildGroups(catalog.hardware, catalog.sensors, deferredQuery, filter) : []), [catalog, deferredQuery, filter]);
  const forced = deferredQuery.trim().length > 0 || filter !== null;
  const shown = groups.reduce((n, g) => n + g.sensors.length, 0);

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="flex h-full flex-col">
      <ServiceHelp />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input className="field w-56" style={{ paddingLeft: "2rem", paddingTop: "0.35rem", paddingBottom: "0.35rem" }} placeholder="Search, like temp or fan" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search sensors" />
        </div>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Filter by sensor type">
          {[null, ...FILTERS].map((f) => (
            <button
              key={f ?? "all"}
              aria-pressed={filter === f}
              className={`btn rounded-full px-3 py-1 text-xs ${filter === f ? "btn-accent" : ""}`}
              onClick={() => setFilter(f)}
            >
              {f ? typeHeading(f) : "All"}
            </button>
          ))}
        </div>
        <span className="text-sm text-muted">{catalog ? `${shown} of ${catalog.sensors.length} sensors` : ""}</span>
        <div className="ml-auto flex gap-2">
          <button className="btn" onClick={() => setOpen(open.size ? new Set() : new Set(groups.map((g) => g.hw.id)))}>
            {open.size ? "Collapse all" : "Expand all"}
          </button>
          <button className="btn" data-tip="Start min, max and average over from the current values" onClick={() => telemetry.resetStats()}>
            Reset
          </button>
        </div>
      </div>
      <div className="stagger flex min-h-0 flex-1 flex-col gap-2 overflow-auto pb-2 pr-1">
        {catalog && !groups.length && <p className="p-6 text-center text-sm text-muted">No sensors match. Try another word or filter.</p>}
        {groups.map((g, i) => (
          <HardwareCard
            key={g.hw.id}
            group={g}
            index={i}
            open={forced || open.has(g.hw.id)}
            onToggle={() => toggle(g.hw.id)}
            onPin={onPin}
          />
        ))}
      </div>
    </div>
  );
}

function HardwareCard({ group: g, index, open, onToggle, onPin }: { group: Group; index: number; open: boolean; onToggle: () => void; onPin?: (id: string) => void }) {
  const heads = useMemo(() => headline(g.all), [g.all]);
  // Sensors split into runs of the same type, each run under its own heading.
  const sections = useMemo(() => {
    const out: { type: string; sensors: SensorEntry[] }[] = [];
    for (const s of g.sensors) {
      const last = out[out.length - 1];
      if (last?.type === s.sensorType) last.sensors.push(s);
      else out.push({ type: s.sensorType, sensors: [s] });
    }
    return out;
  }, [g.sensors]);

  return (
    <section className="panel lift shrink-0 overflow-hidden" style={{ "--i": Math.min(index, 12), marginLeft: `${g.depth * 1.5}rem` } as CSSProperties}>
      <button className="flex w-full items-center gap-3 px-4 py-3 text-left" aria-expanded={open} onClick={onToggle}>
        <ChevronIcon className="chevron h-4 w-4 shrink-0 text-muted" />
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-theme bg-accent/15 text-accent">
          <HardwareIcon type={g.hw.hardwareType} className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{g.hw.name}</span>
          <span className="text-xs text-muted">
            {HARDWARE_LABELS[g.hw.hardwareType] ?? g.hw.hardwareType} · {g.all.length} sensors
          </span>
        </span>
        <span className="flex shrink-0 flex-wrap justify-end gap-1.5">
          {heads.map((s) => (
            <HeadlineChip key={s.id} sensor={s} />
          ))}
        </span>
      </button>
      {open && (
        <div className="fade-in border-t border-border pb-1">
          <div className={`${COLUMNS} px-4 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted`}>
            <span>Sensor</span>
            <span className="text-right">Current</span>
            <span className="text-right">Min</span>
            <span className="text-right">Max</span>
            <span className="text-right">Average</span>
            <span className="text-center" data-tip="Where the current value sits between its minimum and maximum">
              Range
            </span>
            <span />
          </div>
          {sections.map((sec) => (
            <div key={sec.type}>
              <div className="px-4 pb-0.5 pt-2 text-xs font-semibold text-accent">{typeHeading(sec.type)}</div>
              {sec.sensors.map((s) => (
                <SensorRow key={s.id} sensor={s} onPin={onPin} />
              ))}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function HeadlineChip({ sensor }: { sensor: SensorEntry }) {
  const live = useSensor(sensor.id);
  useSettings();
  return (
    <span className="rounded-full border border-border bg-surface px-2.5 py-0.5 text-xs tabular-nums" data-tip={sensor.name}>
      <span className="text-muted">{sensor.sensorType === "Temperature" ? "Temp" : sensor.sensorType} </span>
      <span className="font-semibold">{formatValue(sensor.sensorType, live?.value, settingsStore.temperatureUnit)}</span>
    </span>
  );
}

const SensorRow = memo(function SensorRow({ sensor, onPin }: { sensor: SensorEntry; onPin?: (id: string) => void }) {
  const live = useSensor(sensor.id);
  useSettings();
  const unit = settingsStore.temperatureUnit;
  const f = (v: number | null | undefined) => formatValue(sensor.sensorType, v, unit);
  const pos = live && live.value !== null && live.min !== null && live.max !== null ? fraction(live.value, live.min, live.max) : null;
  return (
    <div className={`${COLUMNS} group mx-1 rounded-theme px-3 py-1 text-sm hover:bg-accent/10`}>
      <span className="truncate" title={sensor.id}>
        {sensor.name}
      </span>
      <span className="text-right font-semibold tabular-nums">{f(live?.value)}</span>
      <span className="text-right tabular-nums text-muted">{f(live?.min)}</span>
      <span className="text-right tabular-nums text-muted">{f(live?.max)}</span>
      <span className="text-right tabular-nums text-muted">{f(live?.avg)}</span>
      <span className="h-1.5 overflow-hidden rounded-full bg-border" aria-hidden>
        {pos !== null && <span className="bar-fill block h-full rounded-full bg-accent" style={{ width: `${Math.max(4, pos * 100)}%` }} />}
      </span>
      <span className="text-center">
        {onPin && (
          <button
            className="rounded-full p-1 text-muted opacity-0 hover:bg-accent hover:text-accent-text focus:opacity-100 group-hover:opacity-100"
            data-tip="Add this sensor to the current dashboard"
            aria-label={`Pin ${sensor.name} to the active dashboard`}
            onClick={() => onPin(sensor.id)}
          >
            <PlusIcon className="h-3.5 w-3.5" />
          </button>
        )}
      </span>
    </div>
  );
});
