import { useState } from "react";
import { ServiceHelp } from "../components/StatusIndicator";
import { config } from "../lib/config";
import { ipc } from "../lib/ipc";
import { buildReport, REPORT_TABS, sectionsToMarkdown, toMarkdown, type ReportTab } from "../lib/report";
import { useTelemetryMeta } from "../lib/telemetry";

export function SystemInfoPage() {
  const t = useTelemetryMeta();
  const [tab, setTab] = useState<ReportTab>("CPU");
  const [note, setNote] = useState<string | null>(null);
  const info = t.systemInfo;
  const report = info ? buildReport(info) : null;

  const flash = (msg: string) => {
    setNote(msg);
    setTimeout(() => setNote(null), config.ui.noticeMs);
  };
  const copy = async () => {
    if (!report) return;
    await navigator.clipboard.writeText(`## ${tab}\n\n${sectionsToMarkdown(report[tab])}\n`);
    flash(`Copied ${tab} to clipboard`);
  };
  const exportAs = async (ext: "json" | "md") => {
    if (!info) return;
    const contents = ext === "json" ? JSON.stringify({ app: config.appName, systemInfo: info }, null, 2) : toMarkdown(config.appName, info);
    try {
      if (await ipc.exportFile(`${config.systemReport.fileBaseName}.${ext}`, ext, contents)) flash("Report saved");
    } catch (e) {
      flash(`Export failed: ${e}`);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <ServiceHelp />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex gap-1" role="tablist">
          {REPORT_TABS.map((name) => (
            <button key={name} role="tab" aria-selected={tab === name} className={`btn ${tab === name ? "btn-accent" : ""}`} onClick={() => setTab(name)}>
              {name}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {note && <span className="text-sm text-muted">{note}</span>}
          <button className="btn" data-tip="Copy this tab as a table you can paste into Discord or a forum" onClick={copy} disabled={!report}>
            Copy
          </button>
          <button className="btn" data-tip="Save everything to a JSON file" onClick={() => exportAs("json")} disabled={!info}>
            Export JSON
          </button>
          <button className="btn" data-tip="Save everything as a readable Markdown report" onClick={() => exportAs("md")} disabled={!info}>
            Export Markdown
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {!report && <p className="text-muted">Waiting for system information from the sensor service.</p>}
        {report && report[tab].length === 0 && <p className="text-muted">Nothing detected.</p>}
        <div className="grid gap-3 lg:grid-cols-2">
          {report?.[tab].map((section, i) => (
            <section key={`${section.title}-${i}`} className="panel p-4">
              <h2 className="mb-2 font-semibold text-accent">{section.title}</h2>
              <dl className="selectable grid grid-cols-[minmax(9rem,auto)_1fr] gap-x-4 gap-y-1 text-sm">
                {section.rows.map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-muted">{k}</dt>
                    <dd className="m-0 break-words">{v}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
