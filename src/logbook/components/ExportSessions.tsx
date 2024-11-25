import { z } from "zod";
import { dateStringSchema } from "../../_common/utils/commonSchema";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { FormField } from "../../_common/components/Form";
import Button from "../../_common/components/Button";

const ExportSessionsFormSchema = z.object({
  fromDate: dateStringSchema,
  toDate: dateStringSchema,
  exportDestination: z.string(),
  fileType: z.enum(["ods", "xlsx", "json", "csv"]),
});

type StartSessionFormValues = z.infer<typeof ExportSessionsFormSchema>;

export const ExportSessions = () => {
  const form = useForm<StartSessionFormValues>({
    resolver: zodResolver(ExportSessionsFormSchema),
  });

  return (
    <form className="flex flex-col gap-4">
      <div>
        <FormField
          control={form.control}
          name="fromDate"
          render={({ field }) => (
            <label className="flex flex-col">
              Date de début
              <input className="input" type="date" {...field} />
            </label>
          )}
        />
      </div>
      <div>
        <FormField
          control={form.control}
          name="toDate"
          render={({ field }) => (
            <label className="flex flex-col">
              Date de fin
              <input className="input" type="date" {...field} />
            </label>
          )}
        />
      </div>
      <div>
        <FormField
          control={form.control}
          name="exportDestination"
          render={({ field }) => (
            <label className="flex flex-col">
              Destination d'exportation
              <input className="input" type="text" {...field} />
            </label>
          )}
        />
      </div>
      <div>
        <FormField
          control={form.control}
          name="fileType"
          render={({ field }) => (
            <label className="flex flex-col">
              Type de fichier
              <select className="input" {...field}>
                <option value="ods">.ods - OpenDocument</option>
                <option value="xlsx">.xlsx - Excel</option>
                <option value="json">.json - JSON</option>
                <option value="csv">.csv - CSV</option>
              </select>
            </label>
          )}
        />
      </div>
      <Button type="submit">Exporter</Button>
    </form>
  );
};
