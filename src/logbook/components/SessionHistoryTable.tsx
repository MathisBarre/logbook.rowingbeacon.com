import { UserIcon, ChatBubbleLeftIcon } from "@heroicons/react/16/solid";
import { getTime } from "../../_common/utils/date.utils";

export interface SessionInTable {
  id: string;
  rowersName: string[];
  boatName: string;
  startDateTime: string | null;
  endDateTime: string | null;
  status: string;
  comment: string | null;
  route: string;
}

interface SessionHistoryTableProps {
  sessionsInTableList: SessionInTable[];
}

export function SessionHistoryTable({
  sessionsInTableList,
}: SessionHistoryTableProps) {
  return (
    <div className="overflow-auto pb-32">
      {sessionsInTableList.length === 0 && (
        <p className="text-center py-16">Aucune session</p>
      )}

      {sessionsInTableList.map((session) => {
        return (
          <div
            key={session.id}
            className="flex even:bg-gray-100 py-6 px-12 items-center relative"
          >
            <div className="mr-12 font-mono tracking-tighter">
              <FormattedDate
                start={session.startDateTime}
                end={session.endDateTime}
              />
            </div>

            <div className="flex-1">
              <p className="flex mb-2 font-mono tracking-tighter">
                <span>
                  {session.boatName} <span className="text-gray-300">|</span>{" "}
                  {session.route}
                </span>
              </p>
              {session.rowersName.length > 0 && (
                <>
                  <div className="text-sm text-gray-400">
                    <UserIcon className="h-4 w-4 align-text-bottom inline mr-1 text-gray-400" />{" "}
                    {session.rowersName.join(", ")}
                  </div>
                </>
              )}

              {session.comment && (
                <>
                  <div className="text-sm text-gray-400 mt-1">
                    <ChatBubbleLeftIcon className="h-4 w-4 align-text-bottom inline mr-1 text-gray-400" />{" "}
                    {session.comment || "Aucun commentaire"}
                  </div>
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const FormattedDate = ({
  start,
  end,
}: {
  start: string | null;
  end: string | null;
}) => {
  if (!start) {
    return "N/A";
  }

  const startDate = new Date(start);
  const endDate = end ? getTime(new Date(end)) : "XX:XX";

  const duration = end ? new Date(end).getTime() - startDate.getTime() : 0;

  return (
    <div className="flex justify-center flex-col items-end text-sm gap-1">
      <p>{startDate.toLocaleDateString()}</p>
      <p>
        {getTime(startDate)} - {endDate}
      </p>
      <p>{millisecondeToHourMinute(duration)}</p>
    </div>
  );
};

const millisecondeToHourMinute = (milliseconde: number) => {
  const hours = Math.floor(milliseconde / 1000 / 60 / 60)
    .toString()
    .padStart(2, "0");
  const minutes = Math.floor((milliseconde / 1000 / 60) % 60)
    .toString()
    .padStart(2, "0");

  return `${hours}h${minutes}`;
};
