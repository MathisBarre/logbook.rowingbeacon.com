import {
  KeyboardEvent,
  PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { ChartTheme } from "./palette";

/** useLayoutEffect in the browser, useEffect when rendered to a string. */
export const useIsoLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;
import { clamp } from "./scale";

/**
 * Tooltips that work with a mouse, a finger and a keyboard (plan 1.7): a
 * mouse shows them on hover; a tap pins them, a second tap on the same
 * mark or a tap outside the chart closes them; arrow keys move between
 * marks when the chart has focus, Escape closes. Tooltips never gate a
 * value: every chart has its table view.
 */

export interface ActiveTarget {
  /** Category (bar, point, cell, day) index. */
  index: number;
  /** Second index when needed (pie slice, heatmap row). */
  sub?: number;
  /** Anchor in chart coordinates (px from the chart's top left). */
  x: number;
  y: number;
  /**
   * Where the box goes so that it never covers the data it describes:
   * `right` of x (bar end, band, crosshair), flipping left of `flipX`;
   * `above` y (cells), flipping below `y + h`. Default: `above`.
   */
  placement?: "right" | "above";
  /** Left edge used when a `right` box flips (default: x). */
  flipX?: number;
  /** Height of the anchored mark (a cell), for the flip below. */
  h?: number;
  pinned: boolean;
}

export type Target = Omit<ActiveTarget, "pinned">;

/** Keyboard steps of a chart's marks (see `keyDown`). */
export interface GridNav {
  h: number;
  v: number;
  rowStart?: (index: number) => number;
  rowEnd?: (index: number) => number;
}
const LINEAR: GridNav = { h: 1, v: 1 };

const isSame = (a: Target | null, b: Target) =>
  a !== null && a.index === b.index && a.sub === b.sub;

export const useChartPointer = () => {
  const [active, setActive] = useState<ActiveTarget | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const pinned = active?.pinned ?? false;

  useEffect(() => {
    if (!pinned) return;
    const close = (event: PointerEvent) => {
      const root = rootRef.current;
      if (
        root &&
        event.target instanceof Node &&
        !root.contains(event.target)
      ) {
        setActive(null);
      }
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [pinned]);

  const hover = useCallback(
    (target: Target, event: ReactPointerEvent<Element>) => {
      if (event.pointerType !== "mouse") return;
      setActive((current) =>
        current && isSame(current, target) && current.pinned
          ? current
          : { ...target, pinned: false }
      );
    },
    []
  );

  const leave = useCallback((event: ReactPointerEvent<Element>) => {
    if (event.pointerType !== "mouse") return;
    setActive((current) => (current?.pinned ? current : null));
  }, []);

  const tap = useCallback((target: Target) => {
    setActive((current) =>
      current?.pinned && isSame(current, target)
        ? null
        : { ...target, pinned: true }
    );
  }, []);

  const close = useCallback(() => setActive(null), []);

  /**
   * Arrow keys move between the `count` marks (`nav` for 2-D grids: the
   * index steps of ←→ and ↑↓, and the ends of the current row for Home and
   * End; Ctrl+Home/End go to the grid's ends); Escape closes.
   */
  const keyDown = useCallback(
    (
      event: KeyboardEvent<Element>,
      count: number,
      locate: (index: number) => Target | null,
      nav: GridNav = LINEAR
    ) => {
      if (count === 0) return;
      const current = active?.index ?? -1;
      const from = current === -1 ? 0 : current;
      const move = (delta: number) =>
        current === -1 ? 0 : clamp(current + delta, 0, count - 1);
      let next: number | null = null;
      if (event.key === "ArrowRight") next = move(nav.h);
      else if (event.key === "ArrowLeft") next = move(-nav.h);
      else if (event.key === "ArrowDown") next = move(nav.v);
      else if (event.key === "ArrowUp") next = move(-nav.v);
      else if (event.key === "Home") {
        next =
          event.ctrlKey || event.metaKey || !nav.rowStart
            ? 0
            : nav.rowStart(from);
      } else if (event.key === "End") {
        next =
          event.ctrlKey || event.metaKey || !nav.rowEnd
            ? count - 1
            : nav.rowEnd(from);
      } else if (event.key === "Escape") {
        setActive(null);
        return;
      }
      if (next === null) return;
      event.preventDefault();
      const target = locate(next);
      if (target) setActive({ ...target, pinned: true });
    },
    [active]
  );

  return { active, rootRef, hover, leave, tap, close, keyDown };
};

export interface TooltipRow {
  key: string;
  value: string;
  label?: string;
  color?: string;
  /** Key drawn before the row: a short line (default) or a square. */
  mark?: "line" | "rect";
  /** A total line, set apart by a rule. */
  total?: boolean;
}

export interface TooltipContent {
  title: string;
  rows: TooltipRow[];
  footer?: string;
}

const GAP = 12;

/**
 * The tooltip box, placed beside or above its anchor (see
 * `ActiveTarget.placement`) and kept inside the chart.
 */
export const ChartTooltip = ({
  target,
  content,
  containerWidth,
  containerHeight,
  theme,
}: {
  target: ActiveTarget | null;
  content: TooltipContent | null;
  containerWidth: number;
  /** Height of the chart, so that a box beside a mark stays inside. */
  containerHeight?: number;
  theme: ChartTheme;
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(
    null
  );

  useIsoLayoutEffect(() => {
    const box = ref.current;
    if (!box || !target) return;
    const width = box.offsetWidth;
    const height = box.offsetHeight;
    const maxLeft = Math.max(4, containerWidth - width - 4);
    if (target.placement === "right") {
      const right = target.x + GAP;
      const left =
        right + width <= containerWidth - 4
          ? right
          : Math.max(4, (target.flipX ?? target.x) - GAP - width);
      const bottom = containerHeight ?? Infinity;
      setPlace({
        left: Math.min(left, maxLeft),
        top: Math.max(4, Math.min(target.y - 8, bottom - height - 4)),
      });
      return;
    }
    const left = clamp(target.x - width / 2, 4, maxLeft);
    const above = target.y - 6 - height;
    setPlace({
      left,
      top: above >= 0 ? above : target.y + (target.h ?? 0) + 6,
    });
  }, [target, content, containerWidth, containerHeight]);

  if (!target || !content) return null;
  return (
    <div
      ref={ref}
      role="status"
      className="pointer-events-none absolute z-10 max-w-sm rounded-md px-3 py-2 text-sm shadow-md"
      style={{
        left: place?.left ?? Math.max(4, target.x - 100),
        top: place?.top ?? Math.max(0, target.y - 60),
        visibility: place ? undefined : "hidden",
        background: theme.surface,
        color: theme.textPrimary,
        border: `1px solid ${theme.border}`,
      }}
    >
      <p
        className="font-medium break-words"
        style={{ color: theme.textSecondary }}
      >
        {content.title}
      </p>
      {content.rows.length > 0 && (
        <ul className="mt-1 flex flex-col gap-0.5">
          {content.rows.map((row) => (
            <li
              key={row.key}
              className={`flex items-baseline gap-2 tabular-nums ${row.total ? "mt-0.5 border-t pt-0.5" : ""}`}
              style={row.total ? { borderColor: theme.border } : undefined}
            >
              {row.color ? (
                <span
                  aria-hidden="true"
                  className="inline-block shrink-0 self-center"
                  style={
                    row.mark === "rect"
                      ? {
                          width: 10,
                          height: 10,
                          borderRadius: 2,
                          background: row.color,
                        }
                      : {
                          width: 14,
                          height: 3,
                          borderRadius: 2,
                          background: row.color,
                        }
                  }
                />
              ) : row.total ? (
                <span
                  aria-hidden="true"
                  className="inline-block w-2.5 shrink-0"
                />
              ) : null}
              <span className="font-semibold whitespace-nowrap">
                {row.value}
              </span>
              {row.label && (
                <span
                  className="break-words"
                  style={{ color: theme.textSecondary }}
                >
                  {row.label}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {content.footer && (
        <p className="mt-1 text-xs" style={{ color: theme.textSecondary }}>
          {content.footer}
        </p>
      )}
    </div>
  );
};

/**
 * Rows of a multi-series tooltip: every series in `order` (as drawn, top
 * to bottom), "—" when a series has no value there, zeros left out when
 * there are more than 3 series.
 */
export const seriesRows = <
  S extends { key: string; label: string; color: string; column: string },
>(
  series: S[],
  valueOf: (s: S) => number | null,
  format: (column: string, value: number | null) => string,
  mark: "line" | "rect",
  missing: string
): TooltipRow[] =>
  series
    .filter((s) => !(series.length > 3 && valueOf(s) === 0))
    .map((s) => {
      const v = valueOf(s);
      return {
        key: s.key,
        color: s.color,
        mark,
        value: v === null ? missing : format(s.column, v),
        label: s.label,
      };
    });
