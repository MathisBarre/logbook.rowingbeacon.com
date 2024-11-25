import { z } from "zod";
import { dateStringSchema } from "../../_common/utils/commonSchema";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { FormField } from "../../_common/components/Form";
import Button from "../../_common/components/Button";
import { exportData } from "../../_common/utils/export";
import { Label } from "../../_common/components/Label";
import { addMonths, getDateTime } from "../../_common/utils/date.utils";

const ExportSessionsFormSchema = z.object({
  fromDate: dateStringSchema,
  toDate: dateStringSchema,
  exportDestination: z.string().optional(),
  fileType: z.enum(["ods", "xlsx", "json", "csv"]),
});

type StartSessionFormValues = z.infer<typeof ExportSessionsFormSchema>;

export const ExportSessions = () => {
  const form = useForm<StartSessionFormValues>({
    resolver: zodResolver(ExportSessionsFormSchema),
    defaultValues: {
      fileType: "ods",
      fromDate: getDateTime(addMonths(new Date(), -1)),
      toDate: getDateTime(new Date()),
    },
  });

  const handleSubmit = form.handleSubmit((data) => {
    console.log(data);

    return exportData(
      [
        {
          foo: "bar",
          baz: "qux",
        },
      ],
      "sessions",
      data.fileType
    );
  });

  return (
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
                  Date de début
                  <input className="input" type="date" {...field} />
                </Label>
                {fieldState.error && (
                  <p className="form-error mt-1">{fieldState.error.message}</p>
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
                  Date de fin
                  <input className="input flex-1" type="date" {...field} />
                </Label>

                {fieldState.error && (
                  <p className="form-error mt-1">{fieldState.error.message}</p>
                )}
              </>
            )}
          />
        </div>
      </div>
      <div>
        <FormField
          control={form.control}
          name="exportDestination"
          render={({ field, fieldState }) => (
            <>
              <Label className="flex flex-col gap-1">
                Destination d'exportation
                <input className="input" type="text" {...field} />
              </Label>

              {fieldState.error && (
                <p className="form-error mt-1">{fieldState.error.message}</p>
              )}
            </>
          )}
        />
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
      <Button type="submit">Exporter</Button>
    </form>
  );
};
