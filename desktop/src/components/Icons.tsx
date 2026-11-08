import type { ReactNode } from "react";

/** 24px line icons drawn in currentColor, so they follow the theme. */
function Icon({ children, className = "h-4 w-4" }: { children: ReactNode; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      {children}
    </svg>
  );
}

type P = { className?: string };

export const DashboardIcon = (p: P) => <Icon {...p}><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></Icon>;
export const ChipIcon = (p: P) => <Icon {...p}><rect x="6" y="6" width="12" height="12" rx="2" /><rect x="9.5" y="9.5" width="5" height="5" rx="0.5" /><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4" /></Icon>;
export const PulseIcon = (p: P) => <Icon {...p}><path d="M3 12h4l2.5-6 4 12 2.5-6H21" /></Icon>;
export const PaletteIcon = (p: P) => <Icon {...p}><path d="M12 3a9 9 0 1 0 0 18c1.2 0 1.8-.9 1.8-1.8 0-1.3-1-1.6-1-2.7 0-1 .8-1.7 1.8-1.7H17a4 4 0 0 0 4-4C21 6.5 17 3 12 3z" /><circle cx="7.5" cy="11" r="1" /><circle cx="10" cy="7" r="1" /><circle cx="15" cy="7.5" r="1" /></Icon>;
export const GearIcon = (p: P) => <Icon {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></Icon>;
export const HelpIcon = (p: P) => <Icon {...p}><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6" /><circle cx="12" cy="17" r="0.6" fill="currentColor" /></Icon>;
export const SearchIcon = (p: P) => <Icon {...p}><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></Icon>;
export const ChevronIcon = (p: P) => <Icon {...p}><path d="m9 6 6 6-6 6" /></Icon>;
export const HistoryIcon = (p: P) => <Icon {...p}><path d="M3 12a9 9 0 1 0 2.6-6.4L3 8" /><path d="M3 3v5h5M12 7v5l3 2" /></Icon>;
export const PlusIcon = (p: P) => <Icon {...p}><path d="M12 5v14M5 12h14" /></Icon>;

const GpuIcon = (p: P) => <Icon {...p}><rect x="2" y="6" width="20" height="11" rx="2" /><circle cx="9" cy="11.5" r="3" /><path d="M15 9.5h4M15 13.5h4M5 17v2M9 17v2" /></Icon>;
const MemoryIcon = (p: P) => <Icon {...p}><rect x="2" y="7" width="20" height="9" rx="1.5" /><path d="M6 10v3M10 10v3M14 10v3M18 10v3M5 16v2M9 16v2M15 16v2M19 16v2" /></Icon>;
const DriveIcon = (p: P) => <Icon {...p}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 14h18" /><circle cx="17" cy="16.5" r="0.8" fill="currentColor" /></Icon>;
const NetworkIcon = (p: P) => <Icon {...p}><path d="M2 9a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0" /><circle cx="12" cy="19" r="0.8" fill="currentColor" /></Icon>;
const BoardIcon = (p: P) => <Icon {...p}><rect x="3" y="3" width="18" height="18" rx="2" /><rect x="7" y="7" width="6" height="6" rx="1" /><path d="M16 7h2M16 10h2M7 16h10" /></Icon>;
const BatteryIcon = (p: P) => <Icon {...p}><rect x="2" y="7" width="17" height="10" rx="2" /><path d="M22 11v2M6 10v4M10 10v4" /></Icon>;
const FanIcon = (p: P) => <Icon {...p}><circle cx="12" cy="12" r="1.5" /><path d="M12 10.5C12 6 14 3 16.5 4.5S15 10 13.3 11.2M13.5 12c4.5 0 7.5 2 6 4.5S14 15 12.8 13.3M12 13.5c0 4.5-2 7.5-4.5 6S9 14 10.7 12.8M10.5 12C6 12 3 10 4.5 7.5S10 9 11.2 10.7" /></Icon>;

/** Icon for a LibreHardwareMonitor hardware type. */
export function HardwareIcon({ type, className }: { type: string; className?: string }) {
  if (type === "Cpu") return <ChipIcon className={className} />;
  if (type.startsWith("Gpu")) return <GpuIcon className={className} />;
  if (type === "Memory") return <MemoryIcon className={className} />;
  if (type === "Storage") return <DriveIcon className={className} />;
  if (type === "Network") return <NetworkIcon className={className} />;
  if (type === "Battery") return <BatteryIcon className={className} />;
  if (type === "Cooler" || type === "EmbeddedController") return <FanIcon className={className} />;
  return <BoardIcon className={className} />;
}
