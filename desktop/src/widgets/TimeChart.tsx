import { useEffect, useRef } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { config } from "../lib/config";
import { convert, formatValue } from "../lib/format";
import { settings, useSettings } from "../lib/settings";
import { telemetry, useSensor, useTelemetryMeta } from "../lib/telemetry";
import { useTheme } from "../lib/theme";
import { EmptyState, WidgetFrame, cssVar, levelColor, paletteColor, resolveSettings, withAlpha, type WidgetProps } from "./common";

const SPARK_FILL_ALPHA = 0.18;
const AXIS_SIZE_PX = 56;

/**
 * uPlot line chart. The chart is created once per binding/theme change; each frame only appends a
 * point and trims the window, so steady-state work is O(new points), never a rebuild.
 */
function Chart({ ids, historySeconds, min, max, sparkline, compact }: { ids: string[]; historySeconds: number; min: number | null; max: number | null; sparkline: boolean; compact?: boolean }) {
  const el = useRef<HTMLDivElement>(null);
  const theme = useTheme();
  const meta = useTelemetryMeta();
  useSettings();
  const unit = settings.temperatureUnit;
  const historyVersion = meta.getMetaVersion();

  useEffect(() => {
    const div = el.current;
    if (!div || !ids.length) return;
    const windowSec = historySeconds;
    const types = ids.map((id) => telemetry.sensors.get(id)?.sensorType);
    const since = (telemetry.lastFrameAt || Date.now()) - windowSec * 1000;
    const hist = ids.map((id) => telemetry.getHistory(id, since));
    const xs = (hist[0]?.xs ?? []).map((t) => t / 1000);
    const ys = hist.map((h, i) => h.ys.map((v) => (v === null ? null : convert(types[i], v, unit))));
    const data: (number | null)[][] = [xs, ...ys];
    const muted = cssVar("--sc-text-muted");
    const border = cssVar("--sc-border");
    const fixed = min !== null && max !== null;
    const toDisplay = (v: number) => convert(types[0], v, unit);

    const u = new uPlot(
      {
        width: Math.max(1, div.clientWidth),
        height: Math.max(1, div.clientHeight),
        legend: { show: false },
        cursor: { show: !sparkline && !compact, points: { show: false }, drag: { x: false, y: false } },
        select: { show: false, left: 0, top: 0, width: 0, height: 0 },
        scales: {
          x: { time: true },
          y: { range: fixed ? [toDisplay(min!), toDisplay(max!)] : (_u, lo, hi) => (lo === hi ? [lo - 1, hi + 1] : [lo, hi]) },
        },
        axes: sparkline
          ? [{ show: false }, { show: false }]
          : [
              { stroke: muted, grid: { stroke: border, width: 1 }, ticks: { stroke: border, width: 1 }, font: `11px ${cssVar("--sc-font")}` },
              {
                stroke: muted,
                grid: { stroke: border, width: 1 },
                ticks: { stroke: border, width: 1 },
                size: AXIS_SIZE_PX,
                font: `11px ${cssVar("--sc-font")}`,
                values: (_u, splits) => splits.map((v) => (types[0] === "Throughput" ? formatValue("Throughput", v, unit, 0) : `${+v.toFixed(1)}`)),
              },
            ],
        series: [
          {},
          ...ids.map((id, i) => {
            const color = paletteColor(i);
            return {
              label: telemetry.sensors.get(id)?.name ?? id,
              stroke: color,
              width: config.widgetDefaults.chartLineWidthPx,
              fill: sparkline ? withAlpha(color, SPARK_FILL_ALPHA) : undefined,
              points: { show: false },
              spanGaps: false,
            };
          }),
        ],
      },
      data as uPlot.AlignedData,
      div,
    );

    const ro = new ResizeObserver(() => u.setSize({ width: Math.max(1, div.clientWidth), height: Math.max(1, div.clientHeight) }));
    ro.observe(div);
    const off = telemetry.subscribeFrame((ts) => {
      data[0].push(ts / 1000);
      ids.forEach((id, i) => {
        const v = telemetry.getLive(id)?.value;
        data[i + 1].push(v === null || v === undefined ? null : convert(types[i], v, unit));
      });
      const cutoff = ts / 1000 - windowSec;
      let drop = 0;
      while (drop < data[0].length && (data[0][drop] as number) < cutoff) drop++;
      if (drop) data.forEach((arr) => arr.splice(0, drop));
      u.setData(data as uPlot.AlignedData);
    });
    return () => {
      off();
      ro.disconnect();
      u.destroy();
    };
  }, [ids.join("|"), historySeconds, min, max, sparkline, compact, theme, unit, historyVersion]);

  return <div ref={el} className="absolute inset-0" />;
}

function LegendItem({ id, index, decimals }: { id: string; index: number; decimals: number }) {
  const live = useSensor(id);
  useSettings();
  const s = telemetry.sensors.get(id);
  return (
    <span className="flex min-w-0 items-center gap-1">
      <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: `var(--sc-chart-${index % 8})` }} />
      <span className="truncate text-muted">{s?.name ?? id}</span>
      <span className="tabular-nums">{formatValue(s?.sensorType, live?.value, settings.temperatureUnit, decimals)}</span>
    </span>
  );
}

export function LineChartWidget({ widget, compact }: WidgetProps) {
  const r = resolveSettings(widget);
  if (!widget.sensorIds.length) return <WidgetFrame title={r.label}><EmptyState /></WidgetFrame>;
  return (
    <WidgetFrame title={r.label} compact={compact}>
      <div className="flex h-full flex-col">
        <div className="relative min-h-0 flex-1">
          <Chart ids={widget.sensorIds} historySeconds={r.historySeconds} min={widget.settings.min ?? null} max={widget.settings.max ?? null} sparkline={false} compact={compact} />
        </div>
        {!compact && (
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
            {widget.sensorIds.map((id, i) => (
              <LegendItem key={id} id={id} index={i} decimals={r.decimals} />
            ))}
          </div>
        )}
      </div>
    </WidgetFrame>
  );
}

export function SparklineWidget({ widget, compact }: WidgetProps) {
  const r = resolveSettings(widget);
  const id = widget.sensorIds[0];
  const live = useSensor(id);
  useSettings();
  if (!id) return <WidgetFrame title={r.label}><EmptyState /></WidgetFrame>;
  const unit = settings.temperatureUnit;
  return (
    <WidgetFrame title={r.label} compact={compact}>
      <div className="flex h-full flex-col">
        <div className="text-xl font-semibold tabular-nums" style={{ color: levelColor(live?.value, r.warning, r.critical, "var(--sc-text)") }}>
          {formatValue(r.sensorType, live?.value, unit, r.decimals, r.unit)}
        </div>
        <div className="relative min-h-0 flex-1">
          <Chart ids={[id]} historySeconds={r.historySeconds} min={widget.settings.min ?? null} max={widget.settings.max ?? null} sparkline compact={compact} />
        </div>
      </div>
    </WidgetFrame>
  );
}
