import { MODULE_IDS } from "../../_common/business/modules.rules";
import type {
  EngineObjects,
  ReportAvailability,
  ReportDefinition,
} from "../types";

/**
 * Whether a report can run: its modules are on and its tables exist. A
 * module id unknown to MODULE_IDS (a module of a later version)
 * counts as not enabled.
 */
export const getReportAvailability = (
  report: Pick<ReportDefinition, "requires">,
  ctx: { objects: EngineObjects; enabledModules: readonly string[] }
): ReportAvailability => {
  for (const module of report.requires.modules ?? []) {
    const known = (MODULE_IDS as readonly string[]).includes(module);
    if (!known || !ctx.enabledModules.includes(module)) {
      return { available: false, reason: "module", module };
    }
  }
  for (const table of report.requires.tables) {
    if (!ctx.objects.tables.includes(table)) {
      return { available: false, reason: "table", table };
    }
  }
  return { available: true };
};
