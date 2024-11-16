import { ChatBubbleLeftIcon } from "@heroicons/react/16/solid";
import useIncidentStore from "../../_common/store/incident.store";
import { getTime } from "../../_common/utils/date.utils";
import { useIncidentSystem } from "../../_common/store/incident.system";

export function IncidentLogsTable() {
  const incidents = useIncidentStore((state) => state.getIncidents());
  const { getBoatNameBySessionId } = useIncidentSystem();

  return (
    <div className="overflow-auto pb-32">
      {incidents.length === 0 && (
        <p className="text-center py-16">Aucun incident</p>
      )}

      {incidents.map((incident) => {
        const boatName = getBoatNameBySessionId(incident.sessionId);
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
                <span>{boatName}</span>
              </p>
              <div className="text-sm text-gray-400 mt-1">
                <ChatBubbleLeftIcon className="h-4 w-4 align-text-bottom inline mr-1 text-gray-400" />{" "}
                {incident.message || "Aucun message"}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

const FormattedDate = ({ datetime }: { datetime: Date }) => {
  const date = new Date(datetime);

  return (
    <div className="flex justify-center flex-col items-end text-sm gap-1">
      <p>{date.toLocaleDateString()}</p>
      <p>{getTime(date)}</p>
    </div>
  );
};
