import { useEffect, useState } from "react";
import { config } from "../lib/config";

export interface TourStep {
  page: string;
  /** Matches a `data-tour` attribute. */
  target: string;
  title: string;
  body: string;
}

const hotkey = config.overlay.hotkey.replace("CommandOrControl", "Ctrl");

export const TOUR: TourStep[] = [
  { page: "dashboards", target: "nav", title: `Welcome to ${config.appName}`, body: "These are the main pages. This quick tour takes about a minute. You can replay it from the Guide page any time." },
  { page: "dashboards", target: "dash-select", title: "Your dashboards", body: "Switch between dashboards here. Gaming, Thermals and Storage are set up for you automatically." },
  { page: "dashboards", target: "dash-new", title: "Make a new dashboard", body: "New opens a wizard. Pick a preset like CPU, GPU or Compact overlay and see a live preview, or start blank." },
  { page: "dashboards", target: "dash-edit", title: "Customize", body: "Edit lets you drag and resize widgets, add new ones, and click a widget's gear to change its sensor, colors and limits." },
  { page: "dashboards", target: "dash-overlay", title: "In-game overlay", body: `Pick which dashboard the overlay shows. Press ${hotkey} in a game to show or hide it. Clicks pass straight through it.` },
  { page: "system", target: "nav-system", title: "System Info", body: "Your CPU, motherboard, memory, graphics card, drives and Windows details. Copy or export them to share." },
  { page: "sensors", target: "nav-sensors", title: "Sensors", body: "Every reading with its minimum, maximum and average. Click + next to a sensor to add it to the current dashboard." },
  { page: "themes", target: "nav-themes", title: "Themes", body: "Change the look. Duplicate a theme to make your own colors and background." },
  { page: "settings", target: "nav-settings", title: "Settings", body: "Units, alerts, CSV logging, the tray icon value, and the overlay: its size, corner, and which monitors show it." },
  { page: "guide", target: "nav-guide", title: "Need help later?", body: "The Guide answers common questions, like why some sensors are missing, and has the app's version and license." },
  { page: "dashboards", target: "status", title: "Connection status", body: "Shows whether the background sensor service is running. If it says it's not connected, the Guide explains what to do." },
];

/** A guided tour that switches pages and spotlights one element per step. */
export function Tour({ onPage, onDone }: { onPage: (page: string) => void; onDone: () => void }) {
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const step = TOUR[i];

  useEffect(() => {
    onPage(step.page);
    // Wait a frame for the page to render before measuring the target.
    const find = () => setRect(document.querySelector(`[data-tour="${step.target}"]`)?.getBoundingClientRect() ?? null);
    const id = setTimeout(find, 60);
    window.addEventListener("resize", find);
    return () => {
      clearTimeout(id);
      window.removeEventListener("resize", find);
    };
  }, [i]); // eslint-disable-line react-hooks/exhaustive-deps

  const last = i === TOUR.length - 1;
  const pad = 6;
  // Card goes below the target, else above, else beside it (tall targets like the nav), else centered.
  const CARD_H = 220;
  const below = rect && rect.bottom + CARD_H < window.innerHeight;
  const above = rect && !below && rect.top > CARD_H;
  const beside = rect && !below && !above;
  const cardLeft = !rect ? window.innerWidth / 2 - 160 : beside ? rect.right + pad + 10 : Math.min(window.innerWidth - 344, Math.max(16, rect.left));
  const cardTop = !rect ? window.innerHeight / 2 - 80 : below ? rect.bottom + pad + 10 : beside ? rect.top + 40 : undefined;
  const cardBottom = above ? window.innerHeight - rect.top + pad + 10 : undefined;

  return (
    <div className="fixed inset-0 z-[70]" role="dialog" aria-modal aria-label="Tour" onKeyDown={(e) => e.key === "Escape" && onDone()}>
      {rect ? (
        <div
          className="pointer-events-none fixed rounded-theme outline outline-2 outline-accent transition-all"
          style={{ left: rect.left - pad, top: rect.top - pad, width: rect.width + pad * 2, height: rect.height + pad * 2, boxShadow: "0 0 0 9999px color-mix(in srgb, var(--sc-bg) 72%, transparent)" }}
        />
      ) : (
        <div className="fixed inset-0 bg-bg/70" />
      )}
      <div className="panel fixed flex w-80 flex-col gap-2 bg-surface-solid p-4" style={{ left: cardLeft, top: cardTop, bottom: cardBottom }}>
        <p className="text-xs text-muted">
          {i + 1} of {TOUR.length}
        </p>
        <h2 className="font-semibold text-accent">{step.title}</h2>
        <p className="text-sm">{step.body}</p>
        <div className="mt-1 flex gap-2">
          <button className="btn" onClick={onDone}>
            Skip tour
          </button>
          <button className="btn ml-auto" disabled={i === 0} onClick={() => setI(i - 1)}>
            Back
          </button>
          <button className="btn btn-accent" autoFocus onClick={() => (last ? onDone() : setI(i + 1))}>
            {last ? "Finish" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}
