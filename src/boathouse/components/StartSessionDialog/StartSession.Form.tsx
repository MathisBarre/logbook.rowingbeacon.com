/* eslint-disable @typescript-eslint/no-misused-promises */
import { z } from "zod";
import { useTranslation } from "react-i18next";
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
import { CircleAlertIcon, NotebookIcon, ShieldIcon } from "lucide-react";
import { replaceLastOccurrence } from "../../../_common/utils/string.utils";
import { addMinutes } from "../../../_common/utils/date.utils";
import {
  getBoatTypeLevelConfig,
  getMinimumValidRowersNeeded,
} from "../../../_common/store/boatLevelConfig.rules";
import {
  getSeriousnessTypeTranslation,
  SeriousnessCategoryEnum,
} from "../../../_common/business/seriousness.rules";
import { AgeCategoryEnum } from "../../../_common/business/ageCategory.rules";
import { useBoatLevelConfigStore } from "../../../_common/store/boatLevelConfig.store";
import { BoatTypeEnum } from "../../../_common/business/boat.rules";
import { getBoatNumberOfRowers } from "../../../_common/business/boat.rules";

const StartSessionFormSchema = z.object({
  boat: z.object({
    id: z.string(),
    name: z.string(),
    type: z.nativeEnum(BoatTypeEnum),
    note: z.string().optional(),
    seriousnessCategory: z.nativeEnum(SeriousnessCategoryEnum).nullable(),
    ageCategory: z.nativeEnum(AgeCategoryEnum).nullable(),
  }),
  route: z.object({
    id: z.string(),
    name: z.string(),
  }),
  selectedRowersOptions: z
    .array(z.object({ id: z.string(), name: z.string() }))
    .min(1, { message: "Please select at least one rower" }),
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
      note?: string;
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
  const { t } = useTranslation();
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
              t={t}
              TextContent={() => (
                <>
                  {t("session.alert.rowersProvided")}{" "}
                  <span className="font-medium">
                    {t("session.alert.rowersCount", {
                      count: alert.details.nbOfRowers,
                    })}
                  </span>
                  .
                  <br />{" "}
                  {t("session.alert.boatRequires", {
                    boatName: alert.details.boatName,
                  })}{" "}
                  <span className="font-medium">
                    {t("session.alert.rowersCount", {
                      count: alert.details.boatRowersQuantity,
                    })}
                  </span>
                  .
                  <br /> {t("session.alert.continueAnyway")}
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
              t={t}
              TextContent={() => {
                const alreadyOnSessionRowers =
                  alert.details.alreadyOnSessionRowers;

                if (alreadyOnSessionRowers === null) {
                  return t("session.alert.rowersAlreadyOnSession");
                }

                const plural = alreadyOnSessionRowers.length > 1;
                const rowerNames = plural
                  ? replaceLastOccurrence(
                      alreadyOnSessionRowers
                        .map((rower) => rower.name)
                        .join(", "),
                      ", ",
                      ` ${t("common.and")} `
                    )
                  : alreadyOnSessionRowers[0].name;

                return (
                  <>
                    {t(
                      `session.alert.rowerAlreadyStarted_${
                        plural ? "other" : "one"
                      }`,
                      { rowerNames }
                    )}
                    <br />
                    {t("session.alert.continueAnyway")}
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
              t={t}
              TextContent={() => {
                const nb = alert.details.nbOfInvalidRowers;
                return (
                  <>
                    {t(
                      `session.alert.invalidRowersLevel_${
                        nb === 1 ? "one" : "other"
                      }`,
                      { count: nb }
                    )}
                    <br />
                    {alert.details.whatToDo === "alert" &&
                      t("session.alert.continueAnyway")}
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

            {selectedBoat.note && selectedBoat.note.trim().length > 0 && (
              <div className="text-xs text-steel-blue-900 bg-steel-blue-50 border border-steel-blue-200 rounded p-2 whitespace-pre-wrap">
                <h3 className="font-medium mb-1 flex items-center gap-1">
                  <NotebookIcon className="h-4 w-4 text-steel-blue-800" />
                  {t("session.boatNotes")}
                </h3>
                <p>{selectedBoat.note}</p>
              </div>
            )}

            {(selectedBoat.ageCategory !== null ||
              selectedBoat.seriousnessCategory !== null) && (
              <div className="text-xs text-steel-blue-900 bg-steel-blue-50 border border-steel-blue-200 rounded p-2 whitespace-pre-wrap">
                <h3 className="font-medium mb-1 flex items-center gap-1">
                  <ShieldIcon className="h-4 w-4 text-steel-blue-800" />
                  {t("session.levelRestriction")}
                </h3>
                <p>
                  {t("session.minimumLevelRequired")} &quot;
                  {selectedBoat.ageCategory && `${selectedBoat.ageCategory}`}
                  &quot;
                  {selectedBoat.seriousnessCategory &&
                    ` ${t("common.and")} "${getSeriousnessTypeTranslation(
                      selectedBoat.seriousnessCategory
                    )}" `}
                </p>
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
                {t("session.minimumValidRowersRequired", {
                  count: minimumValidRower,
                })}
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
              {t("common.cancel")}
            </Button>
            <Button type="submit" className="flex-1" loading={isLoading}>
              {t("session.startSession")}
            </Button>
          </div>

          {startSessionError && <ErrorBlock message={startSessionError} />}
        </form>
      </Form>
    </div>
  );
};

const StartSessionAlert = ({
  t,
  TextContent,
  onStartSessionClick,
  onFixSessionClick,
}: {
  t: (key: string) => string;
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
            {t("session.alert.fixInformation")}
          </Button>
          {onStartSessionClick !== null && (
            <Button
              className="w-60"
              type="button"
              variant="outlined"
              color="danger"
              onClick={onStartSessionClick}
            >
              {t("session.startSession")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};
