import type { ComponentType } from "react";
import type { WidgetType } from "../generated/schema-types";
import type { WidgetProps } from "./common";
import { BigNumberWidget, LinearBarWidget, RadialGaugeWidget } from "./Gauges";
import { CoreHeatmapWidget, FanListWidget, StorageHealthWidget } from "./Lists";
import { LineChartWidget, SparklineWidget } from "./TimeChart";

export interface WidgetKind {
  label: string;
  component: ComponentType<WidgetProps>;
  /** Whether the widget binds several sensors. */
  multi: boolean;
  /** Which per-widget settings make sense for this kind. */
  fields: ("unit" | "decimals" | "range" | "thresholds" | "history")[];
}

export const WIDGETS: Record<WidgetType, WidgetKind> = {
  radialGauge: { label: "Radial gauge", component: RadialGaugeWidget, multi: false, fields: ["unit", "decimals", "range", "thresholds"] },
  linearBar: { label: "Linear bar", component: LinearBarWidget, multi: false, fields: ["unit", "decimals", "range", "thresholds"] },
  bigNumber: { label: "Big number", component: BigNumberWidget, multi: false, fields: ["unit", "decimals", "thresholds"] },
  sparkline: { label: "Sparkline", component: SparklineWidget, multi: false, fields: ["unit", "decimals", "range", "thresholds", "history"] },
  lineChart: { label: "Line chart", component: LineChartWidget, multi: true, fields: ["decimals", "range", "history"] },
  coreHeatmap: { label: "Per-core load heatmap", component: CoreHeatmapWidget, multi: true, fields: ["range"] },
  storageHealth: { label: "Storage health", component: StorageHealthWidget, multi: true, fields: ["decimals", "thresholds"] },
  fanList: { label: "Fan list", component: FanListWidget, multi: true, fields: ["decimals", "range"] },
};
