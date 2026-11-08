import type { ComponentType } from "react";
import type { SensorQuery, WidgetSettings, WidgetType } from "../generated/schema-types";
import type { WidgetProps } from "./common";
import { BigNumberWidget, LinearBarWidget, RadialGaugeWidget } from "./Gauges";
import { CoreHeatmapWidget, FanListWidget, StorageHealthWidget } from "./Lists";
import { LineChartWidget, SparklineWidget } from "./TimeChart";

export interface WidgetKind {
  label: string;
  /** One line for the widget picker. */
  description: string;
  /** A symbol for layout previews. */
  icon: string;
  component: ComponentType<WidgetProps>;
  /** Whether the widget binds several sensors. */
  multi: boolean;
  /** Which per-widget settings make sense for this kind. */
  fields: ("unit" | "decimals" | "range" | "thresholds" | "history")[];
  /** Grid size a new widget of this kind gets. */
  size: { w: number; h: number };
  /** Sensors a new widget starts with (and the picker previews), resolved on this machine. */
  sample: { query: SensorQuery; settings: WidgetSettings };
}

const GPU = ["GpuNvidia", "GpuAmd", "GpuIntel"];
const cpuTemp: SensorQuery = { hardwareTypes: ["Cpu"], sensorTypes: ["Temperature"], namePattern: "Package|Tctl", limit: 1, expand: "all" };
const cpuLoad: SensorQuery = { hardwareTypes: ["Cpu"], sensorTypes: ["Load"], namePattern: "^CPU Total$", limit: 1, expand: "all" };

export const WIDGETS: Record<WidgetType, WidgetKind> = {
  radialGauge: {
    label: "Radial gauge", icon: "◔", component: RadialGaugeWidget, multi: false, fields: ["unit", "decimals", "range", "thresholds"], size: { w: 4, h: 6 },
    description: "A dial for one sensor that changes color at your warning and critical levels. Great for temperatures.",
    sample: { query: cpuTemp, settings: { min: 20, max: 100, warning: 80, critical: 90, decimals: 0 } },
  },
  linearBar: {
    label: "Linear bar", icon: "▬", component: LinearBarWidget, multi: false, fields: ["unit", "decimals", "range", "thresholds"], size: { w: 6, h: 3 },
    description: "A horizontal bar for one sensor. Good for percentages like load, drive space or VRAM.",
    sample: { query: cpuLoad, settings: { min: 0, max: 100, decimals: 0 } },
  },
  bigNumber: {
    label: "Big number", icon: "#", component: BigNumberWidget, multi: false, fields: ["unit", "decimals", "thresholds"], size: { w: 4, h: 3 },
    description: "One value in large digits. Small, so it suits the overlay.",
    sample: { query: cpuLoad, settings: { decimals: 0 } },
  },
  sparkline: {
    label: "Sparkline", icon: "∿", component: SparklineWidget, multi: false, fields: ["unit", "decimals", "range", "thresholds", "history"], size: { w: 4, h: 4 },
    description: "One value with a small history chart behind it, so you see the trend.",
    sample: { query: cpuLoad, settings: { decimals: 0, historySeconds: 120 } },
  },
  lineChart: {
    label: "Line chart", icon: "↗", component: LineChartWidget, multi: true, fields: ["decimals", "range", "history"], size: { w: 12, h: 8 },
    description: "Several sensors over time on one chart. Good for comparing CPU and GPU temperatures.",
    sample: { query: { hardwareTypes: ["Cpu", ...GPU], sensorTypes: ["Temperature"], namePattern: "Package|Tctl|^GPU Core$", limit: 3, expand: "all" }, settings: { decimals: 0, historySeconds: 300 } },
  },
  coreHeatmap: {
    label: "Per-core load heatmap", icon: "▦", component: CoreHeatmapWidget, multi: true, fields: ["range"], size: { w: 24, h: 5 },
    description: "A colored tile for each CPU core showing how busy it is.",
    sample: { query: { hardwareTypes: ["Cpu"], sensorTypes: ["Load"], namePattern: "^CPU Core #\\d+$", expand: "all" }, settings: { min: 0, max: 100 } },
  },
  storageHealth: {
    label: "Storage health", icon: "⛁", component: StorageHealthWidget, multi: true, fields: ["decimals", "thresholds"], size: { w: 8, h: 10 },
    description: "Each drive's temperature, life left and space used.",
    sample: { query: { hardwareTypes: ["Storage"], sensorTypes: ["Temperature", "Level", "Load", "Data"], excludePattern: "Warning Temperature|Critical Temperature|Temperature #", expand: "all" }, settings: { decimals: 0 } },
  },
  fanList: {
    label: "Fan list", icon: "✇", component: FanListWidget, multi: true, fields: ["decimals", "range"], size: { w: 6, h: 8 },
    description: "Every fan with its speed in RPM.",
    sample: { query: { sensorTypes: ["Fan"], expand: "all" }, settings: {} },
  },
};
