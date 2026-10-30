import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { useIsoLayoutEffect } from "../Tooltip";

/**
 * Horizontal scroll box of the wide grids (heatmap, calendar): 24 px fades
 * on whichever edge hides more content (touch screens hide scrollbars),
 * the focus ring on the box rather than on the clipped SVG, and an
 * optional start at the end (the latest weeks of a calendar).
 */
export const ScrollFrame = ({
  width,
  surface,
  startAtEnd = false,
  children,
}: {
  width: number;
  surface: string;
  startAtEnd?: boolean;
  children: ReactNode;
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const update = useCallback(() => {
    const box = ref.current;
    if (!box) return;
    const left = box.scrollLeft > 1;
    const right = box.scrollLeft + box.clientWidth < box.scrollWidth - 1;
    setEdges((current) =>
      current.left === left && current.right === right
        ? current
        : { left, right }
    );
  }, []);
  useIsoLayoutEffect(() => {
    const box = ref.current;
    if (box && startAtEnd) box.scrollLeft = box.scrollWidth;
    update();
  }, [startAtEnd, width, update]);
  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    const box = ref.current;
    if (!box) return;
    const observer = new ResizeObserver(update);
    observer.observe(box);
    return () => observer.disconnect();
  }, [update]);
  const fade = (side: "left" | "right") => (
    <div
      aria-hidden="true"
      data-scroll-fade={side}
      className="pointer-events-none absolute inset-y-0 z-[5] w-6"
      style={{
        [side]: 0,
        background: `linear-gradient(to ${side === "left" ? "right" : "left"}, ${surface}, transparent)`,
      }}
    />
  );
  return (
    <div
      className="relative rounded focus-within:ring-2 focus-within:ring-steel-blue-400"
      style={{ width }}
    >
      <div
        ref={ref}
        className="overflow-x-auto overscroll-x-contain"
        style={{ width }}
        onScroll={update}
      >
        {children}
      </div>
      {edges.left && fade("left")}
      {edges.right && fade("right")}
    </div>
  );
};
