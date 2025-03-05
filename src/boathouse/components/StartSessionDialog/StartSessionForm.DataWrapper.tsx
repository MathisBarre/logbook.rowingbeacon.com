import { StartSessionForm } from "./StartSession.Form";
import { getCurrentDateTime } from "../../../_common/utils/date.utils";
import { useClubOverviewStore } from "../../../_common/store/clubOverview.store";
import { defaultRoute } from "./RouteSection";

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

  const {
    DEPRECATED_getAllBoats: getAllBoats,
    getAllRoutes,
    getAllRowers,
  } = useClubOverviewStore();

  return (
    <div className="flex flex-col gap-4">
      <StartSessionForm
        isLoading={false}
        startSessionData={{
          boats: getAllBoats(),
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
