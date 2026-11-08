import { invoke } from "@tauri-apps/api/core";
import type { SensorCatalogMessage, ServiceHello, SystemInfoMessage, UserSettings } from "../generated/schema-types";

/** Event names emitted by src-tauri/src/pipe.rs. */
export const EVENTS = {
  status: "telemetry://status",
  hello: "telemetry://hello",
  systemInfo: "telemetry://system_info",
  catalog: "telemetry://catalog",
  frame: "telemetry://frame",
  history: "telemetry://history",
  settings: "settings://changed",
} as const;

export type ConnState = "connected" | "reconnecting" | "not_installed";
export interface Status {
  state: ConnState;
  detail: string | null;
}

export interface Snapshot {
  status: Status;
  hello: ServiceHello | null;
  systemInfo: SystemInfoMessage | null;
  catalog: SensorCatalogMessage | null;
}

export type DocumentKind = "dashboards" | "themes";

export const ipc = {
  getSnapshot: () => invoke<Snapshot>("get_snapshot"),
  requestHistory: (ids: string[], maxSamples?: number) => invoke<number>("request_history", { ids, maxSamples }),
  getSettings: () => invoke<UserSettings>("get_settings"),
  saveSettings: (settings: UserSettings) => invoke<void>("save_settings", { settings }),
  listDocuments: <T>(kind: DocumentKind) => invoke<T[]>("list_documents", { kind }),
  saveDocument: (kind: DocumentKind, doc: unknown) => invoke<void>("save_document", { kind, doc }),
  deleteDocument: (kind: DocumentKind, id: string) => invoke<void>("delete_document", { kind, id }),
  exportFile: (defaultName: string, extension: string, contents: string) =>
    invoke<boolean>("export_file", { defaultName, extension, contents }),
  importFile: (extension: string) => invoke<string | null>("import_file", { extension }),
  pickFolder: () => invoke<string | null>("pick_folder"),
};
