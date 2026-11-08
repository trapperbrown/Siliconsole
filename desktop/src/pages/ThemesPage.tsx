import { useState, type ReactNode } from "react";
import type { BackgroundKind, Theme } from "../generated/schema-types";
import { config } from "../lib/config";
import { checkTheme } from "../lib/contrast";
import { useSettings, settings } from "../lib/settings";
import {
  allThemes,
  applyTheme,
  backgroundCss,
  currentTheme,
  deleteUserTheme,
  exportTheme,
  importTheme,
  isBuiltin,
  saveUserTheme,
  selectTheme,
  uniqueThemeId,
  useTheme,
} from "../lib/theme";

type ColorKey = "surface" | "border" | "text" | "textMuted" | "accent" | "accentText" | "success" | "warning" | "critical";
const COLOR_FIELDS: [ColorKey, string][] = [
  ["text", "Text"],
  ["textMuted", "Muted text"],
  ["surface", "Surface"],
  ["border", "Border"],
  ["accent", "Accent"],
  ["accentText", "Text on accent"],
  ["success", "Success"],
  ["warning", "Warning"],
  ["critical", "Critical"],
];

function ThemeCard({ t, active, onSelect }: { t: Theme; active: boolean; onSelect: () => void }) {
  return (
    <button
      className={`overflow-hidden rounded-theme border text-left ${active ? "border-accent outline outline-2 outline-accent" : "border-border"}`}
      onClick={onSelect}
      aria-pressed={active}
    >
      <div className="h-16 p-2" style={{ background: backgroundCss(t) }}>
        <div className="h-full rounded-sm p-1.5" style={{ background: t.surface, opacity: t.surfaceOpacity, borderRadius: t.radiusPx / 2 }}>
          <span className="text-xs font-semibold" style={{ color: t.text, fontFamily: t.fontFamily }}>
            Aa <span style={{ color: t.accent }}>72°</span>
          </span>
        </div>
      </div>
      <div className="flex items-center gap-1 bg-surface-solid px-2 py-1.5">
        <span className="mr-auto truncate text-sm">{t.name}</span>
        {t.chartPalette.slice(0, 5).map((c, i) => (
          <span key={i} className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: c }} />
        ))}
      </div>
    </button>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-muted">{label}</span>
      {children}
    </label>
  );
}

