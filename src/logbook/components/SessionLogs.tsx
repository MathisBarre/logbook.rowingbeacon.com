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
  HistoryIcon,
  LogsIcon,
} from "lucide-react";
import { useAdminEditModeSystem } from "../../_common/store/adminEditMode.system";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { OutingEditorDialog } from "./OutingEditor/OutingEditor.Dialog";
import type {
  OutingDraft,
  OutingEditorMode,
} from "../business/EditOuting/outingDraft";
import { getEmptyPastOutingDraft } from "../business/EditOuting/outingDraft.rules";
import { loadFinishedOutingDraft } from "../business/EditOuting/loadOutingDraft";

export const SessionLogs = () => {
  const { t } = useTranslation();
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

  const [editor, setEditor] = useState<{
    mode: OutingEditorMode;
    draft: OutingDraft;
  } | null>(null);

  const editFinishedOuting = async (outingId: string) => {
    let draft: OutingDraft | null;
    try {
      draft = await loadFinishedOutingDraft(outingId);
    } catch (error) {
      console.error("Failed to load the outing", error);
      toast.error(t("error.generic"));
      return;
    }
    if (!draft) {
      toast.error(t("outingEditor.notFound"));
      await refresh();
      return;
    }
    setEditor({ mode: "finished", draft });
  };

  return (
    <div className="flex-1 shadow-md bg-white flex flex-col absolute inset-0 right-1/2 mr-[.125rem] rounded overflow-hidden">
      <div className="bg-border p-2 bg-gradient-to-r from-steel-blue-800 to-steel-blue-700 text-white flex justify-between h-12 max-h-12 min-h-12 items-center">
        <h1 className="text-base ml-2 flex gap-2 items-center">
          <LogsIcon />
          {t("session.sessionHistory")}
        </h1>
        <div className="flex gap-2 h-full">
          <button
            type="button"
            className="bg-white/10 border border-white/30 hover:bg-white/20 rounded flex items-center justify-center px-3 text-white py-1 text-sm h-full"
            onClick={() =>
              setEditor({
                mode: "past",
                draft: getEmptyPastOutingDraft(new Date()),
              })
            }
          >
            <HistoryIcon className="h-4 w-4 mr-1" />
            {t("outingEditor.pastOuting")}
          </button>
          <button
            type="button"
            className="bg-gray-100 rounded flex items-center justify-center px-4 text-gray-700 py-1 text-sm h-full"
            // eslint-disable-next-line @typescript-eslint/no-misused-promises
            onClick={async () => {
              if (!(await adminEditSystem.askForAdminAccess())) {
                return;
              }

              setIsExportOpen(true);
            }}
          >
            {t("session.export")}
            <FileUpIcon className="h-4 w-4 ml-1" />
          </button>
        </div>

        <Dialog
          open={isExportOpen}
          onOpenChange={(open) => {
            setIsExportOpen(open);
          }}
        >
          <DialogContent
            title={t("session.exportHistory")}
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
        onEditSession={editFinishedOuting}
      />

      <OutingEditorDialog
        mode={editor?.mode ?? "past"}
        initialDraft={editor?.draft ?? null}
        onClose={() => setEditor(null)}
        onSaved={() => {
          refresh().catch((error) => {
            console.error("Failed to refresh the logbook", error);
          });
        }}
      />

      <section className="absolute z-10 p-2 bottom-0 left-0 rounded flex justify-center items-center gap-4 bg-steel-blue-800 text-white">
        <div className="flex justify-center gap-2 flex-1 ">
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
        <p className="italic text-center px-4">
          {t("session.pageOf", { current: currentPage, total: numberOfPages })}
        </p>

        <div className="absolute left-2 -top-2 w-2 h-2 z-10 -rotate-90">
          <svg
            width="4"
            height="4"
            viewBox="0 0 4 4"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path d="M0 4C0 2 2 0 4 0H0V4Z" fill="#22426A" />
          </svg>
        </div>
      </section>

      {/* DECORATIONS */}
      <div className="absolute l-0 t-0 b-0 w-2 h-full bg-steel-blue-800 z-10"></div>

      <div className="absolute left-[8px] top-12 w-2 h-2 z-10">
        <svg
          width="4"
          height="4"
          viewBox="0 0 4 4"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path d="M0 4C0 2 2 0 4 0H0V4Z" fill="#22426A" />
        </svg>
      </div>
      {/* DECORATIONS */}
    </div>
  );
};
