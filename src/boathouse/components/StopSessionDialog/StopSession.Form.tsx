import { z } from "zod";
import {
  useSessionsStore,
  ZustandSession,
} from "../../../_common/store/sessions.store";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormField } from "../../../_common/components/Form";
import Button from "../../../_common/components/Button";
import { Label } from "../../../_common/components/Label";
import CommentSection from "../StartSessionDialog/CommentSection";
import { getCurrentDateTime, isAfter } from "../../../_common/utils/date.utils";

const StopSessionFormSchema = z.object({
  endDateTime: z.string({
    message: "Ce champ est requis",
  }),
  comment: z.string(),
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
  if (!session) {
    return null;
  }

  const form = useForm<StopSessionFormValues>({
    resolver: zodResolver(StopSessionFormSchema),
    defaultValues: {
      endDateTime: undefined,
      comment: session.comment,
    },
  });

  const sessionStore = useSessionsStore();

  return (
    <Form {...form}>
      <form
        className="flex flex-col gap-4"
        onSubmit={form.handleSubmit(({ comment, endDateTime }) => {
          const registeredSession = sessionStore.findOngoingSessionByBoatId(
            session.boat.id
          );

          if (
            registeredSession?.startDateTime &&
            isAfter(
              new Date(registeredSession?.startDateTime),
              new Date(endDateTime)
            )
          ) {
            form.setError("endDateTime", {
              message:
                "La date de fin doit être postérieure à la date de début",
            });
            return;
          }

          sessionStore.stopSession(session.boat.id, {
            endDateTime: endDateTime,
            comment: comment,
          });

          afterSubmit();
        })}
      >
        <div className="flex gap-4 items-end">
          <FormField
            name="endDateTime"
            control={form.control}
            render={({ field, fieldState }) => {
              return (
                <div className="flex flex-col gap-1 flex-1">
                  <Label>Date et heure de la fin</Label>
                  <input
                    className="input"
                    type="datetime-local"
                    value={field.value}
                    onChange={field.onChange}
                  />
                  {fieldState?.error?.message && (
                    <p className="text-xs text-error-600">
                      {fieldState.error.message}
                    </p>
                  )}
                </div>
              );
            }}
          />
          <Button
            type="button"
            variant="outlined"
            className="h-[2.625rem]"
            onClick={() => {
              form.setValue("endDateTime", getCurrentDateTime());
            }}
          >
            Maintenant !
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
        <div className="flex gap-4">
          <Button
            className="flex-1"
            type="button"
            variant="outlined"
            onClick={() => {
              afterCancel();
            }}
          >
            Annuler
          </Button>
          <Button className="flex-1" type="submit">
            Terminer la sortie
          </Button>
        </div>
      </form>
    </Form>
  );
};
