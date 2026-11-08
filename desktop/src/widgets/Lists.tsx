import { useEffect, useRef } from "react";
import { config } from "../lib/config";
import { formatBytes, formatValue } from "../lib/format";
import { settings, useSettings } from "../lib/settings";
import { telemetry, useSensor, useTelemetryMeta } from "../lib/telemetry";
import { useTheme } from "../lib/theme";
import { EmptyState, WidgetFrame, cssVar, fraction, levelColor, resolveSettings, parseHex, type WidgetProps } from "./common";

// ---------- per-core heatmap: one row per core, one column per sample ----------

const toHex = (r: number, g: number, b: number) => "#" + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);

function mix(a: [number, number, number], b: [number, number, number], t: number) {
  return a.map((x, i) => Math.round(x + (b[i] - x) * t));
}

export function CoreHeatmapWidget({ widget, compact }: WidgetProps) {
  const r = resolveSettings(widget);
  const canvas = useRef<HTMLCanvasElement>(null);
  const theme = useTheme();
  const historyVersion = useTelemetryMeta().getMetaVersion();
  const ids = widget.sensorIds;

  useEffect(() => {
    const c = canvas.current;
    if (!c || !ids.length) return;
    const ctx = c.getContext("2d")!;
    const cols = config.widgetDefaults.heatmapColumns;
    const low = parseHex(cssVar("--sc-border"));
    const mid = parseHex(cssVar("--sc-accent"));
    const high = parseHex(cssVar("--sc-critical"));
    const colorFor = (v: number | null) => {
      if (v === null) return low;
      const f = fraction(v, r.min, r.max);
      return f < 0.5 ? mix(low, mid, f * 2) : mix(mid, high, (f - 0.5) * 2);
    };
    // Seed from history, then shift one column per frame.
    const grid: (number | null)[][] = ids.map((id) => {
      const ys = telemetry.getHistory(id, 0).ys.slice(-cols);
      return [...Array(cols - ys.length).fill(null), ...ys];
    });
    const draw = () => {
      const w = (c.width = c.clientWidth * devicePixelRatio);
      const h = (c.height = c.clientHeight * devicePixelRatio);
      const cw = w / cols;
      const rh = h / ids.length;
      grid.forEach((row, ri) =>
        row.forEach((v, ci) => {
          const [R, G, B] = colorFor(v);
          ctx.fillStyle = toHex(R, G, B);
          ctx.fillRect(Math.floor(ci * cw), Math.floor(ri * rh), Math.ceil(cw), Math.ceil(rh) - 1);
        }),
      );
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(c);
    const off = telemetry.subscribeFrame(() => {
      ids.forEach((id, i) => {
        grid[i].shift();
        grid[i].push(telemetry.getLive(id)?.value ?? null);
      });
      draw();
    });
    return () => {
      off();
      ro.disconnect();
    };
  }, [ids.join("|"), theme, r.min, r.max, historyVersion]);

  if (!ids.length) return <WidgetFrame title={r.label}><EmptyState /></WidgetFrame>;
  return (
    <WidgetFrame title={r.label} compact={compact}>
      <canvas ref={canvas} className="absolute inset-0 h-full w-full" role="img" aria-label={`${r.label}: ${ids.length} cores`} />
    </WidgetFrame>
  );
}

// ---------- fan list ----------

function FanRow({ id, max, decimals }: { id: string; max: number; decimals: number }) {
  const live = useSensor(id);
  const s = telemetry.sensors.get(id);
  const v = live?.value ?? null;
  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-x-2 text-xs">
      <span className="truncate text-muted">{s?.name ?? id}</span>
      <span className="tabular-nums">{formatValue(s?.sensorType, v, settings.temperatureUnit, decimals)}</span>
      <div className="col-span-2 h-1.5 overflow-hidden rounded-theme bg-border">
        <div className="h-full rounded-theme bg-accent" style={{ width: `${v === null ? 0 : fraction(v, 0, max) * 100}%` }} />
      </div>
    </div>
  );
}

export function FanListWidget({ widget, compact }: WidgetProps) {
  const r = resolveSettings(widget);
  if (!widget.sensorIds.length) return <WidgetFrame title={r.label}><EmptyState /></WidgetFrame>;
  const max = widget.settings.max ?? config.widgetDefaults.fanMaxRpm;
  return (
    <WidgetFrame title={r.label} compact={compact}>
      <div className="absolute inset-0 flex flex-col gap-1.5 overflow-auto pr-1">
        {widget.sensorIds.map((id) => (
          <FanRow key={id} id={id} max={max} decimals={r.decimals} />
        ))}
      </div>
    </WidgetFrame>
  );
}

// ---------- storage health card: one section per drive ----------

function StorageValue({ id, decimals, warning, critical }: { id: string; decimals: number; warning: number | null; critical: number | null }) {
  const live = useSensor(id);
  useSettings();
  const s = telemetry.sensors.get(id);
  const isTemp = s?.sensorType === "Temperature";
  return (
    <div className="flex justify-between gap-2 text-xs">
      <span className="truncate text-muted">{s?.name ?? id}</span>
      <span className="tabular-nums" style={{ color: isTemp ? levelColor(live?.value, warning, critical, "var(--sc-text)") : undefined }}>
        {formatValue(s?.sensorType, live?.value, settings.temperatureUnit, decimals)}
      </span>
    </div>
  );
}

export function StorageHealthWidget({ widget, compact }: WidgetProps) {
  const r = resolveSettings(widget);
  const t = useTelemetryMeta();
  if (!widget.sensorIds.length) return <WidgetFrame title={r.label}><EmptyState /></WidgetFrame>;
  const drives = new Map<string, string[]>();
  for (const id of widget.sensorIds) {
    const hw = t.sensors.get(id)?.hardwareId ?? "";
    drives.set(hw, [...(drives.get(hw) ?? []), id]);
  }
  return (
    <WidgetFrame title={r.label} compact={compact}>
      <div className="absolute inset-0 flex flex-col gap-3 overflow-auto pr-1">
        {[...drives].map(([hwId, ids]) => {
          const info = t.systemInfo?.storage.find((d) => d.hardwareId === hwId);
          const health = info?.health ?? null;
          const healthColor = health === "Healthy" ? "var(--sc-success)" : health ? "var(--sc-critical)" : "var(--sc-text-muted)";
          return (
            <div key={hwId}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-sm font-semibold">{t.hardware.get(hwId)?.name ?? hwId}</span>
                <span className="text-xs font-semibold" style={{ color: healthColor }}>
                  {health ?? "Health n/a"}
                </span>
              </div>
              {info && (
                <div className="mb-1 text-xs text-muted">
                  {[info.interface, info.mediaType, formatBytes(info.sizeBytes)].filter(Boolean).join(" · ")}
                </div>
              )}
              {ids.map((id) => (
                <StorageValue key={id} id={id} decimals={r.decimals} warning={r.warning} critical={r.critical} />
              ))}
            </div>
          );
        })}
      </div>
    </WidgetFrame>
  );
}
