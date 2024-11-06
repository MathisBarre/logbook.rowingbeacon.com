import { StartSessionForm } from "./StartSession.Form";
import { getCurrentDateTime } from "../../../_common/utils/date.utils";
import { useClubOverviewStore } from "../../../_common/store/clubOverview.store";

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
    route: { id: "null", name: "" },
    selectedRowersOptions: [],
    startDateTime: getCurrentDateTime(),
    estimatedEndDateTime: "",
    comment: "",
  };

  const { clubOverview } = useClubOverviewStore();

  if (!clubOverview) {
    return null;
  }

  return (
    <div className="flex flex-col gap-4">
      <StartSessionForm
        isLoading={false}
        startSessionData={clubOverview}
        cancelAction={closeAction}
        onSessionStarted={async () => {
          closeAction();
        }}
        values={{
          ...defaultValues,
          route: clubOverview.routes.sort()[0],
        }}
      />
    </div>
  );
};
