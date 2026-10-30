import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  ensureMachineInfo,
  useMachineStore,
} from "../engine/activePerformance";
import {
  MachineInfo,
  memoryFits,
  MIN_QUERY_TIMEOUT_SECONDS,
  PERFORMANCE_CHOICES,
  PERFORMANCE_PROFILES,
  PerformanceChoice,
  PerformanceLimits,
  PerformanceProfile,
  resolvePerformance,
} from "../engine/performance";
import { useAnalyticsSettingsStore } from "../store/analyticsSettings.store";
import {
  buttonClass,
  Disclosure,
  fieldClass,
  Notice,
  Pill,
  RadioCard,
  SettingsCard,
} from "./SettingsControls";

const GIB = 1024 * 1024 * 1024;
const MIB = 1024 * 1024;

const rank = (profile: PerformanceProfile) =>
  PERFORMANCE_PROFILES.indexOf(profile);

/** Bytes in Mo or Go, rounded ("8 Go" for the 7.6 GiB of an 8 GB PC). */
export const formatBytes = (bytes: number, t: TFunction, locale: string) => {
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  return bytes >= GIB
    ? t("analytics.performance.units.gb", {
        value: number.format(Math.round((bytes / GIB) * 2) / 2),
      })
    : t("analytics.performance.units.mb", {
        value: number.format(Math.round(bytes / MIB)),
      });
};

/** "45 s", or "2 min" from a minute on (one decimal at most). */
export const duration = (ms: number, t: TFunction, locale: string) =>
  ms >= 60_000
    ? t("analytics.performance.units.minutes", {
        value: new Intl.NumberFormat(locale, {
          maximumFractionDigits: 1,
        }).format(Math.round(ms / 6_000) / 10),
      })
    : t("analytics.performance.units.seconds", {
        value: new Intl.NumberFormat(locale).format(Math.round(ms / 1000)),
      });

/** "8 Go de mémoire, 8 cœurs : profil Puissant conseillé." */
export const machineSentence = (
  machine: MachineInfo,
  t: TFunction,
  locale: string
) => {
  const profile = t(
    `analytics.performance.profiles.${machine.recommended}.name`
  );
  const cpus = machine.logicalCpus;
  if (machine.totalMemoryBytes === null) {
    return t("analytics.performance.machineUnknownMemory", {
      count: cpus,
      profile,
    });
  }
  return t(
    machine.raspberryPi
      ? "analytics.performance.machinePi"
      : "analytics.performance.machine",
    {
      memory: formatBytes(machine.totalMemoryBytes, t, locale),
      count: cpus,
      profile,
    }
  );
};

