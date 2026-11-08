import { useEffect, useState } from "react";
import { DashboardGrid } from "./components/DashboardGrid";
import type { Dashboard } from "./generated/schema-types";
import { config } from "./lib/config";
import { useDashboards } from "./lib/dashboards";
import { useSettings } from "./lib/settings";

/** Overlay options with defaults.json filling anything the user has not set. */
export function overlayOptions(s: ReturnType<typeof useSettings>) {
  const c = config.overlay;
  const o = s.overlay ?? {};
  return {
    widthPx: o.widthPx ?? c.widthPx,
    heightPx: o.heightPx ?? c.heightPx,
    scale: o.scale ?? c.scale,
    fit: o.fit ?? c.fit,
    corner: o.corner ?? c.corner,
    opacity: o.opacity ?? c.opacity,
  };
}

/** Height in CSS px at scale 1 of the grid down to a given row. Row height is fixed, so width does not matter. */
function rowsPx(rows: number) {
  const g = config.dashboards;
  return rows <= 0 ? 0 : rows * g.rowHeightPx + (rows - 1) * g.marginPx;
}
const bottomPx = (d: Dashboard) => rowsPx(d.widgets.reduce((m, w) => Math.max(m, w.y + w.h), 0));

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Picks the scale and the widgets that fit a window `height` px tall. Fit mode shrinks the dashboard, but never
 * below overlay.minFitScale so text stays readable. Widgets that still would not fit are hidden whole, lowest
 * first, so nothing is ever cut in half. Put the widgets you care about most at the top.
 */
export function fitOverlay(d: Dashboard, height: number, o: { fit: boolean; scale: number }) {
  const c = config.overlay;
  let scale = o.fit ? clamp(height / Math.max(1, bottomPx(d)), c.minFitScale, c.maxScale) : clamp(o.scale, c.minScale, c.maxScale);
  const shown = { ...d, widgets: d.widgets.filter((w) => rowsPx(w.y + w.h) <= height / scale + 0.5) };
  // Hiding widgets frees space, so in fit mode grow back to fill the window.
  if (o.fit && shown.widgets.length) scale = clamp(height / bottomPx(shown), c.minFitScale, c.maxScale);
  return { scale, shown, hidden: d.widgets.length - shown.widgets.length };
}

/** The always-on-top, click-through overlay window. */
export function Overlay() {
  const store = useDashboards();
  const s = useSettings();
  const o = overlayOptions(s);
  const [height, setHeight] = useState(window.innerHeight);
  useEffect(() => {
    const onResize = () => setHeight(window.innerHeight);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const d = store.get(s.overlayDashboardId ?? undefined) ?? store.active();
  if (!d) return null;
  const { scale, shown } = fitOverlay(d, height, o);
  if (!shown.widgets.length) return <p className="panel m-1 p-2 text-sm">Overlay too small for any widget. Make it bigger in Settings.</p>;
  return (
    <div
      className="overflow-hidden"
      style={{ width: `${100 / scale}%`, height: `${100 / scale}%`, transform: `scale(${scale})`, transformOrigin: "top left", opacity: o.opacity }}
    >
      <DashboardGrid dashboard={shown} compact />
    </div>
  );
}
