import { z } from "zod";
import { BoatSection } from "./BoatSection";
import CommentSection from "./CommentSection";
import EndDatetimeSection from "./EndDatetimeSection";
import RouteSection from "./RouteSection";
import { RowersSection } from "./RowersSection";
import StartDatetimeSection from "./StartDatetimeSection";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormField } from "../../../_common/components/Form";
import Button from "../../../_common/components/Button";
import { dateStringSchema } from "../../../_common/utils/commonSchema";
import { ErrorBlock } from "../../../_common/components/ErrorBlock";
import { useStartSession } from "./startSession.hook";
import { CircleAlertIcon } from "lucide-react";

const StartSessionFormSchema = z.object({
  boat: z.object({
    id: z.string(),
    name: z.string(),
    type: z.string().optional(),
  }),
  route: z.object({
    id: z.string(),
    name: z.string(),
  }),
  selectedRowersOptions: z
    .array(z.object({ id: z.string(), name: z.string() }))
    .min(1, { message: "Veuillez sélectionner au moins un rameur" }),
  startDateTime: dateStringSchema,
  estimatedEndDateTime: dateStringSchema,
  comment: z.string(),
});

type StartSessionFormValues = z.infer<typeof StartSessionFormSchema>;

interface StartSessionFormProps {
  startSessionData: {
    routes: {
      id: string;
      name: string;
    }[];
    boats: {
      id: string;
      name: string;
    }[];
    rowers: {
      id: string;
      name: string;
    }[];
  };
  cancelAction: () => void;
  onSessionStarted: () => void;
  values?: StartSessionFormValues;
  isLoading: boolean;
}

export const StartSessionForm = ({
  startSessionData,
  cancelAction,
  values,
  onSessionStarted,
  isLoading,
}: StartSessionFormProps) => {
  const form = useForm<StartSessionFormValues>({
    resolver: zodResolver(StartSessionFormSchema),
    values,
  });

  const { startSession, startSessionError } = useStartSession(onSessionStarted);

  return (
    <div>
      <Form {...form}>
        <form
          className="flex flex-col gap-4"
          onSubmit={form.handleSubmit(async (values) => {
            const startSessionPayload = {
              boatId: values.boat.id,
              rowersId: values.selectedRowersOptions.map((option) => option.id),
              startDatetime: new Date(values.startDateTime),
              estimatedEndDatetime: new Date(values.estimatedEndDateTime),
              routeId: values.route.id,
              comment: values.comment,
            };

            await startSession(startSessionPayload);
          })}
        >
          <StartSessionAlert
            isDisplayed={false}
            textContent={
              <>
                Vous avez renseigné 5 rameur(s)
                <br /> Le bateau "102 Fillipi compétition" n'a que X rameur(s).
                <br /> Souhaitez-vous continuer ?
              </>
            }
            onStartSessionClick={() => {
              console.log("click");
            }}
            onFixSessionClick={() => {
              console.log("click");
            }}
          />

          <div className="flex gap-4">
            <FormField
              name="boat"
              control={form.control}
              render={({ field }) => (
                <BoatSection
                  boats={startSessionData.boats}
                  onChange={field.onChange}
                  value={field.value}
                />
              )}
            />

            <FormField
              name="route"
              control={form.control}
              render={({ field }) => (
                <RouteSection
                  routes={startSessionData.routes}
                  onChange={(newValue) =>
                    field.onChange({ target: { value: newValue } })
                  }
                  value={field.value}
                />
              )}
            />
          </div>

          <FormField
            name="selectedRowersOptions"
            control={form.control}
            render={({ field, fieldState }) => (
              <RowersSection
                rowers={startSessionData.rowers}
                onChange={(newValue) => field.onChange(newValue)}
                values={field.value}
                errorMessage={fieldState.error?.message}
              />
            )}
          />

          <div className="flex gap-4">
            <FormField
              name="startDateTime"
              control={form.control}
              render={({ field, fieldState }) => (
                <StartDatetimeSection
                  value={field.value}
                  onChange={field.onChange}
                  errorMessage={fieldState.error?.message}
                />
              )}
            />

            <FormField
              name="estimatedEndDateTime"
              control={form.control}
              render={({ field, fieldState }) => (
                <EndDatetimeSection
                  value={field.value}
                  onChange={field.onChange}
                  errorMessage={fieldState.error?.message}
                />
              )}
            />
          </div>

          <FormField
            name="comment"
            control={form.control}
            render={({ field }) => (
              <CommentSection value={field.value} onChange={field.onChange} />
            )}
          />

          <div className="flex gap-4">
            <Button
              type="button"
              variant="outlined"
              className="flex-1"
              onClick={cancelAction}
            >
              Annuler
            </Button>
            <Button type="submit" className="flex-1" loading={isLoading}>
              Commencer la sortie
            </Button>
          </div>

          {startSessionError && <ErrorBlock message={startSessionError} />}
        </form>
      </Form>
    </div>
  );
};

const StartSessionAlert = ({
  isDisplayed,
  textContent,
  onStartSessionClick,
  onFixSessionClick,
}: {
  textContent: React.ReactNode;
  isDisplayed: boolean;
  onStartSessionClick: () => void;
  onFixSessionClick: () => void;
}) => {
  if (!isDisplayed) {
    return null;
  }

  return (
    <div className="absolute inset-0 bg-white bg-opacity-80 backdrop-blur-sm z-10">
      <div className=" flex justify-center items-center flex-col h-full mx-auto px-16 gap-4">
        <CircleAlertIcon className="h-8 w-8 text-error-700" />
        <p className="text-center">{textContent}</p>
        <div className="flex gap-2">
          <Button
            className="w-60"
            type="button"
            variant="outlined"
            color="danger"
            onClick={onStartSessionClick}
          >
            Commencer la sortie
          </Button>
          <Button className="w-60" type="button" onClick={onFixSessionClick}>
            Corriger les informations
          </Button>
        </div>
      </div>
    </div>
  );
};
