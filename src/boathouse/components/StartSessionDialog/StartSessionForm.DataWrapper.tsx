import { StartSessionForm } from "./StartSession.Form";
import { getCurrentDateTime } from "../../../_common/utils/date.utils";
import { useClubOverviewStore } from "../../../_common/store/clubOverview.store";
import { defaultRoute } from "./RouteSection";
import { useBoatLevelConfigStore } from "../../../_common/store/boatLevelConfig.store";

interface StartSessionFormDataWrapperProps {
  closeAction: () => void;
  defaultBoat: {
    id: string;
    name: string;
    type?: string;
  };
}

export const StartSessionFormDataWrapper = ({
  closeAction,
  defaultBoat,
}: StartSessionFormDataWrapperProps) => {
  const defaultValues = {
    boat: defaultBoat,
    route: defaultRoute,
    selectedRowersOptions: [],
    startDateTime: getCurrentDateTime(),
    durationValue: "na" as const,
    comment: "",
  };

  const { getAllBoats, getAllRoutes, getAllRowers } = useClubOverviewStore();
  const { getBoatLevelConfig } = useBoatLevelConfigStore();

  return (
    <div className="flex flex-col gap-4">
      <StartSessionForm
        isLoading={false}
        startSessionData={{
          boats: getAllBoats().map((boat) => {
            const boatLevelConfig = getBoatLevelConfig(boat.id);
            return {
              ...boat,
              minimalRowerCategory:
                boatLevelConfig?.minimalRowerCategory || null,
              minimalRowerType: boatLevelConfig?.minimalRowerType || null,
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
        }}
      />
    </div>
  );
};