/** The resulting limits, in plain words (the "Avancé" section). */
const LimitsList = ({ limits }: { limits: PerformanceLimits }) => {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const number = new Intl.NumberFormat(locale);
  const rows: [string, string][] = [
    ["query", duration(limits.queryTimeoutMs, t, locale)],
    ["report", duration(limits.reportTimeoutMs, t, locale)],
    ["card", duration(limits.cardTimeoutMs, t, locale)],
    ["editorRows", number.format(limits.editorRows)],
    ["maxRows", number.format(limits.maxRows)],
    ["resultSize", formatBytes(limits.resultBytes, t, locale)],
    ["memory", formatBytes(limits.memoryBudgetBytes, t, locale)],
    ["heap", formatBytes(limits.heapLimitBytes, t, locale)],
    ["concurrent", number.format(limits.concurrentQueries)],
    [
      "mcp",
      t("analytics.performance.limits.mcpValue", {
        query: duration(limits.mcpQueryTimeoutMs, t, locale),
        report: duration(limits.mcpReportTimeoutMs, t, locale),
        rows: number.format(limits.mcpMaxRows),
      }),
    ],
  ];
  return (
    <dl className="grid grid-cols-1 sm:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-x-4 gap-y-1 text-sm">
      {rows.map(([key, value]) => (
        <div key={key} className="contents">
          <dt className="text-gray-600">
            {t(`analytics.performance.limits.${key}`)}
          </dt>
          <dd className="font-medium text-gray-900 tabular-nums mb-1 sm:mb-0">
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
};

/** The Explorer's "longest query" override, clamped to the profile. */
const TimeoutOverride = ({ limits }: { limits: PerformanceLimits }) => {
  const { t } = useTranslation();
  const override = useAnalyticsSettingsStore((s) => s.queryTimeoutSeconds);
  const setOverride = useAnalyticsSettingsStore(
    (s) => s.setQueryTimeoutSeconds
  );
  const max = Math.round(limits.maxTimeoutMs / 1000);
  const [draft, setDraft] = useState(override === null ? "" : String(override));
  // "Ramené à 5 s…" for a few seconds after a value was clamped.
  const [clamped, setClamped] = useState<number | null>(null);
  const timer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    []
  );
  useEffect(() => {
    setDraft(override === null ? "" : String(override));
  }, [override]);
  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed === "") {
      setOverride(null);
      return;
    }
    const value = Number(trimmed);
    if (!Number.isFinite(value)) {
      setDraft(override === null ? "" : String(override));
      return;
    }
    const kept = Math.min(Math.max(value, MIN_QUERY_TIMEOUT_SECONDS), max);
    setOverride(kept);
    if (timer.current !== null) window.clearTimeout(timer.current);
    if (kept !== value) {
      setClamped(kept);
      setDraft(String(kept));
      timer.current = window.setTimeout(() => setClamped(null), 4000);
    } else {
      setClamped(null);
    }
  };
  return (
    <div className="flex flex-col gap-1">
      <label
        htmlFor="analytics-query-timeout"
        className="font-medium text-gray-900"
      >
        {t("analytics.performance.override.label")}
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <input
          id="analytics-query-timeout"
          type="number"
          inputMode="numeric"
          min={MIN_QUERY_TIMEOUT_SECONDS}
          max={max}
          step={1}
          value={draft}
          aria-describedby="analytics-query-timeout-help analytics-query-timeout-clamped"
          placeholder={String(Math.round(limits.queryTimeoutMs / 1000))}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") commit();
          }}
          className={fieldClass() + " w-28 px-3"}
        />
        {override !== null && (
          <button
            type="button"
            className={buttonClass("outlined")}
            onClick={() => setOverride(null)}
          >
            {t("analytics.performance.override.reset")}
          </button>
        )}
      </div>
      <p
        id="analytics-query-timeout-clamped"
        role="status"
        className="text-sm text-steel-blue-800 empty:hidden"
      >
        {clamped !== null
          ? t("analytics.performance.override.clamped", {
              value: clamped,
              min: MIN_QUERY_TIMEOUT_SECONDS,
              max,
            })
          : ""}
      </p>
      <p id="analytics-query-timeout-help" className="text-sm text-gray-600">
        {t("analytics.performance.override.help", {
          min: MIN_QUERY_TIMEOUT_SECONDS,
          max,
          default: Math.round(limits.queryTimeoutMs / 1000),
        })}
      </p>
    </div>
  );
};

/**
 * Gestion › Statistiques et IA › Performances: the detected machine, the
 * profile in use and, folded away (almost nobody should change it), the
 * choice of profile (Auto, Économe, Standard, Puissant) and the limits it
 * gives. Rust reads the same setting and clamps every query to it.
 */
export const PerformanceCard = () => {
  const choice = useAnalyticsSettingsStore((s) => s.performanceProfile);
  const status = useMachineStore((s) => s.status);
  const machine = useMachineStore((s) => s.machine);
  useEffect(() => {
    void ensureMachineInfo();
  }, []);
  return (
    <PerformanceSettings machine={machine} status={status} choice={choice} />
  );
};

