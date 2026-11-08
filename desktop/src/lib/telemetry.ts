import { listen } from "@tauri-apps/api/event";
import { useSyncExternalStore } from "react";
import type {
  HardwareEntry,
  HistoryResponse,
  SensorCatalogMessage,
  SensorEntry,
  SensorFrameMessage,
  ServiceHello,
  SystemInfo,
  SystemInfoMessage,
} from "../generated/schema-types";
import { config } from "./config";
import { EVENTS, ipc, type Status } from "./ipc";

export interface SensorLive {
  value: number | null;
  min: number | null;
  max: number | null;
  avg: number | null;
}

interface Stats {
  min: number | null;
  max: number | null;
  sum: number;
  count: number;
  /** Before the first reset, min/max start from the service's own values (since it started). */
  useServiceRange: boolean;
}

type Listener = () => void;

/**
 * Single source of live sensor data for every window. Components subscribe to the sensor ids they
 * show, so one frame never re-renders the whole page. Charts read the ring buffer directly.
 */
class TelemetryStore {
  status: Status = { state: "reconnecting", detail: null };
  hello: ServiceHello | null = null;
  systemInfo: SystemInfo | null = null;
  catalog: SensorCatalogMessage | null = null;
  sensors = new Map<string, SensorEntry>();
  hardware = new Map<string, HardwareEntry>();
  lastFrameAt = 0;

  private live = new Map<string, SensorLive>();
  private stats = new Map<string, Stats>();
  private readonly capacity = config.ringBufferSamples;
  private times = new Float64Array(this.capacity);
  private rings = new Map<string, Float32Array>();
  private head = 0;
  private count = 0;
  private pendingHistory: number | null = null;
  private framesSinceRequest: SensorFrameMessage[] = [];
  /** A response can beat the invoke() promise that returns its request id. */
  private earlyHistory: HistoryResponse | null = null;

  private sensorListeners = new Map<string, Set<Listener>>();
  private metaListeners = new Set<Listener>();
  private frameListeners = new Set<(timestamp: number) => void>();
  private metaVersion = 0;

  async init() {
    await Promise.all([
      listen<Status>(EVENTS.status, (e) => this.setStatus(e.payload)),
      listen<ServiceHello>(EVENTS.hello, (e) => this.setMeta(() => (this.hello = e.payload))),
      listen<SystemInfoMessage>(EVENTS.systemInfo, (e) => this.setMeta(() => (this.systemInfo = e.payload.info))),
      listen<SensorCatalogMessage>(EVENTS.catalog, (e) => this.setCatalog(e.payload)),
      listen<SensorFrameMessage>(EVENTS.frame, (e) => this.applyFrame(e.payload)),
      listen<HistoryResponse>(EVENTS.history, (e) => this.applyHistory(e.payload)),
    ]);
    // Events that fired before this window loaded are replayed from the Rust-side cache.
    const snap = await ipc.getSnapshot();
    this.setStatus(snap.status);
    this.setMeta(() => {
      this.hello = snap.hello;
      this.systemInfo = snap.systemInfo?.info ?? null;
    });
    if (snap.catalog) this.setCatalog(snap.catalog);
  }

  // ---------- subscriptions ----------

  subscribeSensor(id: string, fn: Listener) {
    let set = this.sensorListeners.get(id);
    if (!set) this.sensorListeners.set(id, (set = new Set()));
    set.add(fn);
    return () => {
      set.delete(fn);
    };
  }

  subscribeMeta(fn: Listener) {
    this.metaListeners.add(fn);
    return () => {
      this.metaListeners.delete(fn);
    };
  }

  /** Called once per frame after all values are applied. Charts use this to append a point. */
  subscribeFrame(fn: (timestamp: number) => void) {
    this.frameListeners.add(fn);
    return () => {
      this.frameListeners.delete(fn);
    };
  }

  getLive(id: string): SensorLive | undefined {
    return this.live.get(id);
  }

  getMetaVersion = () => this.metaVersion;

  // ---------- history ----------

  /** Chronological samples newer than `sinceMs`. */
  getHistory(id: string, sinceMs: number): { xs: number[]; ys: (number | null)[] } {
    const ring = this.rings.get(id);
    const xs: number[] = [];
    const ys: (number | null)[] = [];
    if (!ring) return { xs, ys };
    const start = (this.head - this.count + this.capacity) % this.capacity;
    for (let k = 0; k < this.count; k++) {
      const i = (start + k) % this.capacity;
      if (this.times[i] < sinceMs) continue;
      xs.push(this.times[i]);
      ys.push(Number.isNaN(ring[i]) ? null : ring[i]);
    }
    return { xs, ys };
  }

