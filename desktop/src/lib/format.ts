import type { TemperatureUnit } from "../generated/schema-types";
import { config } from "./config";

const BYTE_STEP = 1024;
const BYTE_PREFIXES = ["", "K", "M", "G", "T"];

/** Converts a native sensor value into the display unit. Only temperatures change (C to F). */
export function convert(sensorType: string | undefined, value: number, unit: TemperatureUnit): number {
  return sensorType === "Temperature" && unit === "F" ? (value * 9) / 5 + 32 : value;
}

/** Inverse of convert(), for thresholds typed in display units but stored natively. */
export function toNative(sensorType: string | undefined, value: number, unit: TemperatureUnit): number {
  return sensorType === "Temperature" && unit === "F" ? ((value - 32) * 5) / 9 : value;
}

export function unitLabel(sensorType: string | undefined, unit: TemperatureUnit): string {
  if (sensorType === "Temperature") return unit === "F" ? "°F" : "°C";
  return (sensorType && config.sensorUnits[sensorType]) ?? "";
}

/** Formats a native value for display, scaling byte rates (B/s to KB/s, MB/s and so on). */
export function formatValue(
  sensorType: string | undefined,
  value: number | null | undefined,
  unit: TemperatureUnit,
  decimals = config.sensorsPage.typeDecimals[sensorType ?? ""] ?? config.sensorsPage.valueDecimals,
  unitOverride?: string | null,
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "n/a";
  const label = unitOverride ?? unitLabel(sensorType, unit);
  if (sensorType === "Throughput" && !unitOverride) {
    let v = value;
    let i = 0;
    while (Math.abs(v) >= BYTE_STEP && i < BYTE_PREFIXES.length - 1) {
      v /= BYTE_STEP;
      i++;
    }
    return `${v.toFixed(decimals)} ${BYTE_PREFIXES[i]}B/s`;
  }
  const v = convert(sensorType, value, unit);
  return label ? `${v.toFixed(decimals)} ${label}` : v.toFixed(decimals);
}

export function formatBytes(bytes: number | null | undefined, decimals = 1): string {
  if (bytes === null || bytes === undefined) return "n/a";
  let v = bytes;
  let i = 0;
  while (v >= BYTE_STEP && i < BYTE_PREFIXES.length - 1) {
    v /= BYTE_STEP;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : decimals)} ${BYTE_PREFIXES[i]}B`;
}
