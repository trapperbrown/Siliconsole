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

/** Grid height in CSS px at scale 1. Row height is fixed, so this does not depend on width. */
function contentHeight(d: Dashboard) {
  const g = config.dashboards;
  const rows = d.widgets.reduce((m, w) => Math.max(m, w.y + w.h), 0);
  return rows * g.rowHeightPx + Math.max(0, rows - 1) * g.marginPx;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * The always-on-top, click-through overlay window. With "fit" on, the scale is chosen so every row of
 * the dashboard fits the window height; otherwise the user's fixed scale is used.
 */
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
  const c = config.overlay;
  const needed = contentHeight(d);
  const scale = clamp(o.fit && needed > 0 ? height / needed : o.scale, c.minScale, c.maxScale);
  return (
    <div
      className="overflow-hidden"
      style={{ width: `${100 / scale}%`, height: `${100 / scale}%`, transform: `scale(${scale})`, transformOrigin: "top left", opacity: o.opacity }}
    >
      <DashboardGrid dashboard={d} compact />
    </div>
  );
}
