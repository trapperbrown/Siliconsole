import { emit, listen } from "@tauri-apps/api/event";
import { useSyncExternalStore } from "react";
import dashboardSchema from "@shared/schemas/dashboard.schema.json";
import type { Dashboard, SensorCatalogMessage, SensorQuery, Widget, WidgetType } from "../generated/schema-types";
import { config } from "./config";
import { ipc } from "./ipc";
import { settings } from "./settings";
import { telemetry } from "./telemetry";
import { validate } from "./validate";

const DASHBOARDS_CHANGED = "dashboards://changed";
const save = async (d: Dashboard) => {
  await ipc.saveDocument("dashboards", d);
  await emit(DASHBOARDS_CHANGED);
};

const templateModules = import.meta.glob<Dashboard>("../../../shared/dashboards/*.json", { eager: true, import: "default" });
const templates = config.dashboards.starterIds
  .map((id) => Object.values(templateModules).find((d) => d.id === id))
  .filter((d): d is Dashboard => !!d);

export const newWidgetId = () => Math.random().toString(36).slice(2, 10);

export function slugify(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "dashboard";
  return base;
}

/** Resolves a template query against the live catalog. Hardware type order in the query is a preference. */
function runQuery(q: SensorQuery, cat: SensorCatalogMessage): string[] {
  const hwType = new Map(cat.hardware.map((h) => [h.id, h.hardwareType]));
  const name = q.namePattern ? new RegExp(q.namePattern) : null;
  const exclude = q.excludePattern ? new RegExp(q.excludePattern) : null;
  const rank = (hwId: string) => (q.hardwareTypes ? q.hardwareTypes.indexOf(hwType.get(hwId) ?? "") : 0);
  const matches = cat.sensors
    .filter((s) => rank(s.hardwareId) >= 0)
    .filter((s) => !q.sensorTypes || q.sensorTypes.includes(s.sensorType))
    .filter((s) => (!name || name.test(s.name)) && (!exclude || !exclude.test(s.name)))
    .map((s, i) => ({ s, i }))
    .sort((a, b) => rank(a.s.hardwareId) - rank(b.s.hardwareId) || a.i - b.i);
  // With several hardware types listed, a same-named sensor on less preferred hardware is skipped
  // (e.g. "GPU Core" on an iGPU when a discrete GPU also has one).
  const seen = new Set<string>();
  const picked = (q.hardwareTypes?.length ?? 0) > 1 ? matches.filter(({ s }) => !seen.has(s.name) && !!seen.add(s.name)) : matches;
  const ids = picked.map(({ s }) => s.id);
  return ids.slice(0, Math.min(q.limit ?? Infinity, config.dashboards.maxSensorsPerWidget));
}

/** Turns a starter template into a concrete dashboard for this machine. Widgets with no match are dropped. */
export function materialize(template: Dashboard, cat: SensorCatalogMessage): Dashboard {
  const widgets: Widget[] = [];
  // When a widget is dropped, slide later widgets on the same row left so no gap is left behind.
  const gaps: { fromX: number; y0: number; y1: number; by: number }[] = [];
  const shifted = (x: number, y: number) => x - gaps.filter((g) => x > g.fromX && y >= g.y0 && y < g.y1).reduce((n, g) => n + g.by, 0);
  for (const t of template.widgets) {
    const w = { ...t, x: shifted(t.x, t.y) };
    const { sensorQuery, ...rest } = w;
    if (!sensorQuery) {
      widgets.push(rest);
      continue;
    }
    const ids = runQuery(sensorQuery, cat);
    if (!ids.length) {
      gaps.push({ fromX: t.x, y0: t.y, y1: t.y + t.h, by: t.w });
      continue;
    }
    if (sensorQuery.expand === "all") {
      widgets.push({ ...rest, sensorIds: ids });
      continue;
    }
    const perRow = Math.max(1, Math.floor((config.dashboards.gridColumns - w.x) / w.w));
    ids.forEach((id, k) => {
      widgets.push({ ...rest, id: `${w.id}-${k}`, sensorIds: [id], x: w.x + (k % perRow) * w.w, y: w.y + Math.floor(k / perRow) * w.h });
    });
  }
  return { schemaVersion: template.schemaVersion, id: template.id, name: template.name, widgets };
}

class DashboardStore {
  list: Dashboard[] = [];
  private listeners = new Set<() => void>();
  private version = 0;
  private saveTimers = new Map<string, ReturnType<typeof setTimeout>>();

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getVersion = () => this.version;

  private emit() {
    this.version++;
    this.listeners.forEach((fn) => fn());
  }

