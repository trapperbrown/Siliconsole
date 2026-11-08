import { config } from "../lib/config";
import { useTelemetryMeta } from "../lib/telemetry";

const LABELS = {
  connected: { text: "Connected", dot: "bg-success" },
  reconnecting: { text: "Reconnecting", dot: "bg-warning" },
  not_installed: { text: "Service not installed", dot: "bg-critical" },
} as const;

export function StatusIndicator() {
  const t = useTelemetryMeta();
  const { state, detail } = t.status;
  const label = LABELS[state];
  return (
    <div className="flex items-center gap-2 text-sm" role="status" aria-live="polite">
      <span className={`inline-block h-2.5 w-2.5 rounded-full ${label.dot} ${state === "connected" ? "pulse text-success" : ""}`} aria-hidden />
      <span>{label.text}</span>
      {state === "connected" && t.hello && <span className="text-muted">{t.hello.intervalMs} ms</span>}
      {state === "reconnecting" && detail && <span className="text-muted">{detail}</span>}
    </div>
  );
}

/** Full-width help shown on pages that need live data while the service is unreachable. */
export function ServiceHelp() {
  const t = useTelemetryMeta();
  if (t.status.state === "connected") return null;
  const notInstalled = t.status.state === "not_installed";
  return (
    <div className="panel mb-3 p-4 text-sm">
      <p className={notInstalled ? "text-critical" : "text-warning"}>
        {notInstalled ? `The ${config.service.displayName} is not installed.` : `Waiting for the ${config.service.displayName}.`}
      </p>
      <p className="mt-1 text-muted">
        {notInstalled
          ? `Run the ${config.appName} installer again, or from an elevated PowerShell in the source folder run scripts/install-service.ps1.`
          : `If this persists, open Services (services.msc) and start "${config.service.displayName}". Logs are in %ProgramData%\\${config.service.programDataFolder}\\${config.serviceLog.subfolder}.`}
      </p>
    </div>
  );
}
