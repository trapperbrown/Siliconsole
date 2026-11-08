import { useEffect, useState } from "react";

const DELAY_MS = 350;
const HALF_WIDTH_PX = 160;

/**
 * One tooltip for the whole app: any element with a `data-tip` attribute shows it on hover or keyboard focus.
 * It is fixed-positioned, so scrolling panels never clip it.
 */
export function Tooltips() {
  const [tip, setTip] = useState<{ text: string; x: number; y: number; above: boolean } | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const show = (e: Event) => {
      clearTimeout(timer);
      const el = (e.target as Element | null)?.closest?.("[data-tip]") as HTMLElement | null;
      if (!el) return setTip(null);
      timer = setTimeout(() => {
        const r = el.getBoundingClientRect();
        const above = r.bottom + 80 > window.innerHeight;
        const x = Math.min(window.innerWidth - HALF_WIDTH_PX - 8, Math.max(HALF_WIDTH_PX + 8, r.left + r.width / 2));
        setTip({ text: el.dataset.tip ?? "", x, y: above ? r.top - 6 : r.bottom + 6, above });
      }, DELAY_MS);
    };
    const hide = () => {
      clearTimeout(timer);
      setTip(null);
    };
    document.addEventListener("mouseover", show);
    document.addEventListener("focusin", show);
    document.addEventListener("mousedown", hide);
    document.addEventListener("scroll", hide, true);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mouseover", show);
      document.removeEventListener("focusin", show);
      document.removeEventListener("mousedown", hide);
      document.removeEventListener("scroll", hide, true);
    };
  }, []);
  if (!tip?.text) return null;
  return (
    <div
      role="tooltip"
      className="panel pointer-events-none fixed z-[80] max-w-xs bg-surface-solid px-2 py-1 text-xs"
      style={{ left: tip.x, top: tip.y, transform: `translate(-50%, ${tip.above ? "-100%" : "0"})` }}
    >
      {tip.text}
    </div>
  );
}
