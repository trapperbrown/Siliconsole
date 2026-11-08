import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { config } from "../lib/config";
import { useSettings } from "../lib/settings";
import { useTheme } from "../lib/theme";
import { cssVar, paletteColor } from "../widgets/common";

interface LogFile {
  name: string;
  bytes: number;
  modified: number;
}
interface AlertEntry {
  time: number;
  text: string;
}
interface Log {
  columns: string[];
  xs: number[];
  ys: (number | null)[][];
}

/** Splits one CSV line, honoring quoted fields (our headers quote names that contain the delimiter). */
export function splitCsv(line: string, delim = config.csvLog.delimiter): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') (cur += '"'), i++;
      else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === delim) out.push(cur), (cur = "");
    else cur += c;
  }
  out.push(cur);
  return out;
}

/** Parses a log written by the app. Rows are thinned evenly to at most history.maxChartPoints. */
export function parseLog(text: string, maxPoints = config.history.maxChartPoints): Log {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const [header = "", ...rows] = lines;
  const columns = splitCsv(header).slice(1);
  const step = Math.max(1, Math.ceil(rows.length / maxPoints));
  const xs: number[] = [];
  const ys: (number | null)[][] = columns.map(() => []);
  for (let r = 0; r < rows.length; r += step) {
    const f = splitCsv(rows[r]);
    // Timestamps are local "YYYY-MM-DD HH:MM:SS"; fall back to row order if a format change breaks that.
    const t = Date.parse(f[0].replace(" ", "T"));
    xs.push(Number.isNaN(t) ? r : t / 1000);
    columns.forEach((_, i) => {
      const v = parseFloat(f[i + 1]);
      ys[i].push(Number.isFinite(v) ? v : null);
    });
  }
  return { columns, xs, ys };
}

const sizeLabel = (b: number) => (b < 1_048_576 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1_048_576).toFixed(1)} MB`);
const when = (ms: number) => new Date(ms).toLocaleString();

function LogChart({ log, shown }: { log: Log; shown: boolean[] }) {
  const el = useRef<HTMLDivElement>(null);
  const theme = useTheme();
  useEffect(() => {
    const div = el.current;
    if (!div) return;
    const picked = log.columns.map((_, i) => i).filter((i) => shown[i]);
    const muted = cssVar("--sc-text-muted");
    const border = cssVar("--sc-border");
    const axis = { stroke: muted, grid: { stroke: border, width: 1 }, ticks: { stroke: border, width: 1 }, font: `11px ${cssVar("--sc-font")}` };
    const u = new uPlot(
      {
        width: Math.max(1, div.clientWidth),
        height: Math.max(1, div.clientHeight),
        legend: { show: false },
        cursor: { points: { show: false }, drag: { x: true, y: false } },
        scales: { x: { time: log.xs[0] > 1e9 } },
        axes: [axis, { ...axis, size: 56 }],
        series: [{}, ...picked.map((i) => ({ label: log.columns[i], stroke: paletteColor(i), width: config.widgetDefaults.chartLineWidthPx, points: { show: false } }))],
      },
      [log.xs, ...picked.map((i) => log.ys[i])] as uPlot.AlignedData,
      div,
    );
    const ro = new ResizeObserver(() => u.setSize({ width: Math.max(1, div.clientWidth), height: Math.max(1, div.clientHeight) }));
    ro.observe(div);
    return () => {
      ro.disconnect();
      u.destroy();
    };
  }, [log, shown.join(), theme]);
  return <div ref={el} className="absolute inset-0" />;
}

function AlertHistory() {
  const [alerts, setAlerts] = useState<AlertEntry[]>([]);
  useEffect(() => {
    const load = () => invoke<AlertEntry[]>("alert_history").then(setAlerts);
    load();
    const off = listen("alerts://changed", load);
    return () => void off.then((f) => f());
  }, []);
  return (
    <section className="panel flex min-h-0 flex-col gap-2 p-4">
      <div className="flex items-center">
        <h2 className="font-semibold text-accent">Alert history</h2>
        <button className="btn ml-auto" disabled={!alerts.length} onClick={() => invoke("clear_alert_history")}>
          Clear
        </button>
      </div>
      {!alerts.length && <p className="text-sm text-muted">No alerts yet. Alerts you set up in Settings are listed here when they fire, even if you missed the notification.</p>}
      <ul className="stagger min-h-0 overflow-auto text-sm">
        {alerts.map((a, i) => (
          <li key={`${a.time}-${i}`} className="border-b border-border py-1.5 last:border-0">
            <span className="mr-2 text-xs text-muted">{when(a.time)}</span>
            {a.text}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Past CSV logs as charts, plus alerts that fired. */
export function HistoryPage() {
  const s = useSettings();
  const [files, setFiles] = useState<LogFile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [log, setLog] = useState<Log | null>(null);
  const [shown, setShown] = useState<boolean[]>([]);
  const folder = s.csvLog?.folder;

  useEffect(() => {
    if (!folder) return;
    invoke<LogFile[]>("list_logs").then(setFiles, (e) => setError(String(e)));
  }, [folder]);

  const open = async (name: string) => {
    setPicked(name);
    setError(null);
    try {
      const l = parseLog(await invoke<string>("read_log", { name }));
      setLog(l);
      setShown(l.columns.map(() => true));
    } catch (e) {
      setLog(null);
      setError(String(e));
    }
  };

  return (
    <div className="grid h-full min-h-0 grid-cols-[16rem_1fr] grid-rows-[1fr_auto] gap-3">
      <section className="panel row-span-2 flex min-h-0 flex-col gap-2 p-3">
        <h2 className="px-1 font-semibold text-accent">Logs</h2>
        {!folder && <p className="px-1 text-sm text-muted">Turn on CSV logging in Settings. Each logging session becomes a file you can chart here.</p>}
        {folder && !files.length && <p className="px-1 text-sm text-muted">No logs in {folder} yet.</p>}
        <div className="stagger flex min-h-0 flex-col gap-1 overflow-auto">
          {files.map((f) => (
            <button key={f.name} className={`nav-item rounded-theme px-2 py-1.5 text-left text-sm ${picked === f.name ? "bg-accent/15 text-accent" : "hover:bg-surface"}`} aria-current={picked === f.name || undefined} onClick={() => open(f.name)}>
              <span className="block">{when(f.modified)}</span>
              <span className="block text-xs text-muted">{sizeLabel(f.bytes)}</span>
            </button>
          ))}
        </div>
      </section>
      <section className="panel flex min-h-0 flex-col gap-2 p-4">
        {error && <p className="text-sm text-warning">{error}</p>}
        {!log && !error && <p className="text-sm text-muted">Pick a log on the left to chart it. Drag across the chart to zoom, double-click to zoom back out.</p>}
        {log && (
          <>
            <div className="flex flex-wrap gap-1.5">
              {log.columns.map((c, i) => (
                <button key={c} className={`btn px-2 py-0.5 text-xs ${shown[i] ? "" : "opacity-50"}`} aria-pressed={shown[i]} onClick={() => setShown(shown.map((v, j) => (j === i ? !v : v)))}>
                  <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: paletteColor(i) }} aria-hidden />
                  {c}
                </button>
              ))}
            </div>
            <div className="relative min-h-0 flex-1">
              <LogChart log={log} shown={shown} />
            </div>
          </>
        )}
      </section>
      <AlertHistory />
    </div>
  );
}
