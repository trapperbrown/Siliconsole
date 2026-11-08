import type { ReactNode } from "react";
import type { Widget } from "../generated/schema-types";
import { config } from "../lib/config";
import { telemetry } from "../lib/telemetry";

export interface WidgetProps {
  widget: Widget;
  /** True inside the overlay, where widgets render smaller and without interactivity. */
  compact?: boolean;
}

/** Widget settings with defaults filled in. All numeric thresholds are in the sensor's native unit. */
export function resolveSettings(w: Widget) {
  const s = w.settings;
  const d = config.widgetDefaults;
  const first = telemetry.sensors.get(w.sensorIds[0] ?? "");
  return {
    label: s.label || first?.name || "Unbound widget",
    unit: s.unit ?? null,
    decimals: s.decimals ?? d.decimals,
    min: s.min ?? d.min,
    max: s.max ?? d.max,
    warning: s.warning ?? null,
    critical: s.critical ?? null,
    historySeconds: s.historySeconds ?? d.historySeconds,
    sensorType: first?.sensorType,
  };
}

/** CSS color for a value given warning and critical thresholds. */
export function levelColor(value: number | null | undefined, warning: number | null, critical: number | null, base = "var(--sc-accent)") {
  if (value === null || value === undefined) return "var(--sc-text-muted)";
  if (critical !== null && value >= critical) return "var(--sc-critical)";
  if (warning !== null && value >= warning) return "var(--sc-warning)";
  return base;
}

export const fraction = (v: number, min: number, max: number) => (max > min ? Math.min(1, Math.max(0, (v - min) / (max - min))) : 0);

export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function paletteColor(i: number): string {
  return cssVar(`--sc-chart-${i % 8}`);
}

/** Appends an alpha channel to a #rrggbb token. */
export function withAlpha(hex: string, alpha: number): string {
  return hex + Math.round(alpha * 255).toString(16).padStart(2, "0");
}

/** Parses #rrggbb into [r, g, b]. */
export function parseHex(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1, 7), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function WidgetFrame({ title, children, compact }: { title: string; children: ReactNode; compact?: boolean }) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden p-2">
      <div className={`truncate font-medium text-muted ${compact ? "text-[10px]" : "text-xs"}`} title={title}>
        {title}
      </div>
      <div className="relative min-h-0 flex-1">{children}</div>
    </div>
  );
}

export function EmptyState({ text = "No sensor bound. Open widget settings to pick one." }: { text?: string }) {
  return <div className="flex h-full items-center justify-center p-2 text-center text-xs text-muted">{text}</div>;
}
