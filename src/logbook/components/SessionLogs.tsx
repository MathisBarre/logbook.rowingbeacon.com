import Button from "../../_common/components/Button";
import { ZustandSession } from "../../_common/store/sessions.store";
import { SessionHistoryTable, SessionInTable } from "./SessionLogsTable";
import { useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { paginateData } from "../../_common/utils/pagination.utils";

export const SessionLogs = () => {
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 25;
  const formattedData = formatData(sessionsStore.session);

  const paginatedData = paginateData(formattedData, {
    currentPage,
    pageSize,
  });

  const numberOfPages = Math.ceil(formattedData.length / pageSize) || 1;

  return (
    <div className="flex-1 shadow-md bg-white flex flex-col absolute inset-0 right-1/2 mr-[.125rem] rounded overflow-hidden">
      <div className="bg-border p-2 bg-steel-blue-900 text-white flex justify-between h-12 items-center">
        <h1 className="text-base ml-2">Historique des sorties</h1>
      </div>

      <SessionHistoryTable sessionsInTableList={paginatedData} />

      <section className="shadow border py-4 px-8 absolute z-10 bg-white p-2 rounded bottom-4 left-1/2 -translate-x-1/2">
        <p className="italic text-center">
          Page {currentPage} sur {numberOfPages}
        </p>
        <div className="flex justify-center gap-4 mt-4">
          <Button
            type="button"
            variant="outlined"
            onClick={() => {
              setCurrentPage((prev) => Math.max(1, prev - 1));
            }}
            disabled={currentPage <= 1}
          >
            <ChevronLeftIcon />
          </Button>
          <Button
            type="button"
            variant="outlined"
            onClick={() => {
              setCurrentPage((prev) => Math.min(numberOfPages || 1, prev + 1));
            }}
            disabled={currentPage === numberOfPages}
          >
            <ChevronRightIcon />
          </Button>
        </div>
      </section>
    </div>
  );
};

const formatData = (
  clientSessionHistoryData: ZustandSession[]
): SessionInTable[] => {
  const clientSessionHistoryForTable: SessionInTable[] =
    clientSessionHistoryData.map((sess) => ({
      id: sess.id,
      boatName: sess.boat.name,
      startDateTime: sess.startDateTime,
      endDateTime: sess.endDateTime,
      routeName: sess.route.name,
      rowers: sess.rowers.map((r) => r.name).join(", "),
      comment: sess.comment,
      route: sess.route.name,
      rowersName: sess.rowers.map((r) => r.name),
      status: sess.endDateTime ? "COMPLETED" : "STARTED",
    }));

  const sortedMergedData = clientSessionHistoryForTable.sort((a, b) => {
    if (a.startDateTime && b.startDateTime) {
      return (
        new Date(b.startDateTime).getTime() -
        new Date(a.startDateTime).getTime()
      );
    }
    return 0;
  });

  return sortedMergedData;
};
