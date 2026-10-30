import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { AiKeyCard } from "./AiKeyCard";
import { McpCard } from "./McpCard";
import { PerformanceCard } from "./PerformanceCard";
import { RankingsCard } from "./RankingsCard";
import { SeasonCard } from "./SeasonCard";
// Registers the analytics strings with this chunk.
import "../i18n";

/** Cards another screen can send the user to ("…› Performances"). */
export type AnalyticsSettingsSection = "ai" | "mcp" | "performance";

/**
 * Gestion › Statistiques et IA (plan 1.3), lazy-loaded by the Parameters
 * screen, which is already behind the admin password. One column, from
 * what every club needs to what only an expert touches: season, rankings,
 * built-in AI assistant, your AI app (MCP), performance.
 */
export const AnalyticsSettingsTab = ({
  section,
}: {
  /** Scrolled into view and focused (its title) once, on mount. */
  section?: AnalyticsSettingsSection | null;
}) => {
  const { t } = useTranslation();

  useEffect(() => {
    if (!section) return;
    // After the lazy cards have rendered their first frame.
    const frame = requestAnimationFrame(() => {
      document
        .getElementById(`analytics-${section}`)
        ?.scrollIntoView({ block: "start" });
      document
        .getElementById(`analytics-${section}-title`)
        ?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [section]);

  return (
    <div className="bg-white shadow-md absolute inset-0 rounded overflow-auto flex flex-col">
      <div className="p-2 bg-steel-blue-900 text-white flex justify-between h-12">
        <h1 className="text-base ml-2 flex gap-2 items-center font-medium">
          {t("analytics.settings.tabLabel")}
        </h1>
      </div>
      <div className="flex-1 relative">
        <div className="p-3 [@media(min-height:641px)]:p-4 [@media(min-height:641px)]:md:p-6 absolute inset-0 overflow-auto">
          <div className="flex flex-col gap-4 max-w-3xl">
            <p className="text-gray-600">{t("analytics.settings.intro")}</p>
            <SeasonCard />
            <RankingsCard />
            <AiKeyCard />
            <McpCard />
            <PerformanceCard />
          </div>
        </div>
      </div>
    </div>
  );
};
