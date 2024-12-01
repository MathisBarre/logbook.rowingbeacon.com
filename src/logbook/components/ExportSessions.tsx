import { z } from "zod";
import { dateStringSchema } from "../../_common/utils/commonSchema";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { FormField } from "../../_common/components/Form";
import Button from "../../_common/components/Button";
import { Label } from "../../_common/components/Label";
import { addMonths, getDateTime } from "../../_common/utils/date.utils";
import { useExportSessions } from "../hooks/useExportSessions";
import { CheckIcon } from "lucide-react";

const ExportSessionsFormSchema = z.object({
  fromDate: dateStringSchema,
  toDate: dateStringSchema,
  fileType: z.enum(["ods", "xlsx", "json", "csv"]),
});

type StartSessionFormValues = z.infer<typeof ExportSessionsFormSchema>;

export const ExportSessions = ({
  closeDialog,
}: {
  closeDialog: () => void;
}) => {
  const form = useForm<StartSessionFormValues>({
    resolver: zodResolver(ExportSessionsFormSchema),
    defaultValues: {
      fileType: "ods",
      fromDate: getDateTime(addMonths(new Date(), -1)),
      toDate: getDateTime(new Date()),
    },
  });

  const { exportSessions, isLoading, fileName, closeSuccess, isExportSuccess } =
    useExportSessions();

  const handleSubmit = form.handleSubmit(exportSessions);

  return (
    <>
      {isExportSuccess && (
        <ExportSessionSuccess
          TextContent={() => (
            <>
              <p>Export réalisé avec succès</p>
              <p>
                "{fileName}" a été téléchargé dans votre dossier
                "Téléchargements"
              </p>
            </>
          )}
          btn2={() => {
            closeSuccess();
            closeDialog();
          }}
          btn1={() => {
            closeSuccess();
          }}
        />
      )}
      <form
        className="flex flex-col gap-6"
        onSubmit={(e) => {
          e.preventDefault();
          handleSubmit();
        }}
      >
        <div className="flex gap-6">
          <div className="flex-1">
            <FormField
              control={form.control}
              name="fromDate"
              render={({ field, fieldState }) => (
                <>
                  <Label className="flex flex-col gap-1">
                    Depuis le
                    <input className="input" type="date" {...field} />
                  </Label>
                  {fieldState.error && (
                    <p className="form-error mt-1">
                      {fieldState.error.message}
                    </p>
                  )}
                </>
              )}
            />
          </div>
          <div className="flex-1">
            <FormField
              control={form.control}
              name="toDate"
              render={({ field, fieldState }) => (
                <>
                  <Label className="flex flex-col gap-1">
                    Jusqu'au
                    <input className="input flex-1" type="date" {...field} />
                  </Label>

                  {fieldState.error && (
                    <p className="form-error mt-1">
                      {fieldState.error.message}
                    </p>
                  )}
                </>
              )}
            />
          </div>
        </div>
        <div>
          <FormField
            control={form.control}
            name="fileType"
            render={({ field, fieldState }) => (
              <>
                <Label className="flex flex-col gap-1">
                  Type de fichier
                  <select className="input" {...field}>
                    <option value="ods">.ods - OpenDocument</option>
                    <option value="xlsx">.xlsx - Excel</option>
                    <option value="json">.json - JSON</option>
                    <option value="csv">.csv - CSV</option>
                  </select>
                </Label>

                {fieldState.error && (
                  <p className="form-error mt-1">{fieldState.error.message}</p>
                )}
              </>
            )}
          />
        </div>
        <Button loading={isLoading} type="submit">
          Exporter
        </Button>
      </form>
    </>
  );
};

const ExportSessionSuccess = ({
  TextContent,
  btn1,
  btn2,
}: {
  TextContent: () => React.ReactNode;
  btn1: () => void;
  btn2: () => void;
}) => {
  return (
    <div className="absolute inset-0 bg-white bg-opacity-80 backdrop-blur-sm z-10">
      <div className="flex justify-center items-center flex-col h-full mx-auto px-6 gap-6 py-6">
        <div className="flex-1" />
        <CheckIcon className="h-8 w-8 text-success-700" />
        <p className="text-center max-w-96">
          <TextContent />
        </p>
        <div className="flex-1" />
        <div className="flex gap-2 w-full">
          <Button
            className="flex-1"
            type="button"
            variant="outlined"
            color="primary"
            onClick={btn1}
          >
            Créer un nouveau export
          </Button>
          <Button className="flex-1" type="button" onClick={btn2}>
            Revenir à la liste des sorties
          </Button>
        </div>
      </div>
    </div>
  );
};