/** The card's content for a machine and a choice (tests render it). */
export const PerformanceSettings = ({
  machine,
  status,
  choice,
}: {
  machine: MachineInfo | null;
  status: "idle" | "loading" | "ready" | "unavailable";
  choice: PerformanceChoice;
}) => {
  const { t, i18n } = useTranslation();
  const setChoice = useAnalyticsSettingsStore((s) => s.setPerformanceProfile);
  const { profile, limits } = resolvePerformance(choice, machine);
  const [changed, setChanged] = useState(false);

  const recommended = machine?.recommended ?? "economy";
  const recommendedName = t(
    `analytics.performance.profiles.${recommended}.name`
  );
  const profileName = t(`analytics.performance.profiles.${profile}.name`);
  const aboveRecommended =
    machine !== null && rank(profile) > rank(recommended);
  // The highest profile whose memory the machine allows.
  const memoryProfile =
    [...PERFORMANCE_PROFILES]
      .reverse()
      .filter((p) => rank(p) <= rank(profile))
      .find((p) => memoryFits(p, machine?.totalMemoryBytes ?? null)) ??
    "economy";
  const memoryCapped = machine !== null && memoryProfile !== profile;

  const describe = (option: PerformanceChoice) =>
    option === "auto"
      ? t("analytics.performance.choices.auto.description", {
          profile: recommendedName,
        })
      : t(`analytics.performance.profiles.${option}.description`);
  const label = (option: PerformanceChoice) =>
    option === "auto"
      ? t("analytics.performance.choices.auto.name")
      : t(`analytics.performance.profiles.${option}.name`);

  return (
    <SettingsCard
      id="analytics-performance"
      title={t("analytics.performance.title")}
      description={t("analytics.performance.intro")}
    >
      <div className="flex flex-col gap-1">
        <p className="text-sm text-gray-900" role="status">
          {machine
            ? machineSentence(machine, t, i18n.language)
            : status === "unavailable"
              ? t("analytics.performance.machineUnavailable")
              : t("analytics.performance.machineLoading")}
        </p>
        <p className="text-sm font-medium text-gray-900">
          {choice === "auto"
            ? t("analytics.performance.profileInUseAuto", {
                profile: profileName,
              })
            : t("analytics.performance.profileInUse", {
                profile: label(choice),
              })}
        </p>
      </div>
      <Disclosure
        summary={t("analytics.performance.change")}
        defaultOpen={choice !== "auto" || aboveRecommended || memoryCapped}
      >
        <fieldset className="flex flex-col gap-2">
          <legend className="font-medium text-gray-900 mb-2">
            {t("analytics.performance.choiceLabel")}
          </legend>
          {PERFORMANCE_CHOICES.map((option) => (
            <RadioCard
              key={option}
              name="analytics-performance-profile"
              value={option}
              checked={choice === option}
              onChange={() => {
                setChoice(option);
                setChanged(true);
              }}
              title={label(option)}
              description={describe(option)}
              badge={
                option !== "auto" && machine && option === recommended ? (
                  <Pill tone="info">
                    {t("analytics.performance.recommendedBadge")}
                  </Pill>
                ) : null
              }
            />
          ))}
        </fieldset>
        {(machine === null || machine.raspberryPi) && (
          <p className="text-sm text-gray-600">
            {t("analytics.performance.piAdvice")}
          </p>
        )}
        {aboveRecommended && (
          <Notice tone="warning">
            {machine?.raspberryPi
              ? t("analytics.performance.aboveRecommendedPi")
              : t("analytics.performance.aboveRecommended", {
                  profile: recommendedName,
                })}
          </Notice>
        )}
        {memoryCapped && (
          <Notice tone="info">
            {t("analytics.performance.memoryCapped", {
              profile: t(
                `analytics.performance.profiles.${memoryProfile}.name`
              ),
            })}
          </Notice>
        )}
        {changed && (
          <Notice tone="info">{t("analytics.performance.saved")}</Notice>
        )}
        <Disclosure
          summary={t("analytics.performance.advanced", {
            profile: profileName,
          })}
        >
          <LimitsList limits={limits} />
          <TimeoutOverride limits={limits} />
        </Disclosure>
      </Disclosure>
    </SettingsCard>
  );
};
