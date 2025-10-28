import { ChatBubbleLeftIcon } from "@heroicons/react/16/solid";
import { useTranslation } from "react-i18next";
import useIncidentStore from "../../_common/store/incident.store";
import { getTime } from "../../_common/utils/date.utils";
import { useClubOverviewStore } from "../../_common/store/clubOverview.store";

export function IncidentLogsTable() {
  const { t } = useTranslation();
  const incidents = useIncidentStore((state) => state.getIncidents());

  const clubOverview = useClubOverviewStore();

  return (
    <div className="overflow-auto pb-32">
      {incidents.length === 0 && (
        <p className="text-center py-16">{t("logbook.noIncidents")}</p>
      )}

      {incidents.map((incident) => {
        return (
          <div
            key={incident.id}
            className="flex even:bg-gray-100 py-6 px-12 items-center relative"
          >
            <div className="mr-12 font-mono tracking-tighter">
              <FormattedDate datetime={incident.datetime} />
            </div>

            <div className="flex-1">
              <p className="flex mb-2 font-mono tracking-tighter">
                <span>
                  {clubOverview.getBoatById(incident.boatId)?.name ||
                    "NAME_NOT_FOUND"}
                </span>
              </p>
              <div className="text-sm text-gray-400 mt-1">
                <ChatBubbleLeftIcon className="h-4 w-4 align-text-bottom inline mr-1 text-gray-400" />{" "}
                {incident.message || t("logbook.noMessage")}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

const FormattedDate = ({ datetime }: { datetime: string }) => {
  const date = new Date(datetime);

  return (
    <div className="flex justify-center flex-col items-end text-sm gap-1">
      <p>{date.toLocaleDateString()}</p>
      <p>{getTime(date)}</p>
    </div>
  );
};
