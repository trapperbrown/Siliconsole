import { useMemo, useState } from "react";
import type { Dashboard } from "../generated/schema-types";
import { config } from "../lib/config";
import { materialize, presets, useDashboards } from "../lib/dashboards";
import { settings } from "../lib/settings";
import { telemetry, useTelemetryMeta } from "../lib/telemetry";
import { WIDGETS } from "../widgets/registry";
import { DashboardGrid } from "./DashboardGrid";

/** A to-scale sketch of a dashboard's layout: one labeled box per widget. */
export function LayoutPreview({ dashboard }: { dashboard: Dashboard }) {
  const cols = config.dashboards.gridColumns;
  const rows = Math.max(1, ...dashboard.widgets.map((w) => w.y + w.h));
  return (
    <div className="relative w-full overflow-hidden rounded-theme border border-border bg-bg" style={{ aspectRatio: "16 / 9" }} aria-hidden>
      {dashboard.widgets.map((w) => (
        <div
          key={w.id}
          className="absolute overflow-hidden rounded-theme border border-accent bg-surface px-1 text-[9px] leading-tight text-muted"
          style={{ left: `${(w.x / cols) * 100}%`, top: `${(w.y / rows) * 100}%`, width: `calc(${(w.w / cols) * 100}% - 2px)`, height: `calc(${(w.h / rows) * 100}% - 2px)` }}
        >
          <span className="text-accent">{WIDGETS[w.type].icon}</span> {w.settings.label ?? telemetry.sensors.get(w.sensorIds[0] ?? "")?.name ?? WIDGETS[w.type].label}
        </div>
      ))}
      {!dashboard.widgets.length && <div className="absolute inset-0 flex items-center justify-center text-xs text-muted">Empty</div>}
    </div>
  );
}

const BLANK: Dashboard = { schemaVersion: 1, id: "blank", name: "My dashboard", description: "Start empty and add exactly the widgets you want.", widgets: [] };

/** Two steps: pick a preset (or blank), then name it and check a live preview. */
export function NewDashboardWizard({ onClose }: { onClose: () => void }) {
  const t = useTelemetryMeta();
  const store = useDashboards();
  const [picked, setPicked] = useState<Dashboard | null>(null);
  const [name, setName] = useState("");
  const [forOverlay, setForOverlay] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Presets resolved against this PC, so previews show only widgets this hardware can fill.
  const resolved = useMemo(() => new Map([BLANK, ...presets].map((p) => [p, t.catalog && p !== BLANK ? materialize(p, t.catalog) : p])), [t.catalog]);

  const pick = (p: Dashboard) => {
    setPicked(p);
    setName(p.name);
    setForOverlay(p.id === "compact");
  };
  const create = async () => {
    try {
      const id = await store.createFrom(picked === BLANK ? null : picked, name.trim() || BLANK.name);
      if (forOverlay) await settings.update({ overlayDashboardId: id });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/70 p-6" role="dialog" aria-modal aria-label="New dashboard" onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div className="panel flex max-h-full w-[64rem] flex-col gap-3 bg-surface-solid p-4">
        <div className="flex items-center gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted">Step {picked ? 2 : 1} of 2</p>
            <h2 className="font-semibold">{picked ? "Name it and check the preview" : "Pick a starting point"}</h2>
          </div>
          <button className="btn ml-auto" onClick={onClose}>
            Cancel
          </button>
        </div>

        {!picked && (
          <div className="grid min-h-0 grid-cols-2 gap-3 overflow-auto lg:grid-cols-3">
            {[BLANK, ...presets].map((p) => {
              const r = resolved.get(p)!;
              return (
                <button key={p.id} className="btn flex flex-col gap-2 p-2 text-left" onClick={() => pick(p)}>
                  <LayoutPreview dashboard={r} />
                  <span className="font-medium">{p === BLANK ? "Blank" : p.name}</span>
                  <span className="text-xs text-muted">{p.description}</span>
                  {p !== BLANK && t.catalog && <span className="text-xs text-accent">{r.widgets.length} widgets for your PC</span>}
                </button>
              );
            })}
          </div>
        )}

        {picked && (
          <>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <label className="flex items-center gap-2">
                Name
                <input className="field w-64" autoFocus maxLength={64} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && create()} />
              </label>
              <label className="flex items-center gap-2" data-tip="The overlay is the small always-on-top window you toggle in games.">
                <input type="checkbox" checked={forOverlay} onChange={(e) => setForOverlay(e.target.checked)} />
                Show this dashboard on the overlay ({config.overlay.hotkey.replace("CommandOrControl", "Ctrl")})
              </label>
            </div>
            <div className="min-h-48 flex-1 overflow-auto rounded-theme border border-border p-2">
              {picked === BLANK ? (
                <p className="p-4 text-sm text-muted">Your dashboard starts empty. After you create it, click Edit, then Add widget to choose widgets with live previews.</p>
              ) : (
                <>
                  <p className="mb-2 text-xs text-muted">Live preview with your sensors. You can move, resize and change any widget afterwards with Edit.</p>
                  <DashboardGrid dashboard={resolved.get(picked)!} />
                </>
              )}
            </div>
            {error && <p className="text-sm text-critical">{error}</p>}
            <div className="flex justify-end gap-2">
              <button className="btn" onClick={() => setPicked(null)}>
                Back
              </button>
              <button className="btn btn-accent" onClick={create}>
                Create dashboard
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
