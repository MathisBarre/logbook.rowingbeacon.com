import { useTranslation } from "react-i18next";
import { StartSessionForm } from "./StartSession.Form";
import { getCurrentDateTime } from "../../../_common/utils/date.utils";
import { useClubOverviewStore } from "../../../_common/store/clubOverview.store";
import { getDefaultRoute } from "./RouteSection";
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
  const defaultValues = {
    boat: defaultBoat,
    route: getDefaultRoute(t),
    selectedRowersOptions: [],
    startDateTime: getCurrentDateTime(),
    durationValue: "na" as const,
    comment: "",
  };

  const { getAllBoats, getAllRoutes, getAllRowers } = useClubOverviewStore();
  const { getBoatLevelConfig } = useBoatLevelConfigStore();

  const defaultBoatLevelConfig = getBoatLevelConfig(defaultBoat.id);

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
            };
          }),
          routes: getAllRoutes(),
          rowers: getAllRowers(),
        }}
        cancelAction={closeAction}
        onSessionStarted={() => {
          closeAction();
        }}
        values={{
          ...defaultValues,
          boat: {
            ...getBoatWithoutUndefined(defaultValues.boat),
            note: getAllBoats().find((b) => b.id === defaultBoat.id)?.note,
            ageCategory: defaultBoatLevelConfig?.minimalRowerCategory || null,
            seriousnessCategory:
              defaultBoatLevelConfig?.minimalRowerType || null,
          },
        }}
      />
    </div>
  );
};
