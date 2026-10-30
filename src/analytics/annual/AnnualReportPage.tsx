import {
  ReactNode,
  RefObject,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  CheckIcon,
  GlobeAltIcon,
  LockClosedIcon,
  PhotoIcon,
  PresentationChartBarIcon,
  PrinterIcon,
  TableCellsIcon,
} from "@heroicons/react/24/outline";
import { useModulesStore } from "../../_common/store/modules.store";
import { useAnalyticsAdmin } from "../access/useAnalyticsAdmin";
import { ChartView } from "../charts/ChartView";
import { canPrint, printHtml } from "../charts/export/html";
import {
  exportFileName,
  notifyFailed,
  saveDownload,
} from "../charts/export/saveDownload";
import { ErrorState, LoadingState } from "../components/AnalyticsStates";
import { CHART_SVG_SELECTOR } from "../dashboard/chartSvgRef";
import { useAnalyticsQuery } from "../engine/useAnalyticsQuery";
import { resolveParams } from "../params/resolveParams";
import { currentSeason, formatSeason, localNow } from "../params/season";
import {
  ANNUAL_REPORT_SECTIONS,
  annualChapterKey,
  AnnualChapterId,
  AnnualReportSection,
  ANNUAL_CHAPTERS,
  getAnnualReportSections,
} from "../reports/annual";
import { getReports } from "../reports/catalog";
import {
  useAnalyticsHubStore,
  useHubSeason,
} from "../store/analyticsHub.store";
import {
  ANNUAL_LOGO_MAX_BYTES,
  ANNUAL_NOTE_MAX_LENGTH,
  CLUB_NAME_MAX_LENGTH,
  useAnalyticsSettingsStore,
} from "../store/analyticsSettings.store";
import type {
  ChartSpec,
  EngineObjects,
  ParamValue,
  QueryResult,
  ReportDefinition,
} from "../types";
import { useEngineObjects } from "../reportsUi/useReportAvailability";
import { actionButtonClass } from "../reportsUi/UnavailableReport";
import {
  annualDefinitions,
  annualMeta,
  AnnualSectionInput,
  buildAnnualDocument,
  buildAnnualXlsxInput,
  chartSections,
  formatGenerationDate,
  PreparedAnnualReport,
  PreparedAnnualSection,
  prepareAnnualReport,
} from "./annualDocument";
import { buildAnnualHtml, svgForHtml } from "./annualHtml";
import { buildAnnualWorkbook } from "./annualXlsx";

/**
 * Hub tab "Rapport annuel" (plan 1.3): the season's activity report in one
 * click, for a general meeting or a grant file. Public sections only (no
 * names); a section whose report is unavailable is left out. The preview
 * is the paper sheet that prints; its three outputs (print, the HTML page
 * opened in the browser, Excel) are built from the same prepared report.
 */

interface AnnualPlanEntry {
  key: string;
  section: AnnualReportSection;
  report: ReportDefinition;
  paramValues: Record<string, ParamValue>;
  spec: ChartSpec;
}

/** A section's chart with its `limit` applied (top 10). */
const limitedSpec = (spec: ChartSpec, limit: number | undefined): ChartSpec =>
  limit !== undefined && spec.type === "bar" ? { ...spec, limit } : spec;

/**
 * The sections to show for a season: available, public reports only, in
 * the order of plan 1.3. `objects` undefined (still loading) gives [].
 */
export const planAnnualReport = (
  season: number,
  objects: EngineObjects | null | undefined,
  enabledModules: readonly string[]
): AnnualPlanEntry[] => {
  if (objects === undefined) return [];
  // Unknown objects (the engine could not list them): every table counts
  // as present and a missing one shows as that section's error.
  const known: EngineObjects = objects ?? {
    views: [],
    tables: [...new Set(getReports().flatMap((r) => r.requires.tables))],
    missingViews: [],
  };
  return getAnnualReportSections(season, {
    objects: known,
    enabledModules,
  }).flatMap(({ section, report, paramValues }) =>
    // The annual report is public: never a section with names.
    report.visibility !== "public"
      ? []
      : [
          {
            key: `${season}-${ANNUAL_REPORT_SECTIONS.indexOf(section)}-${section.reportId}`,
            section,
            report,
            paramValues,
            spec: limitedSpec(report.chart, section.limit),
          },
        ]
  );
};

