import { lazy, Suspense, useState } from "react";
import { RowersCrud } from "./components/RowersCrud";
import { forEnum } from "../_common/utils/utils";
import { BoatCrud } from "./components/BoatsCrud";
import { MiscParams } from "./components/MiscParams";
import { ModulesParams } from "./components/ModulesParams";
import { DataParams } from "./components/DataParams";
import { useTranslation } from "react-i18next";
import Loading from "../_common/components/Loading";
import {
  takeRequestedAnalyticsSection,
  takeRequestedParametersPage,
} from "../analytics/reportsUi/parametersRequest";

const AnalyticsSettingsTab = lazy(() =>
  import("../analytics/settings/AnalyticsSettingsTab").then((m) => ({
    default: m.AnalyticsSettingsTab,
  }))
);

type Page = "rowers" | "boats" | "misc" | "modules" | "analytics" | "data";

export const ParametersScreen = () => {
  const { t } = useTranslation();
  const [page, setPage] = useState<Page>(
    () => takeRequestedParametersPage() ?? "rowers"
  );
  const [section] = useState(() => takeRequestedAnalyticsSection());

  return (
    <div className="flex flex-col h-full gap-1">
      <div className="flex-1 relative">
        {forEnum(page, {
          rowers: () => <RowersCrud />,
          boats: () => <BoatCrud />,
          misc: () => <MiscParams />,
          modules: () => <ModulesParams />,
          analytics: () => (
            <Suspense fallback={<Loading />}>
              <AnalyticsSettingsTab section={section} />
            </Suspense>
          ),
          data: () => <DataParams />,
        })}
      </div>

      <nav className="flex gap-1">
        <NavigationButton
          label={t("parameters.misc")}
          page="misc"
          currentPage={page}
          setPage={setPage}
        />
        <NavigationButton
          label={t("backup.dataTitle")}
          page="data"
          currentPage={page}
          setPage={setPage}
        />
        <NavigationButton
          label={t("modules.title")}
          page="modules"
          currentPage={page}
          setPage={setPage}
        />
        <NavigationButton
          label={t("analytics.settings.tabLabel")}
          page="analytics"
          currentPage={page}
          setPage={setPage}
        />
        <NavigationButton
          label={t("parameters.boats")}
          page="boats"
          currentPage={page}
          setPage={setPage}
        />
        <NavigationButton
          label={t("parameters.rowers")}
          page="rowers"
          currentPage={page}
          setPage={setPage}
        />
      </nav>
    </div>
  );
};

const NavigationButton = ({
  label,
  page,
  currentPage,
  setPage,
}: {
  label: string;
  page: Page;
  currentPage: Page;
  setPage: (page: Page) => void;
}) => {
  return (
    <button
      onClick={() => {
        setPage(page);
      }}
      className={
        "rounded text-sm font-medium shadow-md bg-white text-steel-blue-800 hover:bg-gray-50 flex-1 h-10" +
        (currentPage === page
          ? " border border-steel-blue-800 border-opacity-75"
          : "")
      }
    >
      {label}
    </button>
  );
};
