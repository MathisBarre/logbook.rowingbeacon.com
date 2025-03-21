/* eslint-disable @typescript-eslint/no-misused-promises */
import { z } from "zod";
import { BoatSection } from "./BoatSection";
import CommentSection from "./CommentSection";
import DurationEstimationSelect from "./DurationEstimationSelect";
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
import { replaceLastOccurrence } from "../../../_common/utils/string.utils";
import { addMinutes } from "../../../_common/utils/date.utils";
import {
  getBoatTypeLevelConfig,
  getMinimumValidRowersNeeded,
} from "../../../_common/store/boatLevelConfig.rules";
import {
  SERIOUSNESS_CATEGORIES,
  SeriousnessCategoryEnum,
} from "../../../_common/business/seriousness.rules";
import { findSeriousnessCategoryOrder } from "../../../_common/business/seriousness.rules";
import { findAgeCategoryOrder } from "../../../_common/business/ageCategory.rules";
import { AGE_CATEGORIES } from "../../../_common/business/ageCategory.rules";
import { AgeCategoryEnum } from "../../../_common/business/ageCategory.rules";
import { LevelVisualizer } from "./LevelVisualizer";
import { useBoatLevelConfigStore } from "../../../_common/store/boatLevelConfig.store";
import { BoatTypeEnum } from "../../../_common/business/boat.rules";
import { getBoatNumberOfRowers } from "../../../_common/business/boat.rules";

