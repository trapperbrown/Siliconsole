import { config } from "../lib/config";
import { formatValue } from "../lib/format";
import { settings, useSettings } from "../lib/settings";
import { useSensor } from "../lib/telemetry";
import { EmptyState, WidgetFrame, fraction, levelColor, resolveSettings, type WidgetProps } from "./common";

const VIEW = 100;
const RADIUS = 40;

function polar(angleDeg: number) {
  const a = (angleDeg * Math.PI) / 180;
  return [VIEW / 2 + RADIUS * Math.cos(a), VIEW / 2 + RADIUS * Math.sin(a)];
}

function arc(startDeg: number, sweepDeg: number) {
  const [x0, y0] = polar(startDeg);
  const [x1, y1] = polar(startDeg + sweepDeg);
  return `M ${x0} ${y0} A ${RADIUS} ${RADIUS} 0 ${sweepDeg > 180 ? 1 : 0} 1 ${x1} ${y1}`;
}

export function RadialGaugeWidget({ widget, compact }: WidgetProps) {
  const r = resolveSettings(widget);
  const live = useSensor(widget.sensorIds[0]);
  useSettings();
  if (!widget.sensorIds.length) return <WidgetFrame title={r.label}><EmptyState /></WidgetFrame>;
  const sweep = config.widgetDefaults.gaugeSweepDegrees;
  const start = 90 + (360 - sweep) / 2; // gap centered at the bottom
  const v = live?.value ?? null;
  const f = v === null ? 0 : fraction(v, r.min, r.max);
  const color = levelColor(v, r.warning, r.critical);
  const stroke = config.widgetDefaults.gaugeStrokePx;
  return (
    <WidgetFrame title={r.label} compact={compact}>
      <svg viewBox={`0 0 ${VIEW} ${VIEW}`} className="absolute inset-0 h-full w-full" role="img" aria-label={`${r.label} ${formatValue(r.sensorType, v, settings.temperatureUnit, r.decimals, r.unit)}`}>
        <path d={arc(start, sweep)} fill="none" stroke="var(--sc-border)" strokeWidth={stroke} strokeLinecap="round" />
        {f > 0 && (
          <path
            className="gauge-arc"
            d={arc(start, Math.max(0.5, f * sweep))}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            style={{ filter: `drop-shadow(0 0 calc(var(--sc-glow) * 4px) ${color})` }}
          />
        )}
        <text x={VIEW / 2} y={VIEW / 2 + 4} textAnchor="middle" fill="var(--sc-text)" fontSize="16" fontWeight="600" fontFamily="var(--sc-font)">
          {formatValue(r.sensorType, v, settings.temperatureUnit, r.decimals, r.unit)}
        </text>
      </svg>
    </WidgetFrame>
  );
}

export function LinearBarWidget({ widget, compact }: WidgetProps) {
  const r = resolveSettings(widget);
  const live = useSensor(widget.sensorIds[0]);
  useSettings();
  if (!widget.sensorIds.length) return <WidgetFrame title={r.label}><EmptyState /></WidgetFrame>;
  const v = live?.value ?? null;
  const f = v === null ? 0 : fraction(v, r.min, r.max);
  const color = levelColor(v, r.warning, r.critical);
  return (
    <WidgetFrame title={r.label} compact={compact}>
      <div className="flex h-full flex-col justify-center gap-1">
        <div className="text-right text-lg font-semibold tabular-nums">{formatValue(r.sensorType, v, settings.temperatureUnit, r.decimals, r.unit)}</div>
        <div className="h-3 w-full overflow-hidden rounded-theme bg-border" role="meter" aria-valuenow={v ?? undefined} aria-valuemin={r.min} aria-valuemax={r.max} aria-label={r.label}>
          <div className="bar-fill h-full rounded-theme" style={{ width: `${f * 100}%`, background: color }} />
        </div>
      </div>
    </WidgetFrame>
  );
}

export function BigNumberWidget({ widget, compact }: WidgetProps) {
  const r = resolveSettings(widget);
  const live = useSensor(widget.sensorIds[0]);
  useSettings();
  if (!widget.sensorIds.length) return <WidgetFrame title={r.label}><EmptyState /></WidgetFrame>;
  const v = live?.value ?? null;
  return (
    <WidgetFrame title={r.label} compact={compact}>
      <div className="flex h-full items-center justify-center [container-type:size]">
        <span className="font-bold tabular-nums leading-none" style={{ color: levelColor(v, r.warning, r.critical, "var(--sc-text)"), fontSize: "min(60cqh, 18cqw)" }}>
          {formatValue(r.sensorType, v, settings.temperatureUnit, r.decimals, r.unit)}
        </span>
      </div>
    </WidgetFrame>
  );
}
