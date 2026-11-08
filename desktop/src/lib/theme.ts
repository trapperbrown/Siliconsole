import { useSyncExternalStore } from "react";
import type { Theme } from "../generated/schema-types";
import themeSchema from "@shared/schemas/theme.schema.json";
import { config } from "./config";
import { ipc } from "./ipc";
import { settings } from "./settings";
import { validate } from "./validate";

const builtinModules = import.meta.glob<Theme>("../../../shared/themes/*.json", { eager: true, import: "default" });

/** Shipped themes in the order listed in config. */
export const builtinThemes: Theme[] = config.themes.builtinIds
  .map((id) => Object.values(builtinModules).find((t) => t.id === id))
  .filter((t): t is Theme => !!t);

let current: Theme = builtinThemes.find((t) => t.id === config.themes.defaultThemeId) ?? builtinThemes[0];
let version = 0;
const listeners = new Set<() => void>();

/** Writes every token to a CSS custom property. Nothing in the UI uses a color that is not one of these. */
export function applyTheme(t: Theme) {
  current = t;
  const s = document.documentElement.style;
  s.setProperty("--sc-bg", t.background.color);
  s.setProperty("--sc-surface", t.surface);
  s.setProperty("--sc-surface-opacity", String(t.surfaceOpacity));
  s.setProperty("--sc-surface-blur", `${t.surfaceBlurPx}px`);
  s.setProperty("--sc-border", t.border);
  s.setProperty("--sc-text", t.text);
  s.setProperty("--sc-text-muted", t.textMuted);
  s.setProperty("--sc-accent", t.accent);
  s.setProperty("--sc-accent-text", t.accentText);
  s.setProperty("--sc-success", t.success);
  s.setProperty("--sc-warning", t.warning);
  s.setProperty("--sc-critical", t.critical);
  s.setProperty("--sc-font", t.fontFamily);
  s.setProperty("--sc-radius", `${t.radiusPx}px`);
  s.setProperty("--sc-glow", String(t.glowIntensity));
  t.chartPalette.forEach((c, i) => s.setProperty(`--sc-chart-${i}`, c));
  s.setProperty("--sc-background", backgroundCss(t));
  version++;
  listeners.forEach((fn) => fn());
}

export function backgroundCss(t: Theme): string {
  const b = t.background;
  if (b.kind === "gradient" && b.gradientTo) return `linear-gradient(${b.gradientAngleDeg ?? 180}deg, ${b.color}, ${b.gradientTo})`;
  if (b.kind === "image" && b.imageUrl) return `${b.color} url("${b.imageUrl.replace(/"/g, "%22")}") center / cover no-repeat`;
  return b.color;
}

export function currentTheme() {
  return current;
}

/** Re-renders (rarely) when the theme changes, e.g. so canvas charts can pick up new colors. */
export function useTheme(): Theme {
  useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    () => version,
  );
  return current;
}

// ---------- user themes and selection ----------

let userThemes: Theme[] = [];

export function allThemes(): Theme[] {
  return [...builtinThemes, ...userThemes];
}

export function isBuiltin(id: string) {
  return builtinThemes.some((t) => t.id === id);
}

function notify() {
  version++;
  listeners.forEach((fn) => fn());
}

/** Loads user themes, applies the selected one, and follows selection changes from any window. */
export async function initThemes() {
  userThemes = (await ipc.listDocuments<Theme>("themes")).filter((t) => validate(themeSchema, t).length === 0 && !isBuiltin(t.id));
  const pick = () => allThemes().find((t) => t.id === settings.themeId) ?? builtinThemes[0];
  applyTheme(pick());
  let lastId = settings.themeId;
  settings.subscribe(() => {
    if (settings.themeId !== lastId) {
      lastId = settings.themeId;
      applyTheme(pick());
    }
  });
}

export async function selectTheme(id: string) {
  await settings.update({ themeId: id, trayTextColor: allThemes().find((t) => t.id === id)?.accent ?? null });
}

export function uniqueThemeId(name: string) {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "theme";
  let id = base;
  for (let n = 2; allThemes().some((t) => t.id === id); n++) id = `${base}-${n}`;
  return id;
}

export async function saveUserTheme(t: Theme) {
  if (isBuiltin(t.id)) throw new Error("Built-in themes cannot be overwritten. Duplicate it first.");
  const errors = validate(themeSchema, t);
  if (errors.length) throw new Error(errors.join("; "));
  await ipc.saveDocument("themes", t);
  userThemes = [...userThemes.filter((x) => x.id !== t.id), t];
  notify();
}

export async function deleteUserTheme(id: string) {
  await ipc.deleteDocument("themes", id);
  userThemes = userThemes.filter((t) => t.id !== id);
  if (settings.themeId === id) await selectTheme(config.themes.defaultThemeId);
  notify();
}

export async function importTheme(): Promise<Theme | null> {
  const text = await ipc.importFile("json");
  if (text === null) return null;
  let t: Theme;
  try {
    t = JSON.parse(text);
  } catch {
    throw new Error("The file is not valid JSON.");
  }
  delete (t as { $schema?: string }).$schema;
  const errors = validate(themeSchema, t);
  if (errors.length) throw new Error(`Not a valid theme: ${errors.join("; ")}`);
  if (allThemes().some((x) => x.id === t.id)) t = { ...t, id: uniqueThemeId(t.name), name: `${t.name} (imported)` };
  await saveUserTheme(t);
  return t;
}

export function exportTheme(t: Theme) {
  const { ...copy } = t;
  delete (copy as { $schema?: string }).$schema;
  return ipc.exportFile(`${t.id}.json`, "json", JSON.stringify(copy, null, 2));
}
