/**
 * Opens a page of Gestion from the analytics hub (plan 1.3): "Voir dans
 * Gestion" after a module is turned on, the dashboard's "Importer un
 * historique" (Données), a link to the analytics settings. The Parameters
 * screen keeps its tab in local state, so the request is handed over here
 * and read once when it mounts:
 * `useState(() => takeRequestedParametersPage() ?? "rowers")`.
 *
 * For the analytics page, a section can be asked for as well; the
 * settings tab reads it once with `takeRequestedAnalyticsSection()`.
 */

export type RequestedParametersPage = "modules" | "data" | "analytics";

/** Sections of Gestion › Statistiques that can be scrolled to. */
export type AnalyticsSection = "ai" | "mcp" | "performance";

let requested: RequestedParametersPage | null = null;
let requestedSection: AnalyticsSection | null = null;

/** `section` only applies to the "analytics" page. */
export function requestParametersPage(
  page: RequestedParametersPage,
  section?: AnalyticsSection
): void {
  requested = page;
  requestedSection = page === "analytics" ? (section ?? null) : null;
}

/** The page asked for, once (null afterwards). */
export const takeRequestedParametersPage =
  (): RequestedParametersPage | null => {
    const page = requested;
    requested = null;
    return page;
  };

/** The analytics settings section asked for, once (null afterwards). */
export function takeRequestedAnalyticsSection(): AnalyticsSection | null {
  const section = requestedSection;
  requestedSection = null;
  return section;
}
