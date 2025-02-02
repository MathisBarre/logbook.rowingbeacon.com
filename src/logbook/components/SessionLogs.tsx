import { useState } from "react";
import Button from "../../_common/components/Button";
import { Dialog, DialogContent } from "../../_common/components/Dialog/Dialog";
import { useGetLastSessions } from "../hooks/useGetSessions";
import { ExportSessions } from "./ExportSessions";
import { SessionHistoryTable } from "./SessionLogsTable";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  FileUpIcon,
  LogsIcon,
} from "lucide-react";
import {
  askForAdminPassword,
  useAdminEditModeSystem,
} from "../../_common/store/adminEditMode.system";

export const SessionLogs = () => {
  const {
    numberOfPages,
    currentPage,
    next,
    prev,
    loading,
    sessions,
    errorMessage,
    refresh,
  } = useGetLastSessions({
    pageSize: 24,
  });

  const [isExportOpen, setIsExportOpen] = useState(false);

  const adminEditSystem = useAdminEditModeSystem();

  return (
    <div className="flex-1 shadow-md bg-white flex flex-col absolute inset-0 right-1/2 mr-[.125rem] rounded overflow-hidden">
      <div className="bg-border p-2 bg-gradient-to-r from-steel-blue-800 to-steel-blue-700 text-white flex justify-between h-12 items-center">
        <h1 className="text-base ml-2 flex gap-2 items-center">
          <LogsIcon />
          Historique des sorties
        </h1>
        <button
          type="button"
          className="bg-gray-100 rounded flex items-center justify-center px-4 text-gray-700 py-1 text-sm h-full"
          // eslint-disable-next-line @typescript-eslint/no-misused-promises
          onClick={async () => {
            if (
              !adminEditSystem.allowAdminActions(await askForAdminPassword())
            ) {
              return;
            }

            setIsExportOpen(true);
          }}
        >
          Exporter
          <FileUpIcon className="h-4 w-4 ml-1" />
        </button>

        <Dialog
          open={isExportOpen}
          onOpenChange={(open) => {
            setIsExportOpen(open);
          }}
        >
          <DialogContent
            title="Exporter l'historique des sorties"
            className="max-w-xl"
          >
            <ExportSessions
              closeDialog={() => {
                setIsExportOpen(false);
              }}
            />
          </DialogContent>
        </Dialog>
      </div>

      <SessionHistoryTable
        sessionsInTableList={sessions}
        loading={loading}
        errorMessage={errorMessage}
        refresh={refresh}
      />

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
