import Button from "../../_common/components/Button";
import { useGetLastSessions } from "../hooks/useGetSessions";
import { SessionHistoryTable } from "./SessionLogsTable";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

export const SessionLogs = () => {
  const { numberOfPages, currentPage, next, prev, loading, sessions } =
    useGetLastSessions({
      pageSize: 10,
    });

  return (
    <div className="flex-1 shadow-md bg-white flex flex-col absolute inset-0 right-1/2 mr-[.125rem] rounded overflow-hidden">
      <div className="bg-border p-2 bg-steel-blue-900 text-white flex justify-between h-12 items-center">
        <h1 className="text-base ml-2">Historique des sorties</h1>
      </div>

      <SessionHistoryTable sessionsInTableList={sessions} loading={loading} />

      <section className="shadow border py-4 px-8 absolute z-10 bg-white p-2 rounded bottom-4 left-1/2 -translate-x-1/2">
        <p className="italic text-center">
          Page {currentPage} sur {numberOfPages}
        </p>
        <div className="flex justify-center gap-4 mt-4">
          <Button
            type="button"
            variant="outlined"
            onClick={prev}
            disabled={currentPage <= 1}
          >
            <ChevronLeftIcon />
          </Button>
          <Button
            type="button"
            variant="outlined"
            onClick={next}
            disabled={currentPage === numberOfPages}
          >
            <ChevronRightIcon />
          </Button>
        </div>
      </section>
    </div>
  );
};
