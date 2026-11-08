import type { SensorCatalogMessage, Widget, WidgetType } from "../generated/schema-types";
import { materialize, newWidgetId } from "../lib/dashboards";
import { useTelemetryMeta } from "../lib/telemetry";
import { WIDGETS } from "../widgets/registry";

/** A new widget of `type`, bound to its sample sensors on this machine (or none if it has no match). */
export function sampleWidget(type: WidgetType, cat: SensorCatalogMessage | null): Widget {
  const k = WIDGETS[type];
  const base: Widget = { id: newWidgetId(), type, x: 0, y: 0, ...k.size, sensorIds: [], settings: k.sample.settings };
  if (!cat) return base;
  const [w] = materialize({ schemaVersion: 1, id: "sample", name: "sample", widgets: [{ ...base, sensorQuery: k.sample.query }] }, cat).widgets;
  return w ?? base;
}

/** Visual widget chooser: every kind with a live preview using this PC's sensors. */
export function WidgetPicker({ onPick, onClose }: { onPick: (w: Widget) => void; onClose: () => void }) {
  const t = useTelemetryMeta();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/70 p-6" role="dialog" aria-modal aria-label="Add a widget" onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div className="panel flex max-h-full w-[60rem] flex-col gap-3 bg-surface-solid p-4">
        <div className="flex items-center">
          <div>
            <h2 className="font-semibold">Add a widget</h2>
            <p className="text-sm text-muted">Previews show live data from your PC. You can change the sensor and settings next.</p>
          </div>
          <button className="btn ml-auto" onClick={onClose} autoFocus>
            Cancel
          </button>
        </div>
        <div className="grid min-h-0 grid-cols-2 gap-3 overflow-auto md:grid-cols-4">
          {(Object.keys(WIDGETS) as WidgetType[]).map((type) => {
            const k = WIDGETS[type];
            const preview = sampleWidget(type, t.catalog);
            const Preview = k.component;
            return (
              <button key={type} className="btn flex flex-col gap-2 p-2 text-left" onClick={() => onPick(sampleWidget(type, t.catalog))}>
                <div className="panel pointer-events-none relative h-32 w-full overflow-hidden" aria-hidden>
                  <Preview widget={preview} compact />
                </div>
                <span className="font-medium">
                  <span className="mr-1 text-accent" aria-hidden>
                    {k.icon}
                  </span>
                  {k.label}
                </span>
                <span className="text-xs text-muted">{k.description}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
