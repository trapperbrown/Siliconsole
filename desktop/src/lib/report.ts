import type { SystemInfo } from "../generated/schema-types";
import { formatBytes } from "./format";

export const REPORT_TABS = ["CPU", "Mainboard", "Memory", "GPU", "Storage", "OS"] as const;
export type ReportTab = (typeof REPORT_TABS)[number];
export interface ReportSection {
  title: string;
  rows: [string, string][];
}

const v = (x: string | number | null | undefined, suffix = "") => (x === null || x === undefined || x === "" ? "n/a" : `${x}${suffix}`);
const hex = (n: number) => n.toString(16).toUpperCase();

/** One structure feeds the System Info tabs, the clipboard copy and the Markdown export. */
export function buildReport(info: SystemInfo): Record<ReportTab, ReportSection[]> {
  const mem = info.memory;
  return {
    CPU: info.cpus.map((c, i) => ({
      title: info.cpus.length > 1 ? `Processor ${i + 1}` : "Processor",
      rows: [
        ["Name", c.name],
        ["Vendor", c.vendor],
        ["Codename", v(c.codename)],
        ["Family / Model / Stepping", `${hex(c.family)}h / ${hex(c.model)}h / ${c.stepping}`],
        ["Socket", v(c.socket)],
        ["Cores / Threads", `${c.cores} / ${c.threads}`],
        ["Base clock", v(c.baseClockMhz, " MHz")],
        ["L1 cache", c.l1CacheKb ? formatBytes(c.l1CacheKb * 1024) : "n/a"],
        ["L2 cache", c.l2CacheKb ? formatBytes(c.l2CacheKb * 1024) : "n/a"],
        ["L3 cache", c.l3CacheKb ? formatBytes(c.l3CacheKb * 1024) : "n/a"],
        ["TjMax", v(c.tjMaxC, " °C")],
        ["Microcode", v(c.microcode)],
        ["Instructions", c.instructionSets.join(", ") || "n/a"],
      ],
    })),
    Mainboard: [
      {
        title: "Motherboard",
        rows: [
          ["Manufacturer", v(info.board.manufacturer)],
          ["Model", v(info.board.product)],
          ["Revision", v(info.board.version)],
        ],
      },
      {
        title: "BIOS",
        rows: [
          ["Vendor", v(info.bios.vendor)],
          ["Version", v(info.bios.version)],
          ["Date", v(info.bios.releaseDate)],
        ],
      },
    ],
    Memory: [
      {
        title: "Summary",
        rows: [
          ["Total", formatBytes(mem.totalBytes)],
          ["Slots used", `${mem.modules.length} of ${v(mem.slotsTotal)}`],
          ["Type", v(mem.modules[0]?.memoryType)],
        ],
      },
      ...mem.modules.map((m) => ({
        title: v(m.slot),
        rows: [
          ["Bank", v(m.bank)],
          ["Capacity", formatBytes(m.capacityBytes)],
          ["Type", v(m.memoryType)],
          ["Speed", v(m.speedMts, " MT/s")],
          ["Configured speed", v(m.configuredSpeedMts, " MT/s")],
          ["Manufacturer", v(m.manufacturer)],
          ["Part number", v(m.partNumber)],
          ["Form factor", v(m.formFactor)],
        ] as [string, string][],
      })),
    ],
    GPU: info.gpus.map((g) => ({
      title: g.name,
      rows: [
        ["Vendor", v(g.vendor)],
        ["Dedicated memory", formatBytes(g.dedicatedVideoMemoryBytes)],
        ["Shared memory", formatBytes(g.sharedSystemMemoryBytes)],
        ["Driver version", v(g.driverVersion)],
        ["Driver date", v(g.driverDate)],
      ],
    })),
    Storage: info.storage.map((d) => ({
      title: d.model,
      rows: [
        ["Capacity", formatBytes(d.sizeBytes)],
        ["Interface", v(d.interface)],
        ["Media", v(d.mediaType)],
        ["Firmware", v(d.firmware)],
        ["Health", v(d.health)],
      ],
    })),
    OS: [
      {
        title: "Operating system",
        rows: [
          ["Name", v(info.os.name)],
          ["Version", v(info.os.displayVersion)],
          ["Build", v(info.os.build)],
          ["Kernel", v(info.os.version)],
          ["Architecture", v(info.os.architecture)],
          ["Installed", v(info.os.installDate)],
          ["Computer name", v(info.os.computerName)],
        ],
      },
    ],
  };
}

export function sectionsToMarkdown(sections: ReportSection[], level = "###"): string {
  return sections
    .map((s) => [`${level} ${s.title}`, "", "| Item | Value |", "| --- | --- |", ...s.rows.map(([k, val]) => `| ${k} | ${val.replace(/\|/g, "\\|")} |`)].join("\n"))
    .join("\n\n");
}

export function toMarkdown(appName: string, info: SystemInfo): string {
  const report = buildReport(info);
  const when = new Date(info.collectedAt).toISOString();
  return [`# ${appName} system report`, "", `Collected ${when}`, "", ...REPORT_TABS.map((t) => `## ${t}\n\n${sectionsToMarkdown(report[t])}`)].join("\n\n") + "\n";
}