const StartSessionFormSchema = z.object({
  boat: z.object({
    id: z.string(),
    name: z.string(),
    type: z.nativeEnum(BoatTypeEnum),
    seriousnessCategory: z.nativeEnum(SeriousnessCategoryEnum).nullable(),
    ageCategory: z.nativeEnum(AgeCategoryEnum).nullable(),
  }),
  route: z.object({
    id: z.string(),
    name: z.string(),
  }),
  selectedRowersOptions: z
    .array(z.object({ id: z.string(), name: z.string() }))
    .min(1, { message: "Veuillez sélectionner au moins un rameur" }),
  startDateTime: dateStringSchema,
  durationValue: z.enum([
    "na",
    "15",
    "30",
    "45",
    "60",
    "75",
    "90",
    "105",
    "120",
    "135",
    "150",
    "165",
    "180",
  ]),
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
      type: BoatTypeEnum;
      seriousnessCategory: SeriousnessCategoryEnum | null;
      ageCategory: AgeCategoryEnum | null;
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

  const {
    startSession,
    startSessionError,
    acceptBadAmountOfRowers,
    fixInputs,
    alert,
    acceptToHaveSameRowersAlreadyOnStartedSession,
    acceptToHaveInvalidRowersLevel,
  } = useStartSession(onSessionStarted);

  const formatValuesForSubmission = (values: StartSessionFormValues) => {
    const durationInMinutes =
      values.durationValue !== "na"
        ? parseInt(values.durationValue)
        : undefined;

    const estimatedEndDatetime = durationInMinutes
      ? addMinutes(new Date(values.startDateTime), durationInMinutes)
      : undefined;

    return {
      boatId: values.boat.id,
      rowersId: values.selectedRowersOptions.map((option) => option.id),
      startDatetime: new Date(values.startDateTime),
      estimatedEndDatetime: estimatedEndDatetime,
      routeId: values.route.id === "null" ? null : values.route.id,
      comment: values.comment,
    };
  };

  const { boatTypeLevelConfigs } = useBoatLevelConfigStore();

  const selectedBoat = form.watch("boat");
  const blockFromXRowers = getBoatTypeLevelConfig(
    selectedBoat.type || BoatTypeEnum.OTHER,
    boatTypeLevelConfigs
  ).blockFrom;
  const numberOfRowers = getBoatNumberOfRowers(selectedBoat.type);
  const minimumValidRower = getMinimumValidRowersNeeded(
    blockFromXRowers,
    numberOfRowers
  );

  return (
    <div>
      <Form {...form}>
        <form
          className="flex flex-col gap-6"
          onSubmit={form.handleSubmit(async (values) => {
            await startSession(formatValuesForSubmission(values));
          })}
        >
          {alert?.code === "BAD_AMOUNT_OF_ROWERS" && (
            <StartSessionAlert
              TextContent={() => (
                <>
                  Vous avez renseigné{" "}
                  <span className="font-medium">
                    {alert.details.nbOfRowers} rameur(s)
                  </span>
                  .
                  <br /> Le bateau &quot;{alert.details.boatName}&quot;
                  nécessite{" "}
                  <span className="font-medium">
                    {alert.details.boatRowersQuantity} rameur(s)
                  </span>
                  .
                  <br /> Souhaitez-vous tout de même continuer ?
                </>
              )}
              onStartSessionClick={() => {
                acceptBadAmountOfRowers(
                  formatValuesForSubmission(form.getValues())
                ).catch(() => {
                  console.error("Failed to accept bad amount of rowers");
                });
              }}
              onFixSessionClick={() => {
                fixInputs();
              }}
            />
          )}

          {alert?.code === "ROWERS_ALREADY_ON_STARTED_SESSION" && (
            <StartSessionAlert
              TextContent={() => {
                const alreadyOnSessionRowers =
                  alert.details.alreadyOnSessionRowers;

                if (alreadyOnSessionRowers === null) {
                  return "Certains rameurs ont déjà commencé une autre sortie. Souhaitez-vous tout de même continuer ?";
                }

                const plural = alreadyOnSessionRowers.length > 1;

                return (
                  <>
                    {plural
                      ? replaceLastOccurrence(
                          alreadyOnSessionRowers
                            .map((rower) => rower.name)
                            .join(", "),
                          ", ",
                          " et "
                        )
                      : alreadyOnSessionRowers[0].name}
                    {plural ? " ont" : " a"} déjà commencé une autre sortie.
                    <br />
                    Souhaitez-vous tout de même continuer ?
                  </>
                );
              }}
              onStartSessionClick={() => {
                acceptToHaveSameRowersAlreadyOnStartedSession(
                  formatValuesForSubmission(form.getValues())
                ).catch(() => {
                  console.error(
                    "Failed to accept to have same rowers already on started session"
                  );
                });
              }}
              onFixSessionClick={() => {
                fixInputs();
              }}
            />
          )}

          {alert?.code === "INVALID_ROWERS_LEVEL" && (
            <StartSessionAlert
              TextContent={() => {
                const nb = alert.details.nbOfInvalidRowers;
                return (
                  <>
                    {nb === 1 ? (
                      <>
                        <span className="font-bold">1</span> rameur n&apos;a pas
                        le niveau requis pour ce bateau.
                      </>
                    ) : (
                      <>
                        <span className="font-bold">{nb}</span> rameurs
                        n&apos;ont pas le niveau requis pour ce bateau.
                      </>
                    )}
                    <br />
                    {alert.details.whatToDo === "alert" &&
                      "Souhaitez-vous tout de même continuer"}
                  </>
                );
              }}
              onStartSessionClick={
                alert.details.whatToDo === "block"
                  ? null
                  : () => {
                      acceptToHaveInvalidRowersLevel(
                        formatValuesForSubmission(form.getValues())
                      ).catch(() => {
                        console.error(
                          "Failed to accept invalid rowers level on started session"
                        );
                      });
                    }
              }
              onFixSessionClick={() => {
                fixInputs();
              }}
            />
          )}

          <div className="flex gap-2 flex-col">
            <div className="flex gap-6">
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

            {(selectedBoat.ageCategory !== null ||
              selectedBoat.seriousnessCategory !== null) && (
              <div className="flex gap-2 flex-1">
                <LevelVisualizer
                  wrapperClassnames="flex-[4]"
                  levels={SERIOUSNESS_CATEGORIES.map((s) => ({
                    label: s.label || "Aucun",
                    order: s.order,
                  }))}
                  selectedLevelOrder={findSeriousnessCategoryOrder(
                    form.watch("boat.seriousnessCategory")
                  )}
                />

                <LevelVisualizer
                  wrapperClassnames="flex-[8]"
                  levels={AGE_CATEGORIES.map((a) => ({
                    label: String(a.category || "Aucun"),
                    order: a.order,
                  }))}
                  selectedLevelOrder={findAgeCategoryOrder(
                    form.watch("boat.ageCategory")
                  )}
                />
              </div>
            )}
          </div>

          <div>
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
            {minimumValidRower > 0 && (
              <p className="text-xs text-gray-500 mt-1">
                Il est nécessaire de sélectionner au moins {minimumValidRower}{" "}
                rameur(s) ayant au moins les niveaux requis pour ce bateau.
              </p>
            )}
          </div>

          <div className="flex gap-6">
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
              name="durationValue"
              control={form.control}
              render={({ field, fieldState }) => (
                <DurationEstimationSelect
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

          <div className="flex gap-6">
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
  TextContent,
  onStartSessionClick,
  onFixSessionClick,
}: {
  TextContent: () => React.ReactNode;
  onStartSessionClick: (() => void) | null;
  onFixSessionClick: () => void;
}) => {
  return (
    <div className="absolute inset-0 bg-white bg-opacity-80 backdrop-blur-sm z-10">
      <div className=" flex justify-center items-center flex-col h-full mx-auto px-16 gap-6">
        <CircleAlertIcon className="h-8 w-8 text-error-700" />
        <p className="text-center max-w-96">
          <TextContent />
        </p>
        <div className="flex gap-2">
          <Button className="w-60" type="button" onClick={onFixSessionClick}>
            Corriger les informations
          </Button>
          {onStartSessionClick !== null && (
            <Button
              className="w-60"
              type="button"
              variant="outlined"
              color="danger"
              onClick={onStartSessionClick}
            >
              Commencer la sortie
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};
