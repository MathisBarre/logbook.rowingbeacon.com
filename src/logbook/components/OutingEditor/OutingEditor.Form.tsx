/* eslint-disable @typescript-eslint/no-misused-promises */
import { ReactNode, useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { BoatSection } from "../../../boathouse/components/StartSessionDialog/BoatSection";
import { CaptainSection } from "../../../boathouse/components/StartSessionDialog/CaptainSection";
import CommentSection from "../../../boathouse/components/StartSessionDialog/CommentSection";
import { ConfigurationSection } from "../../../boathouse/components/StartSessionDialog/ConfigurationSection";
import { OutingTypeSection } from "../../../boathouse/components/StartSessionDialog/OutingTypeSection";
import RouteSection, {
  getDefaultRoute,
} from "../../../boathouse/components/StartSessionDialog/RouteSection";
import {
  CoxSection,
  CrewOption,
  RowersSection,
} from "../../../boathouse/components/StartSessionDialog/RowersSection";
import StartDatetimeSection from "../../../boathouse/components/StartSessionDialog/StartDatetimeSection";
import { StartSessionAlert } from "../../../boathouse/components/StartSessionDialog/StartSession.Form";
import { getOutingConfiguration } from "../../../boathouse/business/StartSession/StartSession.rules";
import Button from "../../../_common/components/Button";
import { ErrorBlock } from "../../../_common/components/ErrorBlock";
import { Form, FormField } from "../../../_common/components/Form";
import { Label } from "../../../_common/components/Label";
import {
  getDefaultCaptainId,
  getNewGuestName,
} from "../../../_common/business/crew.rules";
import {
  isValidKilometreInput,
  toKilometreInput,
} from "../../../_common/business/distance.rules";
import { DEFAULT_OUTING_TYPE_CODE } from "../../../_common/business/outingType.rules";
import { getBoatWithoutUndefined } from "../../../_common/business/boat.rules";
import { useBoatLevelConfigStore } from "../../../_common/store/boatLevelConfig.store";
import { useClubOverviewStore } from "../../../_common/store/clubOverview.store";
import {
  useModule,
  useModulesStore,
} from "../../../_common/store/modules.store";
import { replaceLastOccurrence } from "../../../_common/utils/string.utils";
import { getCurrentDateTime } from "../../../_common/utils/date.utils";
import type {
  OutingDraft,
  OutingDraftWarning,
  OutingEditorMode,
} from "../../business/EditOuting/outingDraft";
import { useSaveOuting } from "../../business/EditOuting/SaveOuting.usecase";
import {
  EditorErrors,
  OutingEditorValues,
  getErrorPlacement,
  showsCoached,
  showsDistance,
  showsEndDateTime,
  toEditorValues,
  toOutingDraft,
} from "./outingEditor.rules";

interface OutingEditorFormProps {
  mode: OutingEditorMode;
  initialDraft: OutingDraft;
  /** stillOpen is false when the dialog was closed while saving. */
  onSaved: (stillOpen: boolean) => void;
  onCancel: () => void;
}

/**
 * One form for the three ways to write an outing by hand: enter a past
 * outing, correct an ongoing one, correct a finished one.
 */
export const OutingEditorForm = ({
  mode,
  initialDraft,
  onSaved,
  onCancel,
}: OutingEditorFormProps) => {
  const { t } = useTranslation();
  const { saveOuting, isSaving } = useSaveOuting();
  const { getAllBoats, getAllRoutes, getAllRowers, getBoatById, getRouteById } =
    useClubOverviewStore();
  const { getBoatLevelConfig } = useBoatLevelConfigStore();

  const allowGuests = useModule("guests");
  const hasOutingTypes = useModule("outingTypes");
  const hasCaptain = useModule("captain");
  const hasDistances = useModule("distances");
  const captainRequired = useModulesStore((state) => state.captainRequired);

  // An archived boat or route of a stored outing stays selectable as is.
  const storedBoat = initialDraft.boatId
    ? getBoatById(initialDraft.boatId)
    : undefined;
  const boats = [
    ...getAllBoats(),
    ...(storedBoat && mode !== "past" && storedBoat.archivedAt
      ? [storedBoat]
      : []),
  ].map((boat) => {
    const boatLevelConfig = getBoatLevelConfig(boat.id);
    return {
      ...getBoatWithoutUndefined(boat),
      note: boat.note,
      ageCategory: boatLevelConfig?.minimalRowerCategory || null,
      seriousnessCategory: boatLevelConfig?.minimalRowerType || null,
      configurations: boat.configurations,
    };
  });
  const storedRoute = initialDraft.routeId
    ? getRouteById(initialDraft.routeId)
    : undefined;
  const routes = [
    ...getAllRoutes(),
    ...(storedRoute?.archivedAt ? [storedRoute] : []),
  ];
  const rowers = getAllRowers();

  const toCrewOption = (id: string): CrewOption => {
    const guestName = getNewGuestName(id);
    if (guestName !== null) {
      return { id, name: `${guestName} (${t("session.guest")})` };
    }
    const rower = useClubOverviewStore.getState().getRowerById(id);
    if (!rower) {
      return { id, name: id };
    }
    return {
      id,
      name:
        rower.status === "guest"
          ? `${rower.name} (${t("session.guest")})`
          : rower.name,
    };
  };

  // Computed once: new values would reset what the user already typed.
  const [initialValues] = useState<OutingEditorValues>(() => {
    const values = toEditorValues(initialDraft, toCrewOption);
    if (mode !== "past") {
      return values;
    }
    const boat = boats.find((boat) => boat.id === values.boatId);
    const routeDistance = values.routeId
      ? getRouteById(values.routeId)?.distanceM
      : null;
    return {
      ...values,
      boatConfigurationId:
        values.boatConfigurationId ??
        (boat ? (getOutingConfiguration(boat)?.id ?? null) : null),
      distanceKm: values.distanceKm || toKilometreInput(routeDistance),
    };
  });

  const form = useForm<OutingEditorValues>({ defaultValues: initialValues });
  const [errors, setErrors] = useState<EditorErrors>({});
  const [warnings, setWarnings] = useState<OutingDraftWarning[] | null>(null);

  // The form scrolls in its dialog: show the warnings and the errors, which
  // sit at its top, after a save from the buttons at its bottom.
  // Only after a save: clearing an error while typing must not scroll.
  const formRef = useRef<HTMLFormElement>(null);
  const [savesShown, setSavesShown] = useState(0);
  const showSaveOutcome = () => setSavesShown((count) => count + 1);
  useEffect(() => {
    if (savesShown > 0) {
      formRef.current?.scrollIntoView?.({ block: "start" });
    }
  }, [savesShown]);
  const clearError = (field: keyof EditorErrors) =>
    setErrors((current) => ({ ...current, [field]: undefined }));

  const boatId = form.watch("boatId");
  const selectedBoatData = boats.find((boat) => boat.id === boatId);
  const boatConfigurationId = form.watch("boatConfigurationId");
  const selectedConfiguration = selectedBoatData
    ? getOutingConfiguration(selectedBoatData, boatConfigurationId)
    : undefined;
  // A cox already stored stays editable, even in a coxless configuration:
  // editing never erases data.
  const isCoxed =
    Boolean(selectedConfiguration?.coxed) ||
    (mode !== "past" && initialDraft.coxId !== null);

  const selectedRowers = form.watch("rowers");
  const selectedCox = form.watch("cox");
  const routeId = form.watch("routeId");
  const crew = [
    ...selectedRowers.map((rower) => ({ ...rower, role: "rower" as const })),
    ...(isCoxed && selectedCox
      ? [{ ...selectedCox, role: "cox" as const }]
      : []),
  ];
  const crewKey = crew.map((member) => member.id).join(",");

  // Same suggestion as at departure, for an outing that is new. A stored
  // outing keeps its captain, unless that person leaves the crew.
  const captainChoice = useRef<"suggested" | "picked" | "none">(
    mode === "past" ? "suggested" : "picked"
  );
  useEffect(() => {
    if (!hasCaptain) {
      return;
    }
    const captainId = form.getValues("captainId");
    const isCaptainInCrew = crew.some((member) => member.id === captainId);

    if (mode !== "past") {
      if (captainId && !isCaptainInCrew) {
        form.setValue("captainId", null);
      }
      return;
    }
    if (captainChoice.current === "none") {
      return;
    }
    if (captainChoice.current === "picked" && isCaptainInCrew) {
      return;
    }
    // The picked captain left the crew: back to suggestions.
    captainChoice.current = "suggested";
    const rowersById = new Map(rowers.map((rower) => [rower.id, rower]));
    form.setValue(
      "captainId",
      getDefaultCaptainId(
        crew.map((member) => ({ ...rowersById.get(member.id), ...member })),
        new Date()
      )
    );
  }, [crewKey, hasCaptain]);

  const onRouteChange = (newRouteId: string | null) => {
    // Like at the end of an outing: the route distance fills an empty field.
    if (mode === "past" && hasDistances) {
      const previousDistance = toKilometreInput(
        routeId ? getRouteById(routeId)?.distanceM : null
      );
      const current = form.getValues("distanceKm");
      if (current.trim() === "" || current === previousDistance) {
        form.setValue(
          "distanceKm",
          toKilometreInput(
            newRouteId ? getRouteById(newRouteId)?.distanceM : null
          )
        );
      }
    }
    form.setValue("routeId", newRouteId);
  };

  // A second click while saving must not save the outing twice.
  const isSubmitting = useRef(false);

  // The dialog can be closed while saving: a failure must still be told.
  const isMounted = useRef(true);
  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  const submit = async (acceptWarnings: boolean) => {
    if (isSubmitting.current) return;
    isSubmitting.current = true;
    try {
      setWarnings(null);
      const values = form.getValues();

      const inputErrors: EditorErrors = {};
      if (values.boatId === "") {
        inputErrors.boat = t("outingEditor.boatRequired");
      }
      if (
        showsDistance(mode, hasDistances) &&
        !isValidKilometreInput(values.distanceKm)
      ) {
        inputErrors.distanceKm = t("session.invalidDistance");
      }
      if (mode === "past" && values.coached === "") {
        inputErrors.coached = t("outingEditor.coachedRequired");
      }
      setErrors(inputErrors);
      if (Object.keys(inputErrors).length > 0) {
        showSaveOutcome();
        return;
      }

      const result = await saveOuting({
        mode,
        draft: toOutingDraft(values, initialDraft, {
          mode,
          hasOutingTypes,
          hasCaptain,
          hasDistances,
          isCoxed,
        }),
        acceptWarnings,
      });

      if (result.status === "saved") {
        toast.success(
          t(
            mode === "past"
              ? "outingEditor.pastSaved"
              : "outingEditor.editSaved"
          )
        );
        onSaved(isMounted.current);
        return;
      }
      if (!isMounted.current) {
        toast.error(t("session.notSaved"));
        return;
      }
      if (result.status === "warnings") {
        setWarnings(result.warnings);
        showSaveOutcome();
        return;
      }
      const placement = getErrorPlacement(result.error, mode);
      setErrors({ [placement.field]: t(placement.messageKey) });
      showSaveOutcome();
    } catch (error) {
      console.error("Failed to save the outing", error);
      if (isMounted.current) {
        setErrors({ form: t("session.notSaved") });
        showSaveOutcome();
      } else {
        toast.error(t("session.notSaved"));
      }
    } finally {
      isSubmitting.current = false;
    }
  };

  return (
    <Form {...form}>
      <form
        ref={formRef}
        className="flex flex-col gap-6"
        onSubmit={form.handleSubmit(() => submit(false))}
      >
        {warnings && (
          <StartSessionAlert
            t={t}
            fixLabel={t("outingEditor.fix")}
            confirmLabel={t("outingEditor.saveAnyway")}
            TextContent={() => <WarningsText warnings={warnings} />}
            onStartSessionClick={() => {
              void submit(true);
            }}
            onFixSessionClick={() => setWarnings(null)}
          />
        )}

        <div className="flex gap-6">
          <BoatSection
            boats={boats}
            value={{ id: boatId, name: selectedBoatData?.name ?? "" }}
            ignoreAvailability={mode !== "ongoing"}
            ownBoatId={mode === "ongoing" ? initialDraft.boatId : undefined}
            placeholder={t("session.selectBoat")}
            errorMessage={errors.boat}
            onChange={(boat) => {
              const newBoat = boats.find(
                (candidate) => candidate.id === boat.id
              );
              form.setValue("boatId", boat.id);
              // A new boat starts on its default configuration.
              form.setValue(
                "boatConfigurationId",
                newBoat ? (getOutingConfiguration(newBoat)?.id ?? null) : null
              );
              clearError("boat");
            }}
          />
          <RouteSection
            routes={routes}
            value={
              (routeId ? routes.find((route) => route.id === routeId) : null) ??
              getDefaultRoute(t)
            }
            onChange={(route) =>
              onRouteChange(route.id === "null" ? null : route.id)
            }
          />
        </div>

        {selectedBoatData && (
          <ConfigurationSection
            configurations={selectedBoatData.configurations}
            value={boatConfigurationId ?? selectedConfiguration?.id ?? null}
            onChange={(configurationId) =>
              form.setValue("boatConfigurationId", configurationId)
            }
          />
        )}

        <div className="flex flex-col gap-4">
          <RowersSection
            rowers={rowers}
            values={selectedRowers}
            onChange={(newValue) => {
              form.setValue("rowers", newValue);
              clearError("rowers");
            }}
            errorMessage={errors.rowers}
            seats={selectedConfiguration?.seats}
            allowGuests={allowGuests}
            excluded={isCoxed && selectedCox ? [selectedCox] : []}
          />
          {isCoxed && (
            <CoxSection
              rowers={rowers}
              value={selectedCox}
              onChange={(newValue) => form.setValue("cox", newValue)}
              allowGuests={allowGuests}
              excluded={selectedRowers}
            />
          )}
        </div>

        {(hasOutingTypes || hasCaptain) && (
          <div className="flex gap-6">
            {hasOutingTypes && (
              <FormField
                name="outingTypeCode"
                control={form.control}
                render={({ field }) => (
                  <OutingTypeSection
                    value={field.value ?? DEFAULT_OUTING_TYPE_CODE}
                    onChange={field.onChange}
                  />
                )}
              />
            )}
            {hasCaptain && (
              <FormField
                name="captainId"
                control={form.control}
                render={({ field }) => (
                  <CaptainSection
                    crew={crew}
                    value={field.value}
                    onChange={(captainId) => {
                      captainChoice.current =
                        captainId === null ? "none" : "picked";
                      clearError("captain");
                      field.onChange(captainId);
                    }}
                    isRequired={captainRequired}
                    errorMessage={errors.captain}
                  />
                )}
              />
            )}
          </div>
        )}

        <div className="flex gap-6">
          <FormField
            name="startDateTime"
            control={form.control}
            render={({ field }) => (
              <StartDatetimeSection
                value={field.value}
                onChange={(event) => {
                  clearError("startDateTime");
                  field.onChange(event);
                }}
                errorMessage={errors.startDateTime}
              />
            )}
          />

          {showsEndDateTime(mode) ? (
            <FormField
              name="endDateTime"
              control={form.control}
              render={({ field }) => (
                <div className="flex flex-col gap-1 flex-1">
                  <Label htmlFor="outing-end">{t("session.endDateTime")}</Label>
                  <div className="flex gap-2">
                    <input
                      id="outing-end"
                      className="input min-w-0 flex-1"
                      type="datetime-local"
                      value={field.value}
                      onChange={(event) => {
                        clearError("endDateTime");
                        field.onChange(event);
                      }}
                    />
                    <Button
                      type="button"
                      variant="outlined"
                      className="h-[2.625rem]"
                      onClick={() => {
                        clearError("endDateTime");
                        field.onChange(getCurrentDateTime());
                      }}
                    >
                      {t("session.now")}
                    </Button>
                  </div>
                  {errors.endDateTime && (
                    <p className="form-error">{errors.endDateTime}</p>
                  )}
                </div>
              )}
            />
          ) : (
            <FormField
              name="estimatedEndDateTime"
              control={form.control}
              render={({ field }) => (
                <div className="flex flex-col gap-1 flex-1">
                  <Label htmlFor="outing-expected-return">
                    {t("session.expectedReturn")}
                  </Label>
                  <input
                    id="outing-expected-return"
                    className="input"
                    type="datetime-local"
                    value={field.value}
                    onChange={(event) => {
                      clearError("estimatedEndDateTime");
                      field.onChange(event);
                    }}
                  />
                  {errors.estimatedEndDateTime && (
                    <p className="form-error">{errors.estimatedEndDateTime}</p>
                  )}
                </div>
              )}
            />
          )}
        </div>

        {showsDistance(mode, hasDistances) && (
          <FormField
            name="distanceKm"
            control={form.control}
            render={({ field }) => (
              <div className="flex flex-col gap-1">
                <Label htmlFor="outing-distance">
                  {t("session.distanceKm")}
                </Label>
                <input
                  id="outing-distance"
                  className="input w-40"
                  inputMode="decimal"
                  value={field.value}
                  onChange={(event) => {
                    clearError("distanceKm");
                    field.onChange(event);
                  }}
                />
                {errors.distanceKm && (
                  <p className="form-error">{errors.distanceKm}</p>
                )}
              </div>
            )}
          />
        )}

        <FormField
          name="comment"
          control={form.control}
          render={({ field }) => (
            <CommentSection value={field.value} onChange={field.onChange} />
          )}
        />

        {showsCoached(mode) && (
          <FormField
            name="coached"
            control={form.control}
            render={({ field }) => (
              <div>
                <Label className="flex gap-2 items-center mb-2">
                  {t("session.coachedDuringSession")}
                </Label>
                {(["yes", "no"] as const).map((answer) => (
                  <label
                    key={answer}
                    htmlFor={`coached-${answer}`}
                    className="flex gap-2 items-center"
                  >
                    <input
                      type="radio"
                      name="coached"
                      id={`coached-${answer}`}
                      value={answer}
                      checked={field.value === answer}
                      onChange={() => {
                        clearError("coached");
                        field.onChange(answer);
                      }}
                    />
                    {t(answer === "yes" ? "common.yes" : "common.no")}
                  </label>
                ))}
                {errors.coached && (
                  <p className="form-error mt-1">{errors.coached}</p>
                )}
              </div>
            )}
          />
        )}

        <div className="flex gap-6">
          <Button
            type="button"
            variant="outlined"
            className="flex-1"
            onClick={onCancel}
            disabled={isSaving}
          >
            {t("common.cancel")}
          </Button>
          <Button type="submit" className="flex-1" loading={isSaving}>
            {t(
              mode === "past"
                ? "outingEditor.savePast"
                : "outingEditor.saveEdit"
            )}
          </Button>
        </div>

        {errors.form && <ErrorBlock message={errors.form} />}
      </form>
    </Form>
  );
};

const WarningsText = ({ warnings }: { warnings: OutingDraftWarning[] }) => {
  const { t } = useTranslation();

  const joinNames = (names: string[]) =>
    names.length > 1
      ? replaceLastOccurrence(names.join(", "), ", ", ` ${t("common.and")} `)
      : (names[0] ?? "");

  const lines: ReactNode[] = warnings.map((warning) => {
    switch (warning.code) {
      case "BAD_AMOUNT_OF_ROWERS":
        return (
          <>
            {t("session.alert.rowersProvided")}{" "}
            <span className="font-medium">
              {t("session.alert.rowersCount", { count: warning.nbOfRowers })}
            </span>
            . {t("session.alert.boatRequires", { boatName: warning.boatName })}{" "}
            <span className="font-medium">
              {t("session.alert.rowersCount", {
                count: warning.boatRowersQuantity,
              })}
            </span>
            .
          </>
        );
      case "BOAT_OVERLAP":
        return t("outingEditor.boatOverlap", { boatName: warning.boatName });
      case "ROWERS_OVERLAP":
        return t("outingEditor.rowersOverlap", {
          count: warning.rowerNames.length,
          rowerNames: joinNames(warning.rowerNames),
        });
    }
  });

  return (
    <>
      {lines.map((line, index) => (
        <span key={index} className="block mb-2">
          {line}
        </span>
      ))}
      {t("session.alert.continueAnyway")}
    </>
  );
};
