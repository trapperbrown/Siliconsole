import { useState } from "react";
import type { Widget, WidgetType } from "../generated/schema-types";
import { DashboardGrid } from "../components/DashboardGrid";
import { ServiceHelp } from "../components/StatusIndicator";
import { WidgetSettingsPanel } from "../components/WidgetSettingsPanel";
import { config } from "../lib/config";
import { newWidgetId, useDashboards } from "../lib/dashboards";
import { settings, useSettings } from "../lib/settings";
import { WIDGETS } from "../widgets/registry";

export function DashboardsPage() {
  const store = useDashboards();
  const userSettings = useSettings();
  const d = store.active();
  const [editing, setEditing] = useState(false);
  const [editingWidget, setEditingWidget] = useState<Widget | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const flash = (msg: string) => {
    setNote(msg);
    setTimeout(() => setNote(null), config.ui.noticeMs);
  };
  const run = async (f: () => Promise<unknown>) => {
    try {
      await f();
    } catch (e) {
      flash(e instanceof Error ? e.message : String(e));
    }
  };

  const addWidget = (type: WidgetType) => {
    if (!d) return;
    const { w, h } = config.dashboards.newWidgetSize;
    const y = d.widgets.reduce((m, x) => Math.max(m, x.y + x.h), 0);
    const widget: Widget = { id: newWidgetId(), type, x: 0, y, w, h, sensorIds: [], settings: {} };
    store.update({ ...d, widgets: [...d.widgets, widget] });
    setEditingWidget(widget);
  };

  const isOverlay = d && userSettings.overlayDashboardId === d.id;

  return (
    <div className="flex h-full flex-col">
      <ServiceHelp />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {renaming !== null && d ? (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (renaming.trim()) store.update({ ...d, name: renaming.trim() });
              setRenaming(null);
            }}
          >
            <input className="field w-56" autoFocus maxLength={64} value={renaming} onChange={(e) => setRenaming(e.target.value)} aria-label="Dashboard name" />
            <button className="btn btn-accent" type="submit">
              Save name
            </button>
          </form>
        ) : (
          <select className="field w-56" value={d?.id ?? ""} onChange={(e) => run(() => store.setActive(e.target.value))} aria-label="Active dashboard">
            {store.list.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        )}
        <button className={`btn ${editing ? "btn-accent" : ""}`} onClick={() => setEditing(!editing)} disabled={!d}>
          {editing ? "Done editing" : "Edit"}
        </button>
        {editing && d && (
          <>
            <select className="field" value="" onChange={(e) => e.target.value && addWidget(e.target.value as WidgetType)} aria-label="Add widget">
              <option value="">Add widget</option>
              {Object.entries(WIDGETS).map(([type, k]) => (
                <option key={type} value={type}>
                  {k.label}
                </option>
              ))}
            </select>
            <button className="btn" onClick={() => setRenaming(d.name)}>
              Rename
            </button>
          </>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {note && <span className="text-sm text-muted">{note}</span>}
          <button className="btn" onClick={() => run(() => store.create(`Dashboard ${store.list.length + 1}`))}>
            New
          </button>
          <button className="btn" disabled={!d} onClick={() => d && run(() => store.duplicate(d))}>
            Duplicate
          </button>
          <button className="btn" disabled={!d} onClick={() => d && run(async () => (await store.exportDashboard(d)) && flash("Dashboard exported"))}>
            Export
          </button>
          <button className="btn" onClick={() => run(async () => { const name = await store.importDashboard(); if (name) flash(`Imported ${name}`); })}>
            Import
          </button>
          <button className={`btn ${isOverlay ? "btn-accent" : ""}`} disabled={!d} onClick={() => d && run(() => settings.update({ overlayDashboardId: d.id }))} title={`Overlay hotkey: ${config.overlay.hotkey.replace("CommandOrControl", "Ctrl")}`}>
            {isOverlay ? "Overlay dashboard" : "Use for overlay"}
          </button>
          <button className="btn" disabled={!d} onClick={() => d && confirm(`Delete dashboard "${d.name}"?`) && run(() => store.remove(d.id))}>
            Delete
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {!d && <p className="text-muted">No dashboards yet. They are created from the starter templates once sensor data arrives, or click New.</p>}
        {d && d.widgets.length === 0 && <p className="mb-2 text-sm text-muted">This dashboard is empty. Click Edit, then Add widget, or pin sensors from the Sensors page.</p>}
        {d && (
          <DashboardGrid
            dashboard={d}
            editing={editing}
            onChange={(next) => store.update(next)}
            onEditWidget={setEditingWidget}
            onRemoveWidget={(w) => store.update({ ...d, widgets: d.widgets.filter((x) => x.id !== w.id) })}
          />
        )}
      </div>
      {editingWidget && d && (
        <WidgetSettingsPanel
          widget={editingWidget}
          onClose={() => setEditingWidget(null)}
          onSave={(w) => {
            store.update({ ...d, widgets: d.widgets.map((x) => (x.id === w.id ? w : x)) });
            setEditingWidget(null);
          }}
        />
      )}
    </div>
  );
}
