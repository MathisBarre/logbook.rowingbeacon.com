import { RefObject, useMemo } from "react";

/** Selector of the chart's root SVG drawn by ChartView (WP4). */
export const CHART_SVG_SELECTOR = "svg[data-chart-root]";

/**
 * A ref to the chart SVG inside `containerRef`, looked up when read (the
 * chart is redrawn when its data or mode changes). Given to ExportMenu
 * for the PNG export, and read by the annual report for its HTML export.
 */
export const useChartSvgRef = (
  containerRef: RefObject<HTMLElement>
): RefObject<SVGSVGElement> =>
  useMemo(
    () => ({
      get current() {
        return (
          containerRef.current?.querySelector<SVGSVGElement>(
            CHART_SVG_SELECTOR
          ) ?? null
        );
      },
    }),
    [containerRef]
  );
