import { useState } from "react";
import { useTranslation } from "react-i18next";
import { StartSessionForm } from "./StartSession.Form";
import { getCurrentDateTime } from "../../../_common/utils/date.utils";
import { useClubOverviewStore } from "../../../_common/store/clubOverview.store";
import { getDefaultRoute } from "./RouteSection";
import { getOutingConfiguration } from "../../business/StartSession/StartSession.rules";
import { useBoatLevelConfigStore } from "../../../_common/store/boatLevelConfig.store";
import {
  BoatTypeEnum,
  getBoatWithoutUndefined,
} from "../../../_common/business/boat.rules";

interface StartSessionFormDataWrapperProps {
  closeAction: () => void;
  defaultBoat: {
    id: string;
    name: string;
    type?: BoatTypeEnum;
  };
}

export const StartSessionFormDataWrapper = ({
  closeAction,
  defaultBoat,
}: StartSessionFormDataWrapperProps) => {
  const { t } = useTranslation();
  const { getAllBoats, getAllRoutes, getAllRowers } = useClubOverviewStore();
  const { getBoatLevelConfig } = useBoatLevelConfigStore();

  // Computed once: new values would reset what the user already typed.
  const [initialValues] = useState(() => {
    const defaultBoatLevelConfig = getBoatLevelConfig(defaultBoat.id);
    return {
      route: getDefaultRoute(t),
      selectedRowersOptions: [],
      cox: null,
      outingTypeCode: null,
      captainId: null,
      boatConfigurationId:
        getOutingConfiguration(
          useClubOverviewStore.getState().getBoatById(defaultBoat.id) ?? {}
        )?.id ?? null,
      startDateTime: getCurrentDateTime(),
      durationValue: "na" as const,
      comment: "",
      boat: {
        ...getBoatWithoutUndefined(defaultBoat),
        note: getAllBoats().find((b) => b.id === defaultBoat.id)?.note,
        ageCategory: defaultBoatLevelConfig?.minimalRowerCategory || null,
        seriousnessCategory: defaultBoatLevelConfig?.minimalRowerType || null,
      },
    };
  });

  return (
    <div className="flex flex-col gap-4">
      <StartSessionForm
        isLoading={false}
        startSessionData={{
          boats: getAllBoats().map((boat) => {
            const boatLevelConfig = getBoatLevelConfig(boat.id);
            return {
              ...getBoatWithoutUndefined(boat),
              note: boat.note,
              ageCategory: boatLevelConfig?.minimalRowerCategory || null,
              seriousnessCategory: boatLevelConfig?.minimalRowerType || null,
              configurations: boat.configurations,
            };
          }),
          routes: getAllRoutes(),
          rowers: getAllRowers(),
        }}
        cancelAction={closeAction}
        onSessionStarted={() => {
          closeAction();
        }}
        values={initialValues}
      />
    </div>
  );
};
