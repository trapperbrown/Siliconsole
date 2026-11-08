import { useState } from "react";
import { StatusIndicator } from "./components/StatusIndicator";
import { Tooltips } from "./components/Tooltips";
import { Tour } from "./components/Tour";
import { config } from "./lib/config";
import { dashboards } from "./lib/dashboards";
import { settings } from "./lib/settings";
import { DashboardsPage } from "./pages/DashboardsPage";
import { GuidePage } from "./pages/GuidePage";
import { SensorsPage } from "./pages/SensorsPage";
import { SystemInfoPage } from "./pages/SystemInfoPage";
import { SettingsPage } from "./pages/SettingsPage";
import { ThemesPage } from "./pages/ThemesPage";

const PAGES = [
  { id: "dashboards", label: "Dashboards", tip: "Your live sensor dashboards" },
  { id: "system", label: "System Info", tip: "CPU, motherboard, memory, GPU, drives and Windows details" },
  { id: "sensors", label: "Sensors", tip: "Every sensor reading with min, max and average" },
  { id: "themes", label: "Themes", tip: "Change the app's colors and background" },
  { id: "settings", label: "Settings", tip: "Units, alerts, logging, tray and overlay" },
  { id: "guide", label: "Guide", tip: "Help, the tour, and about this app" },
] as const;
type PageId = (typeof PAGES)[number]["id"];

export function App() {
  const [page, setPage] = useState<PageId>("dashboards");
  const [pinNote, setPinNote] = useState<string | null>(null);
  // The tour runs once on first launch; the Guide page can replay it.
  const [touring, setTouring] = useState(!settings.value.tourSeen);
  const endTour = () => {
    setTouring(false);
    setPage("dashboards");
    settings.update({ tourSeen: true });
  };
  const pin = (id: string) => {
    const name = dashboards.pin(id);
    setPinNote(name ? `Pinned to ${name}` : "Create a dashboard first");
    setTimeout(() => setPinNote(null), config.ui.noticeMs);
  };
  return (
    <div className="flex h-full gap-3 p-3">
      <nav className="panel flex w-48 shrink-0 flex-col gap-1 p-3" aria-label="Main" data-tour="nav">
        <div className="mb-4 px-2 text-lg font-bold tracking-wide text-accent">{config.appName}</div>
        {PAGES.map((p) => (
          <button
            key={p.id}
            data-tour={`nav-${p.id}`}
            data-tip={p.tip}
            className={`rounded-theme px-3 py-2 text-left text-sm ${page === p.id ? "bg-accent text-accent-text" : "hover:bg-surface"} ${p.id === "guide" ? "mt-auto" : ""}`}
            aria-current={page === p.id ? "page" : undefined}
            onClick={() => setPage(p.id)}
          >
            {p.label}
          </button>
        ))}
      </nav>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <header className="panel flex items-center justify-between px-4 py-2">
          <h1 className="text-base font-semibold">{PAGES.find((p) => p.id === page)?.label}</h1>
          <div className="flex items-center gap-4">
            {pinNote && <span className="text-sm text-accent">{pinNote}</span>}
            <div data-tour="status" data-tip="Whether the background sensor service is connected">
              <StatusIndicator />
            </div>
          </div>
        </header>
        <main className="min-h-0 flex-1">
          {page === "system" && <SystemInfoPage />}
          {page === "sensors" && <SensorsPage onPin={pin} />}
          {page === "dashboards" && <DashboardsPage />}
          {page === "themes" && <ThemesPage />}
          {page === "settings" && <SettingsPage />}
          {page === "guide" && <GuidePage onTour={() => setTouring(true)} />}
        </main>
      </div>
      <Tooltips />
      {touring && <Tour onPage={(p) => setPage(p as PageId)} onDone={endTour} />}
    </div>
  );
}