  resetStats(ids?: Iterable<string>) {
    for (const id of ids ?? this.stats.keys()) {
      this.stats.set(id, { min: null, max: null, sum: 0, count: 0, useServiceRange: false });
      const cur = this.live.get(id);
      if (cur) {
        this.live.set(id, { value: cur.value, min: cur.value, max: cur.value, avg: cur.value });
        this.sensorListeners.get(id)?.forEach((fn) => fn());
      }
    }
  }

  // ---------- internals ----------

  private setStatus(s: Status) {
    this.setMeta(() => (this.status = s));
  }

  private setMeta(mutate: () => void) {
    mutate();
    this.metaVersion++;
    this.metaListeners.forEach((fn) => fn());
  }

  private setCatalog(cat: SensorCatalogMessage) {
    this.setMeta(() => {
      this.catalog = cat;
      this.sensors = new Map(cat.sensors.map((s) => [s.id, s]));
      this.hardware = new Map(cat.hardware.map((h) => [h.id, h]));
      for (const s of cat.sensors) {
        if (!this.rings.has(s.id)) this.rings.set(s.id, new Float32Array(this.capacity).fill(NaN));
      }
    });
    this.framesSinceRequest = [];
    this.earlyHistory = null;
    this.pendingHistory = -1;
    ipc
      .requestHistory(cat.sensors.map((s) => s.id), this.capacity)
      .then((id) => {
        this.pendingHistory = id;
        if (this.earlyHistory?.requestId === id) this.applyHistory(this.earlyHistory);
        this.earlyHistory = null;
      })
      .catch(() => {
        this.pendingHistory = null;
        this.framesSinceRequest = [];
      });
  }

  private applyHistory(h: HistoryResponse) {
    if (this.pendingHistory === -1) {
      this.earlyHistory = h;
      return;
    }
    if (h.requestId !== this.pendingHistory) return;
    this.pendingHistory = null;
    const n = Math.min(h.timestamps.length, this.capacity);
    const offset = h.timestamps.length - n;
    this.times = new Float64Array(this.capacity);
    for (let k = 0; k < n; k++) this.times[k] = h.timestamps[offset + k];
    for (const ring of this.rings.values()) ring.fill(NaN);
    for (const s of h.series) {
      const ring = this.rings.get(s.id);
      if (!ring) continue;
      for (let k = 0; k < n; k++) ring[k] = s.values[offset + k] ?? NaN;
    }
    this.head = n % this.capacity;
    this.count = n;
    // Frames that arrived while the request was in flight.
    const last = n ? this.times[n - 1] : 0;
    for (const f of this.framesSinceRequest) if (f.timestamp > last) this.appendRing(f);
    this.framesSinceRequest = [];
    this.metaVersion++;
    this.metaListeners.forEach((fn) => fn());
  }

  private appendRing(f: SensorFrameMessage) {
    this.times[this.head] = f.timestamp;
    for (const ring of this.rings.values()) ring[this.head] = NaN;
    for (const v of f.values) {
      const ring = this.rings.get(v.id);
      if (ring) ring[this.head] = v.value ?? NaN;
    }
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }

  private applyFrame(f: SensorFrameMessage) {
    this.lastFrameAt = f.timestamp;
    if (this.pendingHistory !== null && this.framesSinceRequest.length < this.capacity) this.framesSinceRequest.push(f);
    this.appendRing(f);
    for (const v of f.values) {
      let st = this.stats.get(v.id);
      if (!st) this.stats.set(v.id, (st = { min: null, max: null, sum: 0, count: 0, useServiceRange: true }));
      if (v.value !== null) {
        st.sum += v.value;
        st.count++;
        if (st.useServiceRange) {
          st.min = v.min ?? v.value;
          st.max = v.max ?? v.value;
        } else {
          st.min = st.min === null ? v.value : Math.min(st.min, v.value);
          st.max = st.max === null ? v.value : Math.max(st.max, v.value);
        }
      }
      this.live.set(v.id, { value: v.value, min: st.min, max: st.max, avg: st.count ? st.sum / st.count : null });
      this.sensorListeners.get(v.id)?.forEach((fn) => fn());
    }
    this.frameListeners.forEach((fn) => fn(f.timestamp));
  }
}

export const telemetry = new TelemetryStore();

// ---------- hooks ----------

const noop = () => () => {};

/** Re-renders only when this sensor gets a new value. */
export function useSensor(id: string | undefined): SensorLive | undefined {
  return useSyncExternalStore(
    id ? (fn) => telemetry.subscribeSensor(id, fn) : noop,
    () => (id ? telemetry.getLive(id) : undefined),
  );
}

/** Re-renders on status, hello, system info, catalog or history changes (rare). */
export function useTelemetryMeta() {
  useSyncExternalStore((fn) => telemetry.subscribeMeta(fn), telemetry.getMetaVersion);
  return telemetry;
}
