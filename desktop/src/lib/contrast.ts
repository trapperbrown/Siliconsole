// WCAG 2.x contrast checks for theme tokens. Self-contained (type-only imports) so
// scripts/check-frontend.mjs can run it directly under Node.
import type { Theme } from "../generated/schema-types";

type Rgb = [number, number, number];

const parse = (hex: string): Rgb => {
  const n = parseInt(hex.slice(1, 7), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

function luminance([r, g, b]: Rgb): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function ratio(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** The surface as actually seen: blended over each background stop at its opacity. */
const blend = (top: Rgb, bottom: Rgb, alpha: number): Rgb => top.map((c, i) => Math.round(c * alpha + bottom[i] * (1 - alpha))) as Rgb;

export interface ContrastIssue {
  pair: string;
  ratio: number;
  required: number;
}

/** Checks text pairs at `normal` (AA body text) and accent/status colors at `large` (AA large text / UI). */
export function checkTheme(t: Theme, normal: number, large: number): ContrastIssue[] {
  const stops = [t.background.color, ...(t.background.kind === "gradient" && t.background.gradientTo ? [t.background.gradientTo] : [])].map(parse);
  const issues: ContrastIssue[] = [];
  const need = (pair: string, a: Rgb, b: Rgb, required: number) => {
    const r = ratio(a, b);
    if (r < required) issues.push({ pair, ratio: Math.round(r * 100) / 100, required });
  };
  stops.forEach((bg, i) => {
    const where = stops.length > 1 ? ` (background stop ${i + 1})` : "";
    const surface = blend(parse(t.surface), bg, t.surfaceOpacity);
    need(`text on background${where}`, parse(t.text), bg, normal);
    need(`text on surface${where}`, parse(t.text), surface, normal);
    need(`muted text on surface${where}`, parse(t.textMuted), surface, normal);
    for (const k of ["accent", "success", "warning", "critical"] as const) need(`${k} on surface${where}`, parse(t[k]), surface, large);
  });
  need("accent text on accent", parse(t.accentText), parse(t.accent), normal);
  return issues;
}
