import { getVersion } from "@tauri-apps/api/app";
import { useEffect, useState, type ReactNode } from "react";
import { config } from "../lib/config";
import { UpdateCheck } from "../components/UpdateCheck";

const hotkey = config.overlay.hotkey.replace("CommandOrControl", "Ctrl");

const TOPICS: { q: string; a: ReactNode }[] = [
  {
    q: "How do I make my own dashboard?",
    a: (
      <>
        On the Dashboards page click <b>New</b>. Pick a preset (each card shows its layout and how many widgets your PC can fill) or Blank, then name it. To change it later click{" "}
        <b>Edit</b>: drag widgets to move them, drag a corner to resize, use <b>Add widget</b> to add one, and click a widget's gear to pick its sensor, label, range and warning colors.
      </>
    ),
  },
  {
    q: "How does the in-game overlay work?",
    a: (
      <>
        Press <kbd>{hotkey}</kbd> to show or hide a small always-on-top window that clicks pass through. It shows the dashboard you picked with <b>Use for overlay</b>. The{" "}
        <b>Compact overlay</b> preset is made for it. In Settings you can choose which monitors show it (click each screen, or All) and change its size, corner, scale and opacity. If it is too small, whole widgets are hidden, lowest on the dashboard
        first, so put the ones you care about at the top. Games must run in borderless or windowed mode for the overlay to appear over them.
      </>
    ),
  },
  {
    q: "Why are some sensors missing or showing nothing?",
    a: (
      <>
        Many sensors (CPU temperatures, motherboard fans and voltages) need the free PawnIO driver. The installer offers it; if you skipped it, run the installer again. Some hardware simply does
        not report certain values, for example newer NVIDIA cards have no hotspot sensor. Preset widgets for sensors your PC lacks are left out automatically.
      </>
    ),
  },
  {
    q: 'The header says "Reconnecting" or "Service not installed"',
    a: (
      <>
        The background service (<code>{config.service.displayName}</code>) reads the sensors. Open Windows Services and check it is running, or reinstall {config.appName}. The app reconnects by
        itself once the service is back.
      </>
    ),
  },
  {
    q: "How do I get alerts or log data?",
    a: (
      <>
        Settings, Alerts: add a sensor and a limit, and Windows shows a notification when it is crossed. Settings, CSV logging: pick a folder and sensors, then turn logging on to get a file you can
        open in Excel.
      </>
    ),
  },
  {
    q: "Can I share a dashboard or theme with friends?",
    a: (
      <>
        Yes. Use <b>Export</b> on the Dashboards or Themes page to save a file, send it, and they use <b>Import</b>. Dashboards made from presets adapt to their hardware.
      </>
    ),
  },
  {
    q: "Is it safe with anti-cheat and antivirus?",
    a: (
      <>
        {config.appName} only reads sensors; it never changes clocks, fans or voltages. PawnIO is a signed driver designed to work with anti-cheat, but if a game complains, quit {config.appName}{" "}
        while you play. Some antivirus tools flag unsigned apps that install a driver.
      </>
    ),
  },
  {
    q: "How do I uninstall?",
    a: (
      <>
        Windows Settings, Apps, Installed apps, {config.appName}, Uninstall. This removes the app and its service. Your dashboards and themes stay in <code>%APPDATA%\{config.appDataFolder}</code>.
        PawnIO is separate and can be removed from the same list.
      </>
    ),
  },
];

export function GuidePage({ onTour }: { onTour: () => void }) {
  const [version, setVersion] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    getVersion().then(setVersion).catch(() => setVersion(""));
  }, []);

  return (
    <div className="grid h-full content-start gap-3 overflow-auto lg:grid-cols-3">
      <section className="panel flex flex-col gap-3 p-4 lg:col-span-2">
        <div className="flex items-center gap-3">
          <div>
            <h2 className="font-semibold text-accent">New here?</h2>
            <p className="text-sm text-muted">A one-minute tour of every page.</p>
          </div>
          <button className="btn btn-accent ml-auto" onClick={onTour}>
            Take the tour
          </button>
        </div>
        <h2 className="mt-2 font-semibold text-accent">Questions</h2>
        {TOPICS.map((t) => (
          <details key={t.q} className="rounded-theme border border-border px-3 py-2 text-sm">
            <summary className="cursor-pointer font-medium">{t.q}</summary>
            <p className="selectable mt-2 leading-relaxed text-muted">{t.a}</p>
          </details>
        ))}
      </section>
      <section className="panel flex flex-col gap-2 p-4 text-sm">
        <h2 className="font-semibold text-accent">About</h2>
        <p className="text-lg font-bold">
          {config.appName} {version && <span className="text-sm font-normal text-muted">version {version}</span>}
        </p>
        <p className="text-muted">A free Windows hardware monitor: system info, live sensors, dashboards, themes and an in-game overlay.</p>
        <p className="text-muted">
          Free and open source under the MIT License. Provided as is, with no warranty of any kind; you use it at your own risk.
        </p>
        <p className="text-muted">Sensor readings come from LibreHardwareMonitor and the PawnIO driver. Third-party licenses are in THIRD_PARTY_NOTICES.md in the install folder.</p>
        <div className="mt-2 flex items-center gap-2">
          <span className="selectable min-w-0 flex-1 truncate">{config.ui.repoUrl}</span>
          <button
            className="btn"
            data-tip="Copy the project's web address, to get updates or report a problem"
            onClick={() => navigator.clipboard.writeText(config.ui.repoUrl).then(() => setCopied(true))}
          >
            {copied ? "Copied" : "Copy link"}
          </button>
        </div>
        <UpdateCheck />
      </section>
    </div>
  );
}
