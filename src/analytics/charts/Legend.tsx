import { KeyboardEvent, useCallback, useState } from "react";
import type { ChartTheme } from "./palette";
import { textWidth, truncateText } from "./text";

/**
 * Legend drawn inside the chart's SVG (so PNG and HTML exports carry it):
 * one swatch per series, mirroring the mark (square for bars and areas,
 * short line for lines), label in text colour, wrapped on several rows.
 * Present for 2 series or more; a single series is named by the measure
 * caption. Entries are buttons: hovering, focusing or tapping one dims
 * the other series; a second tap or Escape clears it.
 */

/** The series a reader isolated from the legend (hover beats a tap). */
export interface SeriesFocus {
  /** Key of the isolated series, or null. */
  active: string | null;
  pinned: string | null;
  hover: (key: string | null) => void;
  toggle: (key: string) => void;
  clear: () => void;
}

export const useSeriesFocus = (): SeriesFocus => {
  const [pinned, setPinned] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const toggle = useCallback(
    (key: string) => setPinned((current) => (current === key ? null : key)),
    []
  );
  const clear = useCallback(() => {
    setPinned(null);
    setHovered(null);
  }, []);
  return {
    active: hovered ?? pinned,
    pinned,
    hover: setHovered,
    toggle,
    clear,
  };
};

/** Opacity of a series mark while another is isolated. */
export const DIMMED = 0.25;
export const seriesOpacity = (focus: SeriesFocus | undefined, key: string) =>
  focus?.active && focus.active !== key ? DIMMED : 1;

interface LegendItem {
  key: string;
  label: string;
  color: string;
  mark: "rect" | "line";
}

interface LegendLayout {
  entries: { item: LegendItem; text: string; x: number; y: number }[];
  height: number;
}

const LEGEND_FONT = 13;
const ROW = 22;
const SWATCH = 14;
const GAP = 6;
const ITEM_GAP = 18;

export const layoutLegend = (
  items: LegendItem[],
  width: number
): LegendLayout => {
  if (items.length < 2 || width <= 0) return { entries: [], height: 0 };
  const maxLabel = Math.max(80, Math.min(340, width - SWATCH - GAP));
  const entries: LegendLayout["entries"] = [];
  let x = 0;
  let y = 0;
  for (const item of items) {
    const text = truncateText(item.label, maxLabel, LEGEND_FONT);
    const w = SWATCH + GAP + textWidth(text, LEGEND_FONT);
    if (x > 0 && x + w > width) {
      x = 0;
      y += ROW;
    }
    entries.push({ item, text, x, y });
    x += w + ITEM_GAP;
  }
  return { entries, height: y + ROW };
};

export const SvgLegend = ({
  layout,
  theme,
  x,
  y,
  focus,
}: {
  layout: LegendLayout;
  theme: ChartTheme;
  x: number;
  y: number;
  focus?: SeriesFocus;
}) => {
  if (layout.entries.length === 0) return null;
  const onKeyDown = (event: KeyboardEvent<SVGGElement>, key: string) => {
    if (!focus) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      event.stopPropagation();
      focus.toggle(key);
    } else if (event.key === "Escape") {
      event.stopPropagation();
      focus.clear();
    }
  };
  return (
    <g transform={`translate(${x},${y})`} data-legend="true">
      {layout.entries.map(({ item, text, x: ex, y: ey }) => (
        <g
          key={item.key}
          transform={`translate(${ex},${ey})`}
          opacity={seriesOpacity(focus, item.key) < 1 ? 0.55 : 1}
          {...(focus
            ? {
                role: "button",
                tabIndex: 0,
                "aria-pressed": focus.pinned === item.key,
                "aria-label": item.label,
                "data-legend-entry": item.key,
                style: { cursor: "pointer", outline: "none" },
                onPointerEnter: (event: React.PointerEvent) =>
                  event.pointerType === "mouse" && focus.hover(item.key),
                onPointerLeave: (event: React.PointerEvent) =>
                  event.pointerType === "mouse" && focus.hover(null),
                onFocus: () => focus.hover(item.key),
                onBlur: () => focus.hover(null),
                onClick: () => focus.toggle(item.key),
                onKeyDown: (event: KeyboardEvent<SVGGElement>) =>
                  onKeyDown(event, item.key),
              }
            : {})}
        >
          <title>{item.label}</title>
          <rect
            x={-3}
            y={0}
            width={SWATCH + GAP + textWidth(text, LEGEND_FONT) + 6}
            height={ROW}
            rx={4}
            fill="transparent"
            stroke={focus?.pinned === item.key ? theme.axis : "none"}
            data-hit="true"
          />
          {item.mark === "rect" ? (
            <rect
              x={0}
              y={4}
              width={SWATCH - 2}
              height={SWATCH - 2}
              rx={2}
              fill={item.color}
            />
          ) : (
            <line
              x1={0}
              x2={SWATCH}
              y1={10}
              y2={10}
              stroke={item.color}
              strokeWidth={3}
              strokeLinecap="round"
            />
          )}
          <text
            x={SWATCH + GAP}
            y={14}
            fontSize={LEGEND_FONT}
            fill={theme.textSecondary}
          >
            {text}
          </text>
        </g>
      ))}
    </g>
  );
};
