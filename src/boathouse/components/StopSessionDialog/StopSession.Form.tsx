import { z } from "zod";
import { useTranslation } from "react-i18next";
import { ZustandSession } from "../../../_common/store/sessions.store";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormField } from "../../../_common/components/Form";
import Button from "../../../_common/components/Button";
import { Label } from "../../../_common/components/Label";
import CommentSection from "../StartSessionDialog/CommentSection";
import { getCurrentDateTime } from "../../../_common/utils/date.utils";
import { useState } from "react";
import { cn, forEnum } from "../../../_common/utils/utils";
import { toast } from "sonner";
import { useGetStopSession } from "../../business/StopSession/StopSession.usecase";

const StopSessionFormSchema = z.object({
  endDateTime: z
    .string({
      message: "This field is required",
    })
    .min(1, {
      message: "This field is required",
    }),
  comment: z.string(),
  incident: z.string().optional(),
  coached: z.enum(["yes", "no"], {
    message: "You must choose an option",
  }),
});

type StopSessionFormValues = z.infer<typeof StopSessionFormSchema>;

export const StopSessionForm = ({
  afterSubmit,
  afterCancel,
  session,
}: {
  afterSubmit: () => void;
  afterCancel: () => void;
  session: ZustandSession | undefined;
}) => {
  const { t } = useTranslation();

  if (!session) {
    return null;
  }

  const form = useForm<StopSessionFormValues>({
    resolver: zodResolver(StopSessionFormSchema),
    defaultValues: {
      endDateTime: "",
      comment: session.comment,
    },
  });

  const [isIncidentOpen, setIsIncidentOpen] = useState(false);

  const stopSession = useGetStopSession();

  const onSubmit = form.handleSubmit(async (formPayload) => {
    const [stopSessionError] = await stopSession.execute({
      sessionId: session.id,
      endDateTime: formPayload.endDateTime,
      comment: formPayload.comment,
      incident: {
        checked: isIncidentOpen,
        message: formPayload.incident,
      },
      coached: formPayload.coached === "yes",
    });

    if (stopSessionError) {
      return forEnum(stopSessionError.code, {
        END_DATE_BEFORE_START_DATE: () => {
          form.setError("endDateTime", {
            message: t("session.endDateMustBeAfterStartDate"),
          });
        },
        FAILED_TO_SAVE_SESSION: () => {
          toast.error(t("session.errorSavingSession"));
        },
        ONGOING_SESSION_NOT_FOUND: () => {
          toast.error(t("session.errorSavingSession"));
        },
      });
    }

    toast.success(t("session.sessionEndedSuccessfully"));

    afterSubmit();
  });

  return (
    <Form {...form}>
      {/* eslint-disable-next-line @typescript-eslint/no-misused-promises */}
      <form className="flex flex-col gap-4" onSubmit={onSubmit}>
        <div className="flex gap-4 items-end">
          <FormField
            name="endDateTime"
            control={form.control}
            render={({ field, fieldState }) => {
              return (
                <div className="flex flex-col gap-1 flex-1">
                  <Label>{t("session.endDateTime")}</Label>
                  <input
                    className="input"
                    type="datetime-local"
                    value={field.value}
                    onChange={field.onChange}
                  />
                  {fieldState?.error?.message && (
                    <p className="form-error">{fieldState.error.message}</p>
                  )}
                </div>
              );
            }}
          />
          <Button
            type="button"
            variant="outlined"
            className={cn(
              "h-[2.625rem]",
              form.formState.errors.endDateTime && "mb-5"
            )}
            onClick={() => {
              form.setValue("endDateTime", getCurrentDateTime());
            }}
          >
            {t("session.now")}
          </Button>
        </div>

        <FormField
          name="comment"
          control={form.control}
          render={({ field }) => {
            return (
              <CommentSection value={field.value} onChange={field.onChange} />
            );
          }}
        />

        <FormField
          name="coached"
          control={form.control}
          render={({ field, fieldState }) => {
            return (
              <div>
                <Label className="flex gap-2 items-center mb-2">
                  {t("session.coachedDuringSession")}
                </Label>
                <label
                  htmlFor="coached-yes"
                  className="flex gap-2 items-center"
                >
                  <input
                    type="radio"
                    name="coached"
                    id="coached-yes"
                    value="yes"
                    onChange={field.onChange}
                  />
                  {t("common.yes")}
                </label>
                <label htmlFor="coached-no" className="flex gap-2 items-center">
                  <input
                    type="radio"
                    name="coached"
                    id="coached-no"
                    value="no"
                    onChange={field.onChange}
                  />
                  {t("common.no")}
                </label>
                {fieldState?.error?.message && (
                  <p className="form-error mt-1">{fieldState.error.message}</p>
                )}
              </div>
            );
          }}
        />

        <FormField
          name="incident"
          control={form.control}
          render={({ field }) => {
            return (
              <label
                htmlFor="incident"
                className={cn(
                  "border p-2 rounded border-gray-300 flex bg-gray-50 flex-col gap-2 text-gray-700 overflow-hidden",
                  isIncidentOpen && "border-gray-400",
                  "focus-within:ring-1 focus-within:ring-steel-blue-500"
                )}
              >
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    name="incident"
                    id="incident"
                    className="rounded-sm mr-2"
                    checked={isIncidentOpen}
                    onChange={(e) => {
                      setIsIncidentOpen(e.target.checked);
                      if (!e.target.checked) {
                        field.onChange("");
                      }
                    }}
                  />
                  {t("session.incidentDuringSession")}
                </div>
                {isIncidentOpen && (
                  <textarea
                    placeholder={t("session.describeIncident")}
                    className="bg-white border-t-gray-600 border-t border-x-0 border-b-0 border-none -mx-2 -mb-2 focus:ring-0 sele"
                    name="incident"
                    id="incident"
                    rows={3}
                    value={field.value}
                    onChange={field.onChange}
                  />
                )}
              </label>
            );
          }}
        />

        <div className="flex gap-4">
          <Button
            className="flex-1"
            type="button"
            variant="outlined"
            onClick={() => {
              afterCancel();
            }}
          >
            {t("common.cancel")}
          </Button>
          <Button className="flex-1" type="submit">
            {t("session.stopSession")}
          </Button>
        </div>
      </form>
    </Form>
  );
};
