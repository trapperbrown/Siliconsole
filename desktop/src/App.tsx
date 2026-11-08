import { useState } from "react";
import { StatusIndicator } from "./components/StatusIndicator";
import { config } from "./lib/config";
import { dashboards } from "./lib/dashboards";
import { DashboardsPage } from "./pages/DashboardsPage";
import { SensorsPage } from "./pages/SensorsPage";
import { SystemInfoPage } from "./pages/SystemInfoPage";
import { SettingsPage } from "./pages/SettingsPage";
import { ThemesPage } from "./pages/ThemesPage";

const PAGES = [
  { id: "dashboards", label: "Dashboards" },
  { id: "system", label: "System Info" },
  { id: "sensors", label: "Sensors" },
  { id: "themes", label: "Themes" },
  { id: "settings", label: "Settings" },
] as const;
type PageId = (typeof PAGES)[number]["id"];

export function App() {
  const [page, setPage] = useState<PageId>("dashboards");
  const [pinNote, setPinNote] = useState<string | null>(null);
  const pin = (id: string) => {
    const name = dashboards.pin(id);
    setPinNote(name ? `Pinned to ${name}` : "Create a dashboard first");
    setTimeout(() => setPinNote(null), config.ui.noticeMs);
  };
  return (
    <div className="flex h-full gap-3 p-3">
      <nav className="panel flex w-48 shrink-0 flex-col gap-1 p-3" aria-label="Main">
        <div className="mb-4 px-2 text-lg font-bold tracking-wide text-accent">{config.appName}</div>
        {PAGES.map((p) => (
          <button
            key={p.id}
            className={`rounded-theme px-3 py-2 text-left text-sm ${page === p.id ? "bg-accent text-accent-text" : "hover:bg-surface"}`}
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
            <StatusIndicator />
          </div>
        </header>
        <main className="min-h-0 flex-1">
          {page === "system" && <SystemInfoPage />}
          {page === "sensors" && <SensorsPage onPin={pin} />}
          {page === "dashboards" && <DashboardsPage />}
          {page === "themes" && <ThemesPage />}
          {page === "settings" && <SettingsPage />}
        </main>
      </div>
    </div>
  );
}