  private async load() {
    this.list = (await ipc.listDocuments<Dashboard>("dashboards")).filter((d) => validate(dashboardSchema, d).length === 0);
    this.emit();
  }

  /** The main window owns dashboards; a follower (the overlay) just reloads when they change on disk. */
  async init(follower = false) {
    await this.load();
    if (follower) {
      await listen(DASHBOARDS_CHANGED, () => this.load());
      return;
    }
    if (!settings.value.startersCreated) {
      const create = () => this.createStarters();
      if (telemetry.catalog) await create();
      else {
        const off = telemetry.subscribeMeta(() => {
          if (telemetry.catalog) {
            off();
            create();
          }
        });
      }
    }
  }

  private async createStarters() {
    const cat = telemetry.catalog!;
    for (const t of templates) {
      if (this.list.some((d) => d.id === t.id)) continue;
      const d = materialize(t, cat);
      await save(d);
      this.list.push(d);
    }
    this.list.sort((a, b) => a.name.localeCompare(b.name));
    await settings.update({ startersCreated: true });
    this.emit();
  }

  get(id: string | undefined) {
    return this.list.find((d) => d.id === id);
  }

  active(): Dashboard | undefined {
    return this.get(settings.activeDashboardId) ?? this.list[0];
  }

  async setActive(id: string) {
    await settings.update({ activeDashboardId: id });
    this.emit();
  }

  /** Updates in memory immediately; writes to disk after a short debounce (drags fire many changes). */
  update(d: Dashboard) {
    this.list = this.list.map((x) => (x.id === d.id ? d : x));
    this.emit();
    clearTimeout(this.saveTimers.get(d.id));
    this.saveTimers.set(
      d.id,
      setTimeout(() => save(d), config.dashboards.saveDebounceMs),
    );
  }

  uniqueId(name: string) {
    const base = slugify(name);
    let id = base;
    for (let n = 2; this.list.some((d) => d.id === id); n++) id = `${base}-${n}`;
    return id;
  }

  async add(d: Dashboard) {
    const errors = validate(dashboardSchema, d);
    if (errors.length) throw new Error(errors.join("; "));
    await save(d);
    this.list = [...this.list.filter((x) => x.id !== d.id), d].sort((a, b) => a.name.localeCompare(b.name));
    await this.setActive(d.id);
  }

  async create(name: string) {
    await this.add({ schemaVersion: 1, id: this.uniqueId(name), name, widgets: [] });
  }

  async duplicate(d: Dashboard) {
    const name = `${d.name} copy`;
    await this.add({ ...structuredClone(d), id: this.uniqueId(name), name });
  }

  async remove(id: string) {
    await ipc.deleteDocument("dashboards", id);
    await emit(DASHBOARDS_CHANGED);
    this.list = this.list.filter((d) => d.id !== id);
    if (settings.activeDashboardId === id && this.list[0]) await this.setActive(this.list[0].id);
    this.emit();
  }

  async exportDashboard(d: Dashboard) {
    return ipc.exportFile(`${d.id}.json`, "json", JSON.stringify(d, null, 2));
  }

  /** Imports a dashboard file. Templates (with sensorQuery) are resolved against this machine. */
  async importDashboard(): Promise<string | null> {
    const text = await ipc.importFile("json");
    if (text === null) return null;
    let parsed: Dashboard;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error("The file is not valid JSON.");
    }
    const errors = validate(dashboardSchema, parsed);
    if (errors.length) throw new Error(`Not a valid dashboard: ${errors.join("; ")}`);
    let d = parsed.widgets.some((w) => w.sensorQuery) && telemetry.catalog ? materialize(parsed, telemetry.catalog) : parsed;
    if (this.list.some((x) => x.id === d.id)) d = { ...d, id: this.uniqueId(d.name), name: `${d.name} (imported)` };
    delete (d as { $schema?: string }).$schema;
    await this.add(d);
    return d.name;
  }

  /** The Sensors page pin button: appends a widget for one sensor to the active dashboard. */
  pin(sensorId: string) {
    const d = this.active();
    if (!d) return false;
    const type: WidgetType = telemetry.sensors.get(sensorId)?.sensorType === "Fan" ? "fanList" : "sparkline";
    const { w, h } = config.dashboards.newWidgetSize;
    const y = d.widgets.reduce((m, x) => Math.max(m, x.y + x.h), 0);
    this.update({ ...d, widgets: [...d.widgets, { id: newWidgetId(), type, x: 0, y, w, h, sensorIds: [sensorId], settings: {} }] });
    return d.name;
  }
}

export const dashboards = new DashboardStore();

export function useDashboards() {
  useSyncExternalStore(dashboards.subscribe, dashboards.getVersion);
  return dashboards;
}
