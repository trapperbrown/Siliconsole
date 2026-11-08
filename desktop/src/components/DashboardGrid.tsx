import { memo } from "react";
import ReactGridLayout, { useContainerWidth, verticalCompactor, type Layout } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import type { Dashboard, Widget } from "../generated/schema-types";
import { config } from "../lib/config";
import { WIDGETS } from "../widgets/registry";

const WidgetBody = memo(function WidgetBody({ widget, compact }: { widget: Widget; compact?: boolean }) {
  const Component = WIDGETS[widget.type].component;
  return <Component widget={widget} compact={compact} />;
});

/**
 * Renders a dashboard. Widgets are memoized on their own config, so live data never re-renders
 * the grid: each widget subscribes to just its sensor ids.
 */
export function DashboardGrid({
  dashboard,
  editing = false,
  compact = false,
  onChange,
  onEditWidget,
  onRemoveWidget,
}: {
  dashboard: Dashboard;
  editing?: boolean;
  compact?: boolean;
  onChange?: (d: Dashboard) => void;
  onEditWidget?: (w: Widget) => void;
  onRemoveWidget?: (w: Widget) => void;
}) {
  const { width, containerRef, mounted } = useContainerWidth();
  const g = config.dashboards;
  const layout: Layout = dashboard.widgets.map((w) => ({ i: w.id, x: w.x, y: w.y, w: w.w, h: w.h }));

  const handleLayout = (next: Layout) => {
    if (!onChange) return;
    const byId = new Map(next.map((l) => [l.i, l]));
    let changed = false;
    const widgets = dashboard.widgets.map((w) => {
      const l = byId.get(w.id);
      if (!l || (l.x === w.x && l.y === w.y && l.w === w.w && l.h === w.h)) return w;
      changed = true;
      return { ...w, x: l.x, y: l.y, w: l.w, h: l.h };
    });
    if (changed) onChange({ ...dashboard, widgets });
  };

  return (
    <div ref={containerRef as React.Ref<HTMLDivElement>} className="w-full">
      {mounted && (
        <ReactGridLayout
          width={width}
          layout={layout}
          gridConfig={{ cols: g.gridColumns, rowHeight: g.rowHeightPx, margin: [g.marginPx, g.marginPx], containerPadding: [0, 0] }}
          dragConfig={{ enabled: editing, cancel: ".no-drag" }}
          resizeConfig={{ enabled: editing }}
          compactor={verticalCompactor}
          onLayoutChange={handleLayout}
        >
          {dashboard.widgets.map((w, i) => (
            <div key={w.id} style={{ "--i": Math.min(i, 16) } as React.CSSProperties} className={`panel lift ${editing ? "cursor-move outline-dashed outline-1 outline-accent" : ""}`}>
              <WidgetBody widget={w} compact={compact} />
              {editing && (
                <div className="no-drag absolute right-1 top-1 flex gap-1">
                  <button className="btn px-1.5 py-0 text-xs" aria-label="Widget settings" title="Settings" onClick={() => onEditWidget?.(w)}>
                    ⚙
                  </button>
                  <button className="btn px-1.5 py-0 text-xs" aria-label="Remove widget" title="Remove" onClick={() => onRemoveWidget?.(w)}>
                    ✕
                  </button>
                </div>
              )}
            </div>
          ))}
        </ReactGridLayout>
      )}
    </div>
  );
}
