import { UserIcon, ChatBubbleLeftIcon } from "@heroicons/react/16/solid";
import { useTranslation } from "react-i18next";
import { getTime, getDateOnly } from "../../_common/utils/date.utils";
import Loading from "../../_common/components/Loading";
import { Trash2Icon, UserCheckIcon, UserXIcon } from "lucide-react";
import { useRemoveSession } from "../hooks/useRemoveSession";
import { useAdminEditModeSystem } from "../../_common/store/adminEditMode.system";
import { toast } from "sonner";

export interface SessionInTable {
  id: string;
  rowers: {
    id: string;
    name: string;
  }[];
  boat: {
    id: string;
    name: string;
  };
  startDateTime: Date | null;
  endDateTime: Date | null;
  comment: string | null;
  route: {
    id: string;
    name: string;
  } | null;
  hasBeenCoached: boolean | null;
}

interface SessionHistoryTableProps {
  sessionsInTableList: SessionInTable[];
  loading: boolean;
  errorMessage?: string | null;
  refresh: () => Promise<void>;
}

export function SessionHistoryTable({
  sessionsInTableList,
  loading,
  errorMessage,
  refresh,
}: SessionHistoryTableProps) {
  const { t } = useTranslation();
  const { removeSession } = useRemoveSession();
  const adminEditSystem = useAdminEditModeSystem();

  return (
    <div className="overflow-auto pb-20">
      {sessionsInTableList.length === 0 && !loading && !errorMessage && (
        <p className="text-center py-16">{t("logbook.noSessions")}</p>
      )}

      {errorMessage && (
        <div className="flex justify-center items-center py-16 flex-col">
          <p className="text-red-500">{t("logbook.errorLoadingSessions")}</p>
          <p className="text-red-500">{errorMessage}</p>
        </div>
      )}

      {loading && (
        <div className="flex justify-center items-center py-16">
          <Loading />
        </div>
      )}

      {sessionsInTableList.map((session) => {
        return (
          <div
            key={session.id}
            className="flex even:bg-gray-100 py-6 px-12 items-center relative"
          >
            <span
              className="absolute bottom-2 right-2 text-error-800 underline text-sm cursor-pointer"
              // eslint-disable-next-line @typescript-eslint/no-misused-promises
              onClick={async () => {
                if (await adminEditSystem.askForAdminAccess()) {
                  await removeSession(session.id);
                  await refresh();
                  toast.success(t("logbook.sessionDeleted"));
                }
              }}
            >
              <Trash2Icon className="h-4 w-4" />
            </span>

            <div className="mr-12 font-mono tracking-tighter">
              <FormattedDate
                start={session.startDateTime}
                end={session.endDateTime}
              />
            </div>

            <div className="flex-1">
              <p className="flex mb-2 font-mono tracking-tighter">
                <span>
                  {session.boat.name} <span className="text-gray-300">|</span>{" "}
                  {session.route?.name || t("logbook.noRoute")}
                </span>
              </p>
              {session.rowers.length > 0 && (
                <>
                  <div className="text-sm text-gray-500">
                    <UserIcon className="h-4 w-4 align-text-bottom inline mr-1 text-gray-500" />{" "}
                    {session.rowers.map((r) => r.name).join(", ")}
                  </div>
                </>
              )}

              {session.comment && (
                <>
                  <div className="text-sm text-gray-500 mt-1">
                    <ChatBubbleLeftIcon className="h-4 w-4 align-text-bottom inline mr-1 text-gray-500" />{" "}
                    {session.comment || t("logbook.noComment")}
                  </div>
                </>
              )}

              {session.hasBeenCoached === true && (
                <div className="text-sm text-gray-600 mt-1">
                  <UserCheckIcon className="h-4 w-4 align-text-bottom inline mr-1 text-gray-600" />{" "}
                  {t("logbook.sessionCoached")}
                </div>
              )}

              {session.hasBeenCoached === false && (
                <div className="text-sm text-red-600 mt-1 text-gray-500">
                  <UserXIcon className="h-4 w-4 align-text-bottom inline mr-1 text-red-600" />{" "}
                  {t("logbook.sessionNotCoached")}
                </div>
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
  start: string | null | Date;
  end: string | null | Date;
}) => {
  if (!start) {
    return "N/A";
  }

  const startDate = new Date(start);
  const endDate = end ? getTime(new Date(end)) : "XX:XX";

  const duration = end ? new Date(end).getTime() - startDate.getTime() : 0;

  return (
    <div className="flex justify-center flex-col items-end text-sm gap-1">
      <p>{getDateOnly(startDate)}</p>
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
