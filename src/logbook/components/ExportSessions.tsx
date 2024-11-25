import { z } from "zod";
import { dateStringSchema } from "../../_common/utils/commonSchema";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { FormField } from "../../_common/components/Form";

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
    <form>
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
    </form>
  );
};