function Editor({ initial, onDone }: { initial: Theme; onDone: () => void }) {
  const [t, setT] = useState<Theme>(initial);
  const [error, setError] = useState<string | null>(null);
  const issues = checkTheme(t, config.themes.minContrastRatio, config.themes.minLargeTextContrastRatio);

  // Every edit repaints the whole app immediately.
  const set = (next: Theme) => {
    setT(next);
    applyTheme(next);
  };
  const num = (v: string, fallback: number) => (Number.isFinite(parseFloat(v)) ? parseFloat(v) : fallback);

  const loadImage = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => set({ ...t, background: { ...t.background, kind: "image", imageUrl: String(reader.result) } });
    reader.readAsDataURL(file);
  };

  return (
    <div className="panel flex flex-col gap-3 p-4">
      <div className="flex items-center gap-2">
        <input className="field w-64 font-semibold" value={t.name} maxLength={64} onChange={(e) => set({ ...t, name: e.target.value })} aria-label="Theme name" />
        <div className="ml-auto flex gap-2">
          <button
            className="btn"
            onClick={() => {
              applyTheme(allThemes().find((x) => x.id === settings.themeId) ?? currentTheme());
              onDone();
            }}
          >
            Cancel
          </button>
          <button
            className="btn btn-accent"
            onClick={async () => {
              try {
                await saveUserTheme(t);
                await selectTheme(t.id);
                onDone();
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              }
            }}
          >
            Save theme
          </button>
        </div>
      </div>
      {error && <p className="text-sm text-critical">{error}</p>}
      <div className="grid grid-cols-3 gap-3">
        {COLOR_FIELDS.map(([k, label]) => (
          <Field key={k} label={label}>
            <span className="flex items-center gap-2">
              <input type="color" value={t[k]} onChange={(e) => set({ ...t, [k]: e.target.value })} aria-label={label} className="h-8 w-10 cursor-pointer rounded-theme border border-border bg-transparent" />
              <code className="text-xs text-muted selectable">{t[k]}</code>
            </span>
          </Field>
        ))}
      </div>
      <div className="grid grid-cols-4 gap-3">
        <Field label="Background">
          <select className="field" value={t.background.kind} onChange={(e) => set({ ...t, background: { ...t.background, kind: e.target.value as BackgroundKind } })}>
            <option value="solid">Solid</option>
            <option value="gradient">Gradient</option>
            <option value="image">Image</option>
          </select>
        </Field>
        <Field label="Background color">
          <input type="color" value={t.background.color} onChange={(e) => set({ ...t, background: { ...t.background, color: e.target.value } })} className="h-8 w-full cursor-pointer rounded-theme border border-border bg-transparent" />
        </Field>
        {t.background.kind === "gradient" && (
          <>
            <Field label="Gradient to">
              <input type="color" value={t.background.gradientTo ?? t.background.color} onChange={(e) => set({ ...t, background: { ...t.background, gradientTo: e.target.value } })} className="h-8 w-full cursor-pointer rounded-theme border border-border bg-transparent" />
            </Field>
            <Field label="Angle (degrees)">
              <input className="field" type="number" value={t.background.gradientAngleDeg ?? 180} onChange={(e) => set({ ...t, background: { ...t.background, gradientAngleDeg: num(e.target.value, 180) } })} />
            </Field>
          </>
        )}
        {t.background.kind === "image" && (
          <Field label="Image file">
            <input type="file" accept="image/*" className="text-xs" onChange={(e) => loadImage(e.target.files?.[0])} />
          </Field>
        )}
      </div>
      <div className="grid grid-cols-5 gap-3">
        <Field label={`Surface opacity (${t.surfaceOpacity.toFixed(2)})`}>
          <input type="range" min={0} max={1} step={0.01} value={t.surfaceOpacity} onChange={(e) => set({ ...t, surfaceOpacity: num(e.target.value, 1) })} />
        </Field>
        <Field label={`Surface blur (${t.surfaceBlurPx}px)`}>
          <input type="range" min={0} max={64} step={1} value={t.surfaceBlurPx} onChange={(e) => set({ ...t, surfaceBlurPx: num(e.target.value, 0) })} />
        </Field>
        <Field label={`Corner radius (${t.radiusPx}px)`}>
          <input type="range" min={0} max={32} step={1} value={t.radiusPx} onChange={(e) => set({ ...t, radiusPx: num(e.target.value, 0) })} />
        </Field>
        <Field label={`Glow (${t.glowIntensity.toFixed(2)})`}>
          <input type="range" min={0} max={1} step={0.05} value={t.glowIntensity} onChange={(e) => set({ ...t, glowIntensity: num(e.target.value, 0) })} />
        </Field>
        <Field label="Font family">
          <input className="field" value={t.fontFamily} maxLength={256} onChange={(e) => set({ ...t, fontFamily: e.target.value })} />
        </Field>
      </div>
      <Field label="Chart palette">
        <span className="flex gap-2">
          {t.chartPalette.map((c, i) => (
            <input
              key={i}
              type="color"
              value={c}
              aria-label={`Chart color ${i + 1}`}
              onChange={(e) => set({ ...t, chartPalette: t.chartPalette.map((x, j) => (j === i ? e.target.value : x)) })}
              className="h-8 w-10 cursor-pointer rounded-theme border border-border bg-transparent"
            />
          ))}
        </span>
      </Field>
      <div className="text-sm">
        {issues.length === 0 ? (
          <p className="text-success">Passes WCAG AA contrast checks.</p>
        ) : (
          <div className="text-warning">
            <p>Contrast below WCAG AA:</p>
            <ul className="ml-5 list-disc">
              {issues.map((i) => (
                <li key={i.pair}>
                  {i.pair}: {i.ratio}:1 (needs {i.required}:1)
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

export function ThemesPage() {
  useTheme();
  const userSettings = useSettings();
  const activeId = userSettings.themeId ?? config.themes.defaultThemeId;
  const [editing, setEditing] = useState<Theme | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const active = allThemes().find((t) => t.id === activeId) ?? allThemes()[0];

  const run = async (f: () => Promise<unknown>) => {
    try {
      await f();
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
      setTimeout(() => setNote(null), config.ui.noticeMs * 2);
    }
  };

  return (
    <div className="flex h-full flex-col gap-3 overflow-auto">
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn" data-tip="Make your own copy of this theme and edit its colors" disabled={!!editing} onClick={() => setEditing({ ...structuredClone(active), id: uniqueThemeId(`${active.name} custom`), name: `${active.name} custom` })}>
          Duplicate and edit
        </button>
        {!isBuiltin(active.id) && (
          <button className="btn" disabled={!!editing} onClick={() => setEditing(structuredClone(active))}>
            Edit
          </button>
        )}
        <button className="btn" data-tip="Load a theme file someone shared with you" onClick={() => run(async () => { const t = await importTheme(); if (t) await selectTheme(t.id); })}>
          Import
        </button>
        <button className="btn" data-tip="Save this theme to a file you can share" onClick={() => run(() => exportTheme(active))}>
          Export
        </button>
        {!isBuiltin(active.id) && (
          <button className="btn" disabled={!!editing} onClick={() => confirm(`Delete theme "${active.name}"?`) && run(() => deleteUserTheme(active.id))}>
            Delete
          </button>
        )}
        {note && <span className="text-sm text-critical">{note}</span>}
      </div>
      {editing && <Editor key={editing.id} initial={editing} onDone={() => setEditing(null)} />}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
        {allThemes().map((t) => (
          <ThemeCard key={t.id} t={t} active={t.id === activeId} onSelect={() => !editing && run(() => selectTheme(t.id))} />
        ))}
      </div>
    </div>
  );
}
