import { listen } from "@tauri-apps/api/event";
import { useSyncExternalStore } from "react";
import type { TemperatureUnit, UserSettings } from "../generated/schema-types";
import { config } from "./config";
import { EVENTS, ipc } from "./ipc";

/** Per-user settings (saved by Rust to %APPDATA%), with defaults.json filling the gaps. */
class SettingsStore {
  value: UserSettings = {};
  private listeners = new Set<() => void>();

  async init() {
    await listen<UserSettings>(EVENTS.settings, (e) => this.set(e.payload));
    this.set(await ipc.getSettings());
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  get = () => this.value;

  private set(v: UserSettings) {
    this.value = v;
    this.listeners.forEach((fn) => fn());
  }

  async update(patch: Partial<UserSettings>) {
    const next = { ...this.value, ...patch };
    await ipc.saveSettings(next);
    this.set(next);
  }

  get temperatureUnit(): TemperatureUnit {
    return this.value.temperatureUnit ?? config.units.temperature;
  }
  get themeId() {
    return this.value.themeId ?? config.themes.defaultThemeId;
  }
  get activeDashboardId() {
    return this.value.activeDashboardId ?? config.dashboards.defaultDashboardId;
  }
}

export const settings = new SettingsStore();

export function useSettings(): UserSettings {
  return useSyncExternalStore(settings.subscribe, settings.get);
}