interface SectionState {
  status: "loading" | "success" | "error";
  /** The whole result (the annual transforms need it before `limit`). */
  result: QueryResult | null;
  params: Record<string, ParamValue>;
}

const primaryButtonClass =
  "inline-flex min-h-11 items-center gap-2 rounded bg-steel-blue-800 px-4 text-sm font-medium text-white hover:bg-steel-blue-900 disabled:cursor-not-allowed disabled:opacity-50";
const secondaryButtonClass = `${actionButtonClass} disabled:cursor-not-allowed disabled:opacity-50`;
const linkButtonClass =
  "inline-flex min-h-11 items-center gap-2 rounded px-2 text-sm font-medium text-steel-blue-800 underline-offset-2 hover:underline";

const chapterHeadingClass =
  "mt-10 border-b border-steel-blue-200 pb-1 text-xl font-semibold text-steel-blue-950";

/**
 * Runs one section's query and shows it as the sheet prints it: heading,
 * what it shows, key figures or chart (with its table toggle), notes.
 */
const AnnualSection = ({
  entry,
  prepared,
  onState,
  level,
}: {
  entry: AnnualPlanEntry;
  prepared: PreparedAnnualSection | undefined;
  onState: (key: string, state: SectionState) => void;
  level: "h3" | "h4";
}) => {
  const seasonStartMonth = useAnalyticsSettingsStore((s) => s.seasonStartMonth);
  const headingId = useId();
  const resolved = resolveParams(entry.report.params, entry.paramValues, {
    now: localNow(),
    seasonStartMonth,
  });
  const query = useAnalyticsQuery({
    sql: entry.report.sql,
    params: resolved.values,
    exclusive: entry.report.cost === "heavy",
  });
  const status =
    query.status === "success"
      ? "success"
      : query.status === "error"
        ? "error"
        : "loading";
  const result = query.result ?? null;
  const paramsKey = JSON.stringify(resolved.values);
  useEffect(() => {
    onState(entry.key, {
      status,
      result,
      params: JSON.parse(paramsKey) as Record<string, ParamValue>,
    });
  }, [entry.key, status, result, paramsKey, onState]);

  const kind = prepared?.kind ?? "loading";
  if (kind === "omitted") return null;
  const title = prepared?.title ?? "";
  const Heading = level;

  let body: ReactNode;
  if (query.status === "error" && query.error) {
    body = <ErrorState error={query.error} onRetry={query.rerun} />;
  } else if (!prepared || kind === "loading" || !prepared.result) {
    body = (
      <LoadingState
        isSlow={query.isSlow}
        heavy={entry.report.cost === "heavy"}
        onStop={query.cancel}
        height={entry.spec.type === "kpi" ? 96 : (entry.section.height ?? 220)}
      />
    );
  } else if (kind === "goodNews") {
    body = <p className="text-sm text-gray-800">{prepared.emptyText}</p>;
  } else {
    body = (
      <ChartView
        // Named after the section (chart kit `ariaLabel`, when available).
        {...{ ariaLabel: title }}
        spec={prepared.spec}
        result={prepared.result}
        params={prepared.params}
        height={kind === "kpi" ? undefined : (prepared.height ?? 240)}
        mode={kind === "kpi" ? "chart" : undefined}
      />
    );
  }

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-2"
      data-annual-section={entry.section.id}
    >
      <Heading
        id={headingId}
        className={
          level === "h3"
            ? "text-xl font-semibold text-steel-blue-950"
            : "mt-6 text-base font-semibold text-gray-900"
        }
      >
        {title}
      </Heading>
      {prepared?.intro && (
        <p className="text-sm text-gray-600">{prepared.intro}</p>
      )}
      <div className="min-w-0">{body}</div>
      {prepared && prepared.notes.length > 0 && kind !== "loading" && (
        <ul className="flex flex-col gap-0.5 text-xs text-gray-600">
          {prepared.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
    </section>
  );
};

/**
 * Saves a field 800 ms after the last keystroke and on blur; `saved`
 * tells the field to show "Enregistré".
 */
const useAutosave = (
  draft: string,
  persisted: string,
  save: (value: string) => void
) => {
  const [saved, setSaved] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const latest = useRef({ draft, persisted, save });
  latest.current = { draft, persisted, save };
  const flush = useCallback(() => {
    clearTimeout(timer.current);
    const { draft: value, persisted: stored, save: write } = latest.current;
    if (value !== stored) {
      write(value);
      setSaved(true);
    }
  }, []);
  useEffect(() => {
    if (draft === persisted) return;
    setSaved(false);
    timer.current = setTimeout(flush, 800);
    return () => clearTimeout(timer.current);
  }, [draft, persisted, flush]);
  return { saved, flush };
};

const SavedStatus = ({ saved }: { saved: boolean }) => {
  const { t } = useTranslation();
  return (
    <span
      className="inline-flex min-h-4 items-center gap-1 text-xs font-normal text-success-700"
      aria-live="polite"
    >
      {saved && (
        <>
          <CheckIcon className="h-4 w-4" aria-hidden />
          {t("analytics.annual.edit.saved")}
        </>
      )}
    </span>
  );
};

const LOGO_TYPES = new Set(["image/png", "image/jpeg", "image/svg+xml"]);

/** "Logo du club (facultatif)": PNG, JPEG or SVG of 200 KB at most. */
const LogoField = () => {
  const { t } = useTranslation();
  const logo = useAnalyticsSettingsStore((s) => s.annualLogo);
  const inputId = useId();
  const hintId = useId();
  const choose = (file: File | undefined) => {
    if (!file) return;
    if (!LOGO_TYPES.has(file.type)) {
      toast.error(t("analytics.annual.logo.badType"));
      return;
    }
    if (file.size > ANNUAL_LOGO_MAX_BYTES) {
      toast.error(t("analytics.annual.logo.tooLarge"));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const ok =
        typeof reader.result === "string" &&
        useAnalyticsSettingsStore.getState().setAnnualLogo(reader.result);
      if (!ok) toast.error(t("analytics.annual.logo.badType"));
    };
    reader.onerror = () => toast.error(t("analytics.annual.logo.readFailed"));
    reader.readAsDataURL(file);
  };
  return (
    <div className="flex flex-col gap-1 text-sm">
      <span className="font-medium text-gray-800">
        {t("analytics.annual.logo.label")}
      </span>
      <div className="flex flex-wrap items-center gap-2">
        {logo && (
          <img
            src={logo}
            alt=""
            className="h-11 w-auto max-w-[6rem] rounded border border-gray-200 object-contain"
          />
        )}
        <input
          id={inputId}
          type="file"
          accept="image/png,image/jpeg,image/svg+xml"
          className="sr-only"
          aria-describedby={hintId}
          onChange={(event) => {
            choose(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
        <label
          htmlFor={inputId}
          className={`${actionButtonClass} cursor-pointer`}
        >
          <PhotoIcon className="h-5 w-5" aria-hidden />
          {t(
            logo
              ? "analytics.annual.logo.replace"
              : "analytics.annual.logo.choose"
          )}
        </label>
        {logo && (
          <button
            type="button"
            className={linkButtonClass}
            onClick={() =>
              useAnalyticsSettingsStore.getState().setAnnualLogo("")
            }
          >
            {t("analytics.annual.logo.remove")}
          </button>
        )}
      </div>
      <span id={hintId} className="text-xs text-gray-500">
        {t("analytics.annual.logo.hint")}
      </span>
    </div>
  );
};

/** Club name, logo and message of the season (admin), saved as typed. */
const AnnualSettings = ({ season }: { season: number }) => {
  const { t } = useTranslation();
  const seasonStartMonth = useAnalyticsSettingsStore((s) => s.seasonStartMonth);
  const clubName = useAnalyticsSettingsStore((s) => s.annualClubName);
  const savedNote = useAnalyticsSettingsStore(
    (s) => s.annualNotes[String(season)] ?? ""
  );
  const [nameDraft, setNameDraft] = useState(clubName);
  const [noteDraft, setNoteDraft] = useState(savedNote);
  // Follow the store when it changes elsewhere (not after our own save).
  const nameRef = useRef(nameDraft);
  nameRef.current = nameDraft;
  useEffect(() => {
    if (clubName !== nameRef.current) setNameDraft(clubName);
  }, [clubName]);
  const noteRef = useRef(noteDraft);
  noteRef.current = noteDraft;
  useEffect(() => {
    if (savedNote !== noteRef.current) setNoteDraft(savedNote);
  }, [savedNote, season]);

  const name = useAutosave(nameDraft, clubName, (value) =>
    useAnalyticsSettingsStore.getState().setAnnualClubName(value)
  );
  const note = useAutosave(noteDraft, savedNote, (value) =>
    useAnalyticsSettingsStore.getState().setAnnualNote(season, value)
  );
  const nameId = useId();
  const noteId = useId();
  const counterId = useId();

  return (
    <div className="mx-auto grid w-full max-w-[52rem] gap-4 rounded-lg border border-steel-blue-200 bg-white p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1 text-sm">
          <label htmlFor={nameId} className="font-medium text-gray-800">
            {t("analytics.annual.clubName.label")}
          </label>
          <input
            id={nameId}
            type="text"
            className="min-h-11 rounded border border-gray-300 px-3 text-base"
            placeholder={t("analytics.annual.clubName.placeholder")}
            maxLength={CLUB_NAME_MAX_LENGTH}
            value={nameDraft}
            onChange={(event) => setNameDraft(event.target.value)}
            onBlur={() => {
              name.flush();
              const trimmed = nameRef.current.trim();
              if (
                trimmed !== useAnalyticsSettingsStore.getState().annualClubName
              ) {
                useAnalyticsSettingsStore.getState().setAnnualClubName(trimmed);
              }
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") name.flush();
            }}
          />
          <SavedStatus saved={name.saved} />
        </div>
        <LogoField />
      </div>
      <div className="flex flex-col gap-1 text-sm">
        <label htmlFor={noteId} className="font-medium text-gray-800">
          {t("analytics.annual.notes.label", {
            season: formatSeason(season, seasonStartMonth),
          })}
        </label>
        <textarea
          id={noteId}
          className="min-h-[6rem] rounded border border-gray-300 px-3 py-2 text-base"
          placeholder={t("analytics.annual.notes.placeholder")}
          maxLength={ANNUAL_NOTE_MAX_LENGTH}
          rows={6}
          aria-describedby={counterId}
          value={noteDraft}
          onChange={(event) => setNoteDraft(event.target.value)}
          onBlur={note.flush}
        />
        <div className="flex items-center justify-between gap-2">
          <SavedStatus saved={note.saved} />
          <span id={counterId} className="text-xs text-gray-500">
            {t("analytics.annual.notes.length", {
              count: noteDraft.length,
              max: ANNUAL_NOTE_MAX_LENGTH,
            })}
          </span>
        </div>
      </div>
    </div>
  );
};

/** Opens a file of the Downloads folder with the system app (Tauri shell). */
const openInBrowser = async (fileName: string): Promise<boolean> => {
  try {
    const [{ downloadDir, join }, { open }] = await Promise.all([
      import("@tauri-apps/api/path"),
      import("@tauri-apps/plugin-shell"),
    ]);
    await open(await join(await downloadDir(), fileName));
    return true;
  } catch (error) {
    console.warn("⚠️ Could not open the annual report file", error);
    return false;
  }
};

const fullscreenEnabled = () =>
  typeof document !== "undefined" && document.fullscreenEnabled === true;

/** The cover: club, title, season, period and issue date, logo. */
const Cover = ({
  clubName,
  logo,
  seasonLabel,
  meta,
}: {
  clubName: string;
  logo: string;
  seasonLabel: string;
  meta: string;
}) => {
  const { t } = useTranslation();
  return (
    <header
      className={`relative flex flex-col gap-1 border-b-4 border-steel-blue-800 pb-5 ${logo ? "pr-32" : ""}`}
    >
      {logo && (
        <img
          src={logo}
          alt=""
          className="absolute right-0 top-0 h-[18mm] w-auto max-w-[30mm] object-contain"
        />
      )}
      {clubName && (
        <p className="text-sm font-semibold uppercase tracking-wide text-steel-blue-600">
          {clubName}
        </p>
      )}
      <h2 id="annual-title" className="text-3xl font-bold text-steel-blue-950">
        {t("analytics.annual.title")}
      </h2>
      <p className="text-xl font-semibold text-steel-blue-800">{seasonLabel}</p>
      <p className="text-sm text-gray-600">{meta}</p>
    </header>
  );
};

const SheetSkeleton = () => (
  <div className="mt-8 flex flex-col gap-6" aria-busy="true">
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="h-24 animate-pulse rounded-lg bg-gray-100" />
      ))}
    </div>
    <div className="h-56 animate-pulse rounded bg-gray-100" />
    <div className="h-56 animate-pulse rounded bg-gray-100" />
  </div>
);

/** The charts drawn off screen at the A4 column width, for the exports. */
const ExportTwins = ({
  sections,
  rootRef,
}: {
  sections: PreparedAnnualSection[];
  rootRef: RefObject<HTMLDivElement>;
}) => (
  <div
    ref={rootRef}
    aria-hidden="true"
    {...{ inert: "" }}
    style={{ position: "fixed", left: -10000, top: 0, width: 680 }}
  >
    {sections.map((section) =>
      section.result ? (
        <div key={section.key} data-annual-twin={section.key}>
          <ChartView
            spec={section.spec}
            result={section.result}
            params={section.params}
            height={section.exportHeight ?? 240}
            mode="chart"
          />
        </div>
      ) : null
    )}
  </div>
);

export const AnnualReportPage = () => {
  const { t, i18n } = useTranslation();
  const season = useHubSeason();
  const { isUnlocked, unlock } = useAnalyticsAdmin();
  const seasonStartMonth = useAnalyticsSettingsStore((s) => s.seasonStartMonth);
  const clubName = useAnalyticsSettingsStore((s) => s.annualClubName).trim();
  const logo = useAnalyticsSettingsStore((s) => s.annualLogo);
  const notes = useAnalyticsSettingsStore(
    (s) => s.annualNotes[String(season)] ?? ""
  );
  const enabledModules = useModulesStore((s) => s.enabled);
  const objects = useEngineObjects();
  const plan = useMemo(
    () => planAnnualReport(season, objects, enabledModules),
    [season, objects, enabledModules]
  );

  const [states, setStates] = useState<Record<string, SectionState>>({});
  const [exporting, setExporting] = useState<"xlsx" | "html" | "print" | null>(
    null
  );
  const onState = useCallback((key: string, state: SectionState) => {
    setStates((previous) =>
      previous[key]?.status === state.status &&
      previous[key]?.result === state.result &&
      JSON.stringify(previous[key]?.params) === JSON.stringify(state.params)
        ? previous
        : { ...previous, [key]: state }
    );
  }, []);

  const ctx = useMemo(
    () => ({ t, locale: i18n.language, seasonStartMonth }),
    [t, i18n.language, seasonStartMonth]
  );
  const report: PreparedAnnualReport = useMemo(() => {
    const inputs: AnnualSectionInput[] = plan.map((entry) => {
      const state = states[entry.key];
      return {
        key: entry.key,
        id: entry.section.id,
        spec: entry.spec,
        params: state?.params ?? entry.paramValues,
        status: state?.status ?? "loading",
        result: state?.result ?? null,
      };
    });
    return prepareAnnualReport(inputs, ctx, season);
  }, [plan, states, ctx, season]);
  const preparedByKey = useMemo(
    () => new Map(report.sections.map((section) => [section.key, section])),
    [report]
  );
  const { facts } = report;
  const ready = objects !== undefined && report.ready;

  // Status line: progress, then "Rapport prêt" for 3 s.
  const [announceReady, setAnnounceReady] = useState(false);
  const wasReady = useRef(ready);
  useEffect(() => {
    if (ready && !wasReady.current) {
      setAnnounceReady(true);
      const timer = setTimeout(() => setAnnounceReady(false), 3000);
      wasReady.current = ready;
      return () => clearTimeout(timer);
    }
    wasReady.current = ready;
  }, [ready]);
  const status = !ready
    ? plan.length === 0
      ? t("analytics.annual.preparing")
      : t("analytics.annual.preparingCount", {
          done: report.done,
          total: plan.length,
        })
    : announceReady
      ? t("analytics.annual.ready")
      : "";

  // Charts drawn at the A4 column width for the exports.
  const [twins, setTwins] = useState<PreparedAnnualSection[] | null>(null);
  const twinRoot = useRef<HTMLDivElement>(null);
  const twinResolve = useRef<((svgs: Record<string, string>) => void) | null>(
    null
  );
  useEffect(() => {
    if (!twins) return;
    let frames = 0;
    let handle = 0;
    const svgOf = (key: string) =>
      twinRoot.current?.querySelector<SVGSVGElement>(
        `[data-annual-twin="${key}"] ${CHART_SVG_SELECTOR}`
      ) ?? null;
    const tick = () => {
      frames += 1;
      const drawn = twins.every((section) => svgOf(section.key));
      if ((frames >= 2 && drawn) || frames > 30) {
        const svgs: Record<string, string> = {};
        for (const section of twins) {
          const svg = svgOf(section.key);
          if (svg) svgs[section.key] = svgForHtml(svg, section.title);
        }
        twinResolve.current?.(svgs);
        twinResolve.current = null;
        setTwins(null);
        return;
      }
      handle = requestAnimationFrame(tick);
    };
    handle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(handle);
  }, [twins]);
  const drawExportCharts = () =>
    new Promise<Record<string, string>>((resolve) => {
      const sections = chartSections(report);
      if (sections.length === 0) {
        resolve({});
        return;
      }
      twinResolve.current = resolve;
      setTwins(sections);
    });

  const seasonLabel = formatSeason(season, seasonStartMonth);
  const meta = annualMeta(ctx, {
    season,
    partialEnd: facts.partialEnd,
    issuedOn: formatGenerationDate(new Date(), i18n.language),
  });
  const documentInput = {
    season,
    clubName,
    logo,
    notes,
    generatedAt: new Date(),
    report,
  };

  const warnFailed = () => {
    const failed = report.sections.filter((s) => s.kind === "error");
    if (failed.length > 0) {
      toast.warning(
        t("analytics.annual.failedSections", {
          count: failed.length,
          titles: failed.map((s) => s.title).join(", "),
        })
      );
    }
  };

  const buildHtml = async () =>
    buildAnnualHtml(
      buildAnnualDocument(ctx, {
        ...documentInput,
        svgs: await drawExportCharts(),
      })
    );

  const saveAndOpenHtml = async (html: string) => {
    const name = await saveDownload(
      exportFileName(t("analytics.annual.fileSlug"), seasonLabel, "html"),
      html
    );
    const opened = await openInBrowser(name);
    toast.success(
      t(
        opened
          ? "analytics.annual.htmlSaved"
          : "analytics.annual.htmlSavedNotOpened",
        { name }
      )
    );
  };

  const run = async (
    kind: "xlsx" | "html" | "print",
    action: () => Promise<void>
  ) => {
    setExporting(kind);
    try {
      warnFailed();
      await action();
    } catch (error) {
      notifyFailed(error, t);
    } finally {
      setExporting(null);
    }
  };

  const exportXlsx = () =>
    run("xlsx", async () => {
      const data = buildAnnualWorkbook(
        buildAnnualXlsxInput(ctx, documentInput),
        ctx
      );
      const name = await saveDownload(
        exportFileName(t("analytics.annual.fileSlug"), seasonLabel, "xlsx"),
        data
      );
      toast.success(t("analytics.common.export.saved", { name }), {
        action: {
          label: t("analytics.annual.open"),
          onClick: () => void openInBrowser(name),
        },
      });
    });

  const exportHtml = () =>
    run("html", async () => saveAndOpenHtml(await buildHtml()));

  const print = () =>
    run("print", async () => {
      const html = await buildHtml();
      try {
        await printHtml(html);
      } catch (error) {
        console.warn("⚠️ Could not print the annual report", error);
        await saveAndOpenHtml(html);
      }
    });

  // "Présenter": the sheet in full screen, chapter by chapter.
  const sheetRef = useRef<HTMLElement>(null);
  const [presenting, setPresenting] = useState(false);
  useEffect(() => {
    const onChange = () =>
      setPresenting(
        !!sheetRef.current && document.fullscreenElement === sheetRef.current
      );
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  useEffect(() => {
    if (!presenting) return;
    // Every rem-based size of the sheet grows by 25 %, for the back row.
    const root = document.documentElement;
    const previous = root.style.fontSize;
    root.style.fontSize = "125%";
    const onKey = (event: KeyboardEvent) => {
      const forward = event.key === "ArrowRight" || event.key === "PageDown";
      const back = event.key === "ArrowLeft" || event.key === "PageUp";
      const sheet = sheetRef.current;
      if ((!forward && !back) || !sheet) return;
      // Before the hub's tab keys: the arrows turn the pages here.
      event.preventDefault();
      event.stopPropagation();
      const chapters = Array.from(
        sheet.querySelectorAll<HTMLElement>("[data-annual-chapter]")
      ).filter((chapter) => chapter.offsetParent !== null);
      const top = sheet.scrollTop;
      const current = chapters.reduce(
        (best, chapter, index) =>
          chapter.offsetTop - sheet.offsetTop <= top + 8 ? index : best,
        0
      );
      const target = chapters[forward ? current + 1 : current - 1];
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
    };
    window.addEventListener("keydown", onKey, true);
    sheetRef.current?.focus({ preventScroll: true });
    return () => {
      root.style.fontSize = previous;
      window.removeEventListener("keydown", onKey, true);
    };
  }, [presenting]);
  const present = () => {
    void sheetRef.current?.requestFullscreen().catch((error: unknown) => {
      console.warn("⚠️ Could not present the annual report", error);
    });
  };

  const exportDisabled = !ready || exporting !== null || facts.noOutings;
  const isCurrentSeason =
    season === currentSeason(localNow(), seasonStartMonth);
  const showSeasonButton = (
    <button
      type="button"
      className={secondaryButtonClass}
      onClick={() => useAnalyticsHubStore.getState().setSeason(season - 1)}
    >
      {t("analytics.annual.callout.showSeason", {
        season: formatSeason(season - 1, seasonStartMonth),
      })}
    </button>
  );

  const entriesByChapter = (id: AnnualChapterId | null) => {
    const chapter = ANNUAL_CHAPTERS.find((c) => c.id === id);
    return (chapter?.sections ?? []).flatMap((sectionId) =>
      plan.filter((entry) => entry.section.id === sectionId)
    );
  };
  const chapterClass = presenting ? "min-h-screen snap-start py-10" : "";
  const omittedTitles = report.sections
    .filter((section) => section.kind === "omitted")
    .map((section) => section.title);

  const body = (() => {
    if (objects === undefined) return <SheetSkeleton />;
    if (facts.noOutings) {
      return (
        <div className="my-16 flex flex-col items-center gap-4 text-center">
          <p className="text-base text-gray-700">
            {t("analytics.annual.noOutings", { season: seasonLabel })}
          </p>
          {facts.previousHasOutings && showSeasonButton}
        </div>
      );
    }
    return null;
  })();

  const renderChapterSections = (id: AnnualChapterId | null) =>
    entriesByChapter(id).map((entry) => (
      <AnnualSection
        key={entry.key}
        entry={entry}
        prepared={preparedByKey.get(entry.key)}
        onState={onState}
        level={id === null ? "h3" : "h4"}
      />
    ));

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 pb-8">
      <div className="sticky top-0 z-10 -mx-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 bg-gray-100/95 px-2 py-2 backdrop-blur-sm">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3">
          <p className="min-h-5 text-sm text-gray-600" aria-live="polite">
            {status}
          </p>
          {!isUnlocked && (
            <button
              type="button"
              className={`${linkButtonClass} ${clubName ? "" : "underline"}`}
              onClick={() => void unlock()}
            >
              <LockClosedIcon className="h-5 w-5" aria-hidden />
              {t(
                clubName
                  ? "analytics.annual.edit.open"
                  : "analytics.annual.edit.addClubName"
              )}
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {canPrint() && (
            <button
              type="button"
              className={primaryButtonClass}
              disabled={exportDisabled}
              onClick={() => void print()}
            >
              <PrinterIcon className="h-5 w-5" aria-hidden />
              {t("analytics.annual.print")}
            </button>
          )}
          <button
            type="button"
            className={secondaryButtonClass}
            disabled={exportDisabled}
            onClick={() => void exportHtml()}
          >
            <GlobeAltIcon className="h-5 w-5" aria-hidden />
            {t("analytics.annual.exportHtml")}
          </button>
          <button
            type="button"
            className={secondaryButtonClass}
            disabled={exportDisabled}
            onClick={() => void exportXlsx()}
          >
            <TableCellsIcon className="h-5 w-5" aria-hidden />
            {t("analytics.annual.exportXlsx")}
          </button>
          {fullscreenEnabled() && (
            <button
              type="button"
              className={secondaryButtonClass}
              disabled={objects === undefined || facts.noOutings}
              onClick={present}
            >
              <PresentationChartBarIcon className="h-5 w-5" aria-hidden />
              {t("analytics.annual.present")}
            </button>
          )}
        </div>
      </div>

      {isUnlocked && <AnnualSettings season={season} />}

      {isCurrentSeason &&
        facts.partialEnd &&
        facts.previousHasOutings &&
        !facts.noOutings && (
          <div className="mx-auto flex w-full max-w-[52rem] flex-wrap items-center gap-3 rounded border-l-4 border-yellow-500 bg-yellow-50 p-4">
            <p className="flex-1 basis-64 text-sm text-gray-800">
              {t("analytics.annual.callout.partial", {
                season: seasonLabel,
                date: new Intl.DateTimeFormat(i18n.language, {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                  timeZone: "UTC",
                }).format(new Date(`${facts.partialEnd}T00:00:00Z`)),
              })}
            </p>
            {showSeasonButton}
          </div>
        )}

      <article
        ref={sheetRef}
        aria-labelledby="annual-title"
        data-present={presenting ? "" : undefined}
        tabIndex={-1}
        className={`w-full bg-white outline-none ${
          presenting
            ? "h-screen snap-y snap-mandatory overflow-y-auto px-[max(3rem,calc((100vw_-_64rem)/2))] py-10"
            : "mx-auto max-w-[52rem] rounded-sm px-6 py-8 shadow-md ring-1 ring-gray-200 md:px-12 md:py-10"
        }`}
      >
        <div
          data-annual-chapter=""
          className={`flex flex-col gap-6 ${chapterClass}`}
        >
          <Cover
            clubName={clubName}
            logo={logo}
            seasonLabel={t("analytics.common.season.value", {
              label: seasonLabel,
            })}
            meta={meta}
          />
          {notes.trim() && (
            <section className="rounded border-l-4 border-steel-blue-500 bg-steel-blue-50 p-4">
              <h3 className="mb-1 text-base font-semibold text-gray-900">
                {t("analytics.annual.notes.heading")}
              </h3>
              <p className="whitespace-pre-line text-sm text-gray-800">
                {notes}
              </p>
            </section>
          )}
          {body}
          <div className={facts.noOutings ? "hidden" : "contents"}>
            {renderChapterSections(null)}
          </div>
        </div>

        {ANNUAL_CHAPTERS.filter((chapter) => chapter.id !== null).map(
          (chapter) => {
            const entries = entriesByChapter(chapter.id);
            if (entries.length === 0 || !chapter.id) return null;
            const shown = entries.some(
              (entry) => preparedByKey.get(entry.key)?.kind !== "omitted"
            );
            return (
              <div
                key={chapter.id}
                data-annual-chapter=""
                className={
                  !shown || facts.noOutings || objects === undefined
                    ? "hidden"
                    : `flex flex-col gap-2 ${chapterClass}`
                }
              >
                <h3 className={chapterHeadingClass}>
                  {t(annualChapterKey(chapter.id))}
                </h3>
                {renderChapterSections(chapter.id)}
              </div>
            );
          }
        )}

        {ready && !facts.noOutings && omittedTitles.length > 0 && (
          <p className="mt-8 text-xs italic text-gray-500">
            {t("analytics.annual.omitted", {
              titles: omittedTitles.join(", "),
            })}
          </p>
        )}

        <footer className="mt-10 flex flex-col gap-2 border-t border-steel-blue-200 pt-3 text-xs text-gray-600">
          <h3 className="text-sm font-semibold text-gray-700">
            {t("analytics.annual.definitions.title")}
          </h3>
          <ul className="flex list-disc flex-col gap-1 pl-4">
            {annualDefinitions(ctx, facts).map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <p>{t("analytics.annual.footer")}</p>
        </footer>
      </article>

      {twins && <ExportTwins sections={twins} rootRef={twinRoot} />}
    </div>
  );
};
