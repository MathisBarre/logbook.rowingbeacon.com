import { useState } from "react";
import { useTranslation } from "react-i18next";
import { SirenIcon, WrenchIcon } from "lucide-react";
import { IncidentLogsTable } from "./IncidentLogsTable";
import { DamageLogsTable } from "./DamageLogsTable";
import { useModule } from "../../_common/store/modules.store";
import { ReportDamageDialog } from "../../_common/components/damages/ReportDamageDialog";
import { cn } from "../../_common/utils/utils";

type Tab = "damages" | "incidents";

export const IncidentLogs = () => {
  const { t } = useTranslation();
  const hasDamages = useModule("damages");
  const [tab, setTab] = useState<Tab>("damages");
  const [isReportOpen, setIsReportOpen] = useState(false);
  const shownTab = hasDamages ? tab : "incidents";

  return (
    <div className="flex-1 shadow-md bg-white flex flex-col absolute inset-0 left-1/2 ml-[.125rem] rounded overflow-hidden">
      <div className="bg-border p-2 bg-gradient-to-r from-steel-blue-800 to-steel-blue-700 text-white flex justify-between items-center h-12 min-h-12 max-h-12">
        {hasDamages ? (
          <div className="flex gap-1 ml-2 h-full" role="tablist">
            <TabButton
              selected={shownTab === "damages"}
              onClick={() => setTab("damages")}
            >
              <WrenchIcon className="h-5 w-5" /> {t("damages.title")}
            </TabButton>
            <TabButton
              selected={shownTab === "incidents"}
              onClick={() => setTab("incidents")}
            >
              <SirenIcon className="h-5 w-5" /> {t("logbook.incidents")}
            </TabButton>
          </div>
        ) : (
          <h1 className="text-base ml-2 flex gap-2 items-center">
            <SirenIcon /> {t("logbook.incidentHistory")}
          </h1>
        )}

        {hasDamages && shownTab === "damages" && (
          <button
            type="button"
            className="bg-gray-100 rounded flex items-center justify-center px-4 text-gray-700 py-1 text-sm h-full"
            onClick={() => setIsReportOpen(true)}
          >
            {t("damages.report")}
          </button>
        )}
      </div>

      {shownTab === "damages" ? <DamageLogsTable /> : <IncidentLogsTable />}

      {hasDamages && (
        <ReportDamageDialog
          open={isReportOpen}
          onOpenChange={setIsReportOpen}
        />
      )}

      {/* DECORATIONS */}
      <div className="absolute l-0 t-0 b-0 w-2 h-full bg-steel-blue-800 z-10"></div>

      <div className="absolute left-2 top-12 w-2 h-2 z-10">
        <svg
          width="4"
          height="4"
          viewBox="0 0 4 4"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path d="M0 4C0 2 2 0 4 0H0V4Z" fill="#22426A" />
        </svg>
      </div>

      <div className="absolute left-[8px] top-12 w-2 h-2 z-10">
        <svg
          width="4"
          height="4"
          viewBox="0 0 4 4"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path d="M0 4C0 2 2 0 4 0H0V4Z" fill="#22426A" />
        </svg>
      </div>
      {/* DECORATIONS */}
    </div>
  );
};

const TabButton = ({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) => (
  <button
    type="button"
    role="tab"
    aria-selected={selected}
    onClick={onClick}
    className={cn(
      "flex gap-2 items-center px-3 rounded text-base",
      selected ? "bg-white/20" : "opacity-70 hover:opacity-100"
    )}
  >
    {children}
  </button>
);
