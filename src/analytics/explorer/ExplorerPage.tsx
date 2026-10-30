import {
  KeyboardEvent,
  lazy,
  ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { toast } from "sonner";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  ArrowPathRoundedSquareIcon,
  BookOpenIcon,
  ClockIcon,
  DocumentDuplicateIcon,
  DocumentPlusIcon,
  EllipsisHorizontalIcon,
  InboxIcon,
  LightBulbIcon,
  PencilSquareIcon,
  PlayIcon,
  QueueListIcon,
  SparklesIcon,
  TrashIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { StopIcon } from "@heroicons/react/20/solid";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../_common/components/Popover";
import { SimpleDialog } from "../../_common/components/SimpleDialog";
import useNavigationStore from "../../_common/store/navigation.store";
import type { ChartSpec } from "../chartSpec";
import type {
  AnalyticsErrorPayload,
  EngineObjects,
  ParamDef,
  ParamValue,
  SavedQuery,
} from "../types";
import { getEngine } from "../engine/engine";
import { useActivePerformance } from "../engine/activePerformance";
import { AnalyticsError, formatAnalyticsError } from "../engine/errors";
import { checkSql } from "../engine/sqlGuard";
import { QueryState, useAnalyticsQuery } from "../engine/useAnalyticsQuery";
import { getDictionary } from "../schema/dictionary";
import { resolveParams } from "../params/resolveParams";
import { formatSeason, localNow } from "../params/season";
import { useAnalyticsSettingsStore } from "../store/analyticsSettings.store";
import {
  useAnalyticsHubStore,
  useHubSeason,
} from "../store/analyticsHub.store";
import { getQuery } from "../repository/analytics.repository";
import { useAnalyticsAdmin } from "../access/useAnalyticsAdmin";
import { requestParametersPage } from "../reportsUi/parametersRequest";
import {
  primaryButtonClass,
  secondaryButtonClass,
} from "../components/AnalyticsStates";
import { AiAssistantPanel } from "../ai/AiAssistantPanel";
import type { AiPanelDraft } from "../ai/useAiAssistant";
import { PinButton, PinSource } from "../dashboard/PinButton";
import { autoChart } from "../charts/autoChart";
import type { ChartViewMode } from "../charts/ChartView";
import type { SqlEditorHandle } from "./SqlEditor";
import { buildCompletionSchema, findReferences } from "./sqlCompletion";
import { errorRange } from "./errorRange";
import { explainSqlError, SqlFix } from "./sqlErrorHelp";
import { tidySql } from "./sqlFormat";
import {
  ExplorerDoc,
  hasUnsavedChanges,
  isUntouchedAiDraft,
  SidebarTab,
  useExplorerStore,
  useHasUnsavedChanges,
} from "./explorer.store";
import { EXAMPLE_QUERIES, ExampleQuery } from "./examples";
import { ParamsEditor } from "./ParamsEditor";
import { RESULT_STATUS_ID, RESULTS_ID, ResultsPanel } from "./ResultsPanel";
import { OriginBadge, SavedQueries } from "./SavedQueries";
import { Proposals } from "./Proposals";
import {
  columnLabel,
  DictionaryInsert,
  DictionaryPanel,
  objectDescription,
  semanticLabel,
} from "./DictionaryPanel";
import { SaveDialogMode, SaveQueryDialog } from "./SaveQueryDialog";
import { useConfirm } from "./ConfirmDialog";
import { ImportedProposal, useProposalsInbox } from "./useProposalsInbox";
import { mcpClientName } from "./mcpClientName";
import {
  formatStoredDate,
  formatStoredDateTime,
  normalizeSearch,
  useQueryList,
} from "./useQueryList";
import {
  acceptProposalFrom,
  appQueryDb,
  archiveSavedQuery,
  countPins,
  duplicateQuery,
  refuseQueryProposal,
  renameQuery,
  restoreArchivedQuery,
  saveDoc,
} from "./queryActions";

/**
 * Hub tab "Explorer" (plan 1.3, level 3, admin only): the AI assistant
 * (one row while a query is open), the title and toolbar of the query,
 * the SQL editor (CodeMirror, lazy), its parameters, the run button, the
 * results with the chart builder, and a side panel with the saved
 * queries, the MCP proposals and the dictionary. Below 1280 px the side
 * panel becomes a drawer opened from a row of buttons (review 57), so the
 * editor gets the width on the boathouse touch screen.
 *
 * A new query shows "Premiers pas" (what the Explorer is, three steps,
 * example cards) instead of empty sections (review 2, 7).
 */

const SqlEditor = lazy(() =>
  import("./SqlEditor").then((m) => ({ default: m.SqlEditor }))
);

const isMac = () =>
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/.test(navigator.platform);

const useMediaQuery = (query: string, initial: boolean) => {
  const [matches, setMatches] = useState(initial);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const media = window.matchMedia(query);
    setMatches(media.matches);
    const onChange = () => setMatches(media.matches);
    media.addEventListener?.("change", onChange);
    return () => media.removeEventListener?.("change", onChange);
  }, [query]);
  return matches;
};

const useCoarsePointer = () => useMediaQuery("(pointer: coarse)", false);
/** Tailwind's xl: the side panel sits beside the editor from there. */
const useWideLayout = () => useMediaQuery("(min-width: 1280px)", true);

/** Views and tables that exist in this database (null until known). */
const useEngineObjects = () => {
  const [objects, setObjects] = useState<EngineObjects | null>(null);
  useEffect(() => {
    let alive = true;
    getEngine()
      .objects()
      .then((value) => alive && setObjects(value))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  return objects;
};

/** Whole seconds since `running` became true (0 when not running). */
const useRunSeconds = (running: boolean) => {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    setSeconds(0);
    if (!running) return;
    // performance.now: elapsed time, unaffected by a clock change.
    const start = performance.now();
    const timer = setInterval(
      () => setSeconds(Math.floor((performance.now() - start) / 1000)),
      1000
    );
    return () => clearInterval(timer);
  }, [running]);
  return seconds;
};

/** "rowing-beacon"-friendly slug of a title, for export file names. */
export const slugOf = (title: string) =>
  normalizeSearch(title)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "requete";

/** Values bound to the engine: "current" seasons follow the hub season. */
export const valuesForRun = (
  params: ParamDef[],
  values: Record<string, ParamValue>,
  hubSeason: number
): Record<string, ParamValue> =>
  Object.fromEntries(
    params.map((def) => {
      const value = values[def.name];
      return [
        def.name,
        def.type === "season" &&
        (value === "current" || value === undefined || value === null)
          ? hubSeason
          : (value ?? null),
      ];
    })
  );

/** Values worth pinning: the ones the user fixed. */
const pinnedValues = (values: Record<string, ParamValue>) =>
  Object.fromEntries(
    Object.entries(values).filter(
      ([, value]) => value !== null && value !== "" && value !== "current"
    )
  );

const toolbarButton = secondaryButtonClass;
const menuItemClass =
  "flex min-h-11 w-full items-center gap-2 rounded px-3 text-left text-sm text-gray-900 hover:bg-steel-blue-50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent";

const viewModeFor = (chart: ChartSpec | null): ChartViewMode =>
  chart && chart.type !== "table" ? "chart" : "table";

const sameChart = (a: ChartSpec | null, b: ChartSpec | null) =>
  JSON.stringify(a) === JSON.stringify(b);

const NO_VALUES: Record<string, ParamValue> = {};
const TABLE: ChartSpec = { type: "table" };

/** Run state of the editor: the engine's, or a check that failed first. */
const useEditorRun = (hubSeason: number) => {
  const run = useExplorerStore((state) => state.run);
  // Rows and time of the performance profile (10 s on Économe), or the
  // club's settings clamped to it.
  const { editorMaxRows: maxRows, queryTimeoutMs: timeoutMs } =
    useActivePerformance();
  const seasonStartMonth = useAnalyticsSettingsStore(
    (state) => state.seasonStartMonth
  );

  const prepared = useMemo(() => {
    if (!run) return null;
    const checked = checkSql(run.sql);
    if (!checked.ok) {
      return { kind: "invalid" as const, error: checked.error, sql: run.sql };
    }
    const resolved = resolveParams(
      run.params,
      valuesForRun(run.params, run.paramValues, hubSeason),
      { now: localNow(), seasonStartMonth }
    );
    const missing = resolved.errors.find((e) => e.code === "required");
    if (missing) {
      const error: AnalyticsErrorPayload = {
        code: "missing_param",
        message: `Missing value for ${missing.name}`,
        object: missing.name,
      };
      return { kind: "invalid" as const, error, sql: run.sql };
    }
    return {
      kind: "ready" as const,
      sql: run.sql,
      params: resolved.values,
      defs: run.params,
    };
  }, [run, hubSeason, seasonStartMonth]);

  const query = useAnalyticsQuery({
    sql: prepared?.kind === "ready" ? prepared.sql : null,
    params: prepared?.kind === "ready" ? prepared.params : {},
    maxRows,
    timeoutMs,
    useCache: false,
    priority: "high",
    // Free SQL: alone in the queue (memory budget, review D, M1).
    exclusive: true,
  });

  // "Exécuter" on the same query and values runs it again.
  const lastNonce = useRef<number | null>(null);
  const lastKey = useRef<string | null>(null);
  const key =
    prepared?.kind === "ready"
      ? JSON.stringify([prepared.sql, prepared.params])
      : null;
  useEffect(() => {
    if (!run || lastNonce.current === run.nonce) return;
    const same = key !== null && lastKey.current === key;
    lastNonce.current = run.nonce;
    lastKey.current = key;
    if (same) query.rerun();
  }, [run?.nonce, key]);

  const state: QueryState = useMemo(
    () =>
      prepared?.kind === "invalid"
        ? {
            status: "error",
            result: null,
            error: new AnalyticsError(prepared.error, {
              sql: prepared.sql,
              timeoutMs,
            }),
            isSlow: false,
          }
        : {
            status: query.status,
            result: query.result,
            error: query.error,
            isSlow: query.isSlow,
          },
    [prepared, query.status, query.result, query.error, query.isSlow]
  );

  return {
    state,
    sql: run?.sql ?? null,
    // Stable while typing, so the memoised results panel does not redraw.
    params: prepared?.kind === "ready" ? prepared.params : NO_VALUES,
    defs: prepared?.kind === "ready" ? prepared.defs : null,
    cancel: query.cancel,
  };
};

const schemaLabels = (t: TFunction) => ({
  columnLabel: (column: string) => columnLabel(t, column),
  objectInfo: (object: Parameters<typeof objectDescription>[1]) =>
    objectDescription(t, object),
  semanticLabel: (semantic: string) => semanticLabel(t, semantic),
  functionInfo: (name: string) =>
    t(`analytics.explorer.functions.${name}`, { defaultValue: "" }) ||
    undefined,
});

interface DialogState {
  mode: SaveDialogMode;
  /** The query renamed (rename mode). */
  query?: SavedQuery;
  /** Told whether the dialog saved ("Enregistrer d'abord"). */
  onDone?: (saved: boolean) => void;
}

const SIDEBAR_TABS: SidebarTab[] = ["queries", "proposals", "dictionary"];
const TAB_ICONS: Record<SidebarTab, typeof QueueListIcon> = {
  queries: QueueListIcon,
  proposals: InboxIcon,
  dictionary: BookOpenIcon,
};

/**
 * The side panel's tabs as a segmented control (review 4): only the hub's
 * tabs are dark. `asTabs`: real ARIA tabs with arrow keys (review 61);
 * otherwise (narrow screens) buttons that open the drawer.
 */
const SidebarTabs = ({
  active,
  proposalCount,
  asTabs,
  onSelect,
}: {
  active: SidebarTab | null;
  proposalCount: number;
  asTabs: boolean;
  onSelect: (tab: SidebarTab) => void;
}) => {
  const { t } = useTranslation();
  const refs = useRef<Partial<Record<SidebarTab, HTMLButtonElement | null>>>(
    {}
  );
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!asTabs || !active) return;
    const index = SIDEBAR_TABS.indexOf(active);
    const next =
      event.key === "ArrowRight"
        ? SIDEBAR_TABS[(index + 1) % SIDEBAR_TABS.length]
        : event.key === "ArrowLeft"
          ? SIDEBAR_TABS[
              (index + SIDEBAR_TABS.length - 1) % SIDEBAR_TABS.length
            ]
          : event.key === "Home"
            ? SIDEBAR_TABS[0]
            : event.key === "End"
              ? SIDEBAR_TABS[SIDEBAR_TABS.length - 1]
              : null;
    if (!next) return;
    event.preventDefault();
    onSelect(next);
    refs.current[next]?.focus();
  };
  return (
    <div
      className="flex w-full rounded border border-steel-blue-200 bg-white p-0.5"
      role={asTabs ? "tablist" : undefined}
      aria-label={t("analytics.explorer.tabs.label")}
    >
      {SIDEBAR_TABS.map((tab) => {
        const selected = asTabs && tab === active;
        const Icon = TAB_ICONS[tab];
        return (
          <button
            key={tab}
            ref={(element) => {
              refs.current[tab] = element;
            }}
            type="button"
            id={asTabs ? `explorer-tab-${tab}` : undefined}
            role={asTabs ? "tab" : undefined}
            aria-selected={asTabs ? selected : undefined}
            aria-controls={asTabs ? "explorer-panel" : undefined}
            aria-haspopup={asTabs ? undefined : "dialog"}
            aria-label={
              tab === "proposals" && proposalCount > 0
                ? t("analytics.explorer.tabs.proposalsCount", {
                    count: proposalCount,
                  })
                : undefined
            }
            tabIndex={asTabs ? (selected ? 0 : -1) : undefined}
            className={
              "inline-flex min-h-11 flex-1 items-center justify-center gap-1 rounded px-2 text-sm " +
              (selected
                ? "bg-steel-blue-100 font-semibold text-steel-blue-900"
                : "font-medium text-steel-blue-800 hover:bg-gray-50")
            }
            onKeyDown={onKeyDown}
            onClick={() => onSelect(tab)}
          >
            {!asTabs && <Icon className="h-5 w-5 flex-none" aria-hidden />}
            {t(`analytics.explorer.tabs.${tab}`)}
            {tab === "proposals" && proposalCount > 0 && (
              <span
                className="ml-1 rounded-full bg-steel-blue-700 px-1.5 text-xs font-medium text-white"
                aria-hidden
              >
                {proposalCount}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
};

/** The side panel below xl: a sheet from the left (review 57). */
const SidebarDrawer = ({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) => {
  const { t } = useTranslation();
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal
        container={
          typeof document !== "undefined"
            ? document.getElementById("dialog-portal-root")
            : undefined
        }
      >
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-gray-900/40" />
        <DialogPrimitive.Content
          className="fixed inset-y-0 left-0 z-50 flex w-[22rem] max-w-[90vw] flex-col gap-3 overflow-y-auto bg-gray-50 p-4 shadow-lg focus:outline-none"
          aria-describedby={undefined}
        >
          <div className="flex items-center justify-between gap-2">
            <DialogPrimitive.Title className="text-base font-semibold text-gray-900">
              {t("analytics.explorer.tabs.panelTitle")}
            </DialogPrimitive.Title>
            <DialogPrimitive.Close
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded text-gray-700 hover:bg-gray-200"
              aria-label={t("analytics.common.actions.close")}
            >
              <XMarkIcon className="h-5 w-5" aria-hidden />
            </DialogPrimitive.Close>
          </div>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
};

/** The query's description under its title, clamped (review 37). */
const Description = ({ text }: { text: string }) => {
  const { t } = useTranslation();
  const ref = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [clamped, setClamped] = useState(false);
  useLayoutEffect(() => {
    setExpanded(false);
  }, [text]);
  useLayoutEffect(() => {
    const element = ref.current;
    if (element && !expanded) {
      setClamped(element.scrollHeight > element.clientHeight + 1);
    }
  }, [text, expanded]);
  return (
    <div className="flex flex-col items-start">
      <p
        ref={ref}
        className={
          "text-sm text-gray-600 whitespace-pre-line break-words " +
          (expanded ? "" : "line-clamp-2")
        }
      >
        {text}
      </p>
      {(clamped || expanded) && (
        <button
          type="button"
          className="min-h-9 text-sm font-medium text-steel-blue-800 hover:underline"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {t(
            expanded
              ? "analytics.explorer.editor.readLess"
              : "analytics.explorer.editor.readMore"
          )}
        </button>
      )}
    </div>
  );
};

/** "Premiers pas" (review 7): what the Explorer is, then examples. */
const FirstSteps = ({
  onExample,
}: {
  onExample: (example: ExampleQuery) => void;
}) => {
  const { t } = useTranslation();
  return (
    <section
      className="flex flex-col gap-3 rounded border border-steel-blue-100 bg-steel-blue-50 p-4"
      aria-labelledby="explorer-first-steps"
    >
      <h3
        id="explorer-first-steps"
        className="text-base font-semibold text-gray-900"
      >
        {t("analytics.explorer.examples.firstStepsTitle")}
      </h3>
      <p className="text-sm text-gray-800">
        {t("analytics.explorer.examples.firstStepsIntro")}
      </p>
      <ol className="ml-5 flex list-decimal flex-col gap-1 text-sm text-gray-800">
        {(["1", "2", "3"] as const).map((step) => (
          <li key={step}>{t(`analytics.explorer.examples.steps.${step}`)}</li>
        ))}
      </ol>
      <h4 className="mt-1 text-sm font-semibold text-gray-900">
        {t("analytics.explorer.examples.listTitle")}
      </h4>
      <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {EXAMPLE_QUERIES.map((example) => (
          <li key={example.id} className="flex">
            <button
              type="button"
              className="flex min-h-11 w-full flex-col gap-0.5 rounded border border-steel-blue-200 bg-white px-3 py-2 text-left hover:border-steel-blue-400 hover:bg-steel-blue-50"
              onClick={() => onExample(example)}
            >
              <span className="text-sm font-medium text-steel-blue-900">
                {t(`analytics.explorer.examples.items.${example.id}`)}
              </span>
              <span className="text-xs text-gray-600">
                {t(`analytics.explorer.examples.descriptions.${example.id}`)}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <p className="flex items-start gap-2 text-sm text-gray-700">
        <SparklesIcon
          className="h-5 w-5 flex-none text-steel-blue-700"
          aria-hidden
        />
        {t("analytics.explorer.examples.aiHint")}
      </p>
    </section>
  );
};

export const ExplorerPage = () => {
  const { t, i18n } = useTranslation();
  const doc = useExplorerStore((state) => state.doc);
  const paramValues = useExplorerStore((state) => state.paramValues);
  const sidebarTab = useExplorerStore((state) => state.sidebarTab);
  const sidebarTabChosen = useExplorerStore((state) => state.sidebarTabChosen);
  const history = useExplorerStore((state) => state.history);
  const store = useExplorerStore.getState;
  const unsaved = useHasUnsavedChanges();
  const hubSeason = useHubSeason();
  const seasonStartMonth = useAnalyticsSettingsStore(
    (state) => state.seasonStartMonth
  );
  const mcpEnabled = useAnalyticsSettingsStore((state) => state.mcpEnabled);
  const coarse = useCoarsePointer();
  const wide = useWideLayout();
  const objects = useEngineObjects();
  const editorRef = useRef<SqlEditorHandle>(null);
  const { unlock } = useAnalyticsAdmin();
  const { confirm, dialog: confirmDialog } = useConfirm();

  const [mode, setMode] = useState<ChartViewMode>(() => viewModeFor(doc.chart));
  const [builderOpen, setBuilderOpen] = useState(false);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [examplesOpen, setExamplesOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const showTab = useCallback((tab: SidebarTab) => {
    store().showSidebarTab(tab);
    if (!window.matchMedia?.("(min-width: 1280px)").matches) {
      setDrawerOpen(true);
    }
  }, []);

  const bump = () => store().bumpQueries();
  const saved = useQueryList("saved");
  const archived = useQueryList("saved", { archived: true });
  const proposals = useQueryList("proposed");
  const onImported = (_ids: string[], imported: ImportedProposal[]) => {
    bump();
    const first = imported[0];
    if (!first) return;
    toast.info(
      imported.length === 1
        ? t("analytics.explorer.proposals.newOne", {
            client:
              mcpClientName(first.client) ?? t("analytics.explorer.origin.mcp"),
            title: first.title,
          })
        : t("analytics.explorer.proposals.newMany", {
            count: imported.length,
          }),
      {
        action: {
          label: t("analytics.explorer.proposals.view"),
          onClick: () => showTab("proposals"),
        },
      }
    );
  };
  const inbox = useProposalsInbox({ onImported });

  // A club without saved queries starts on the Dictionary (review 10).
  const firstRunDone = useRef(false);
  useEffect(() => {
    if (firstRunDone.current || saved.queries === null) return;
    firstRunDone.current = true;
    if (saved.queries.length === 0 && !sidebarTabChosen) {
      store().showSidebarTab("dictionary");
    }
  }, [saved.queries, sidebarTabChosen]);

  const runState = useEditorRun(hubSeason);
  const { state } = runState;
  const loading = state.status === "loading";
  const runSeconds = useRunSeconds(loading);

  const schema = useMemo(
    () =>
      buildCompletionSchema(getDictionary().objects, objects, schemaLabels(t)),
    [objects, t, i18n.language]
  );

  const errorPlace = useMemo(
    () =>
      state.error && runState.sql !== null
        ? errorRange(state.error, runState.sql)
        : null,
    [state.error, runState.sql]
  );
  const errorHelp = useMemo(
    () =>
      state.error && runState.sql !== null
        ? explainSqlError(state.error, runState.sql, schema, t, i18n.language)
        : null,
    [state.error, runState.sql, schema, t, i18n.language]
  );
  const editorError = useMemo(() => {
    if (!state.error || runState.sql === null || !errorHelp) return null;
    // A refused write is not a mistake in the SQL: the live warning on its
    // first word already says why, no red mark on top of it.
    if (errorHelp.tone === "info") return null;
    const range = errorHelp.range ?? errorPlace;
    return range
      ? {
          from: range.from,
          to: range.to,
          message: errorHelp.message,
          sql: runState.sql,
        }
      : null;
  }, [errorHelp, errorPlace, state.error, runState.sql]);

  const fallbackChart = useMemo<ChartSpec>(
    () =>
      state.result
        ? autoChart(state.result.columns, state.result.rows)
        : { type: "table" },
    [state.result]
  );
  /**
   * The chart that a save or a pin keeps: what is shown (review 31), the
   * table when "Voir le tableau" is on.
   */
  const effectiveChart: ChartSpec | null =
    mode === "table"
      ? TABLE
      : (doc.chart ?? (state.result ? fallbackChart : null));

  const hasSql = doc.sql.trim() !== "";
  const stale = runState.sql !== null && doc.sql.trim() !== runState.sql.trim();

  // ─── Leaving the current query ─────────────────────────────────────────

  /** Saves the open doc for "Enregistrer d'abord"; true once saved. */
  const saveBeforeLeaving = async (): Promise<boolean> => {
    const current = store().doc;
    if (current.queryId && current.title.trim()) {
      return persist(
        { title: current.title, description: current.description },
        false
      );
    }
    return new Promise<boolean>((resolve) =>
      setDialog({ mode: "save", onDone: resolve })
    );
  };

  const confirmLeave = async () => {
    const { doc: current, baseline } = store();
    if (!hasUnsavedChanges(current, baseline)) return true;
    const outcome = await confirm({
      title: t("analytics.explorer.unsavedTitle"),
      message: t("analytics.explorer.unsaved"),
      confirmLabel: t("analytics.explorer.confirm.continueWithoutSaving"),
      extraLabel: t("analytics.explorer.confirm.saveFirst"),
    });
    if (outcome === "confirm") return true;
    if (outcome === "extra") return saveBeforeLeaving();
    return false;
  };

  const afterOpen = (chart: ChartSpec | null, run = true) => {
    setMode(viewModeFor(chart));
    setBuilderOpen(false);
    if (run && store().doc.sql.trim()) store().requestRun();
  };

  const openQuery = async (query: SavedQuery) => {
    setDrawerOpen(false);
    if (query.id === store().doc.queryId) {
      afterOpen(store().doc.chart);
      return;
    }
    if (!(await confirmLeave())) return;
    store().openQuery(query);
    afterOpen(query.chart);
  };

  const openExample = async (example: ExampleQuery) => {
    setExamplesOpen(false);
    if (!(await confirmLeave())) return;
    store().openDraft({
      title: t(`analytics.explorer.examples.items.${example.id}`),
      sql: example.sql,
      params: example.params,
      chart: example.chart,
    });
    afterOpen(example.chart);
  };

  const newQuery = async () => {
    if (!(await confirmLeave())) return;
    store().newDoc();
    afterOpen(null, false);
    editorRef.current?.focus();
  };

  // An answer that follows an untouched AI answer ("Affiner", a reply to a
  // question) replaces it without asking. Declined, the answer card offers
  // "Charger dans l'éditeur". An unverified draft (its query failed) is
  // loaded to be fixed, not run.
  const onAiAnswer = (draft: AiPanelDraft) => {
    void (async () => {
      if (!isUntouchedAiDraft(store()) && !(await confirmLeave())) return;
      store().openAiDraft(draft, t("analytics.ai.answer.assumptions"));
      afterOpen(draft.chart, !draft.unverified);
    })();
  };

  /** The AI panel's "Voir le résultat" (AI review 13). */
  const showResult = useCallback(() => {
    const status = document.getElementById(RESULT_STATUS_ID);
    const target = status ?? document.getElementById(RESULTS_ID);
    target?.scrollIntoView({ block: "start", behavior: "smooth" });
    status?.focus({ preventScroll: true });
  }, []);

  /** The AI panel's "Choisir :boat" (AI review 18). */
  const focusParam = useCallback((name: string) => {
    const cell = document.querySelector<HTMLElement>(
      `[data-param="${CSS.escape(name)}"]`
    );
    if (!cell) return;
    cell.scrollIntoView({ block: "center", behavior: "smooth" });
    cell
      .querySelector<HTMLElement>("input, select, button, [tabindex]")
      ?.focus({ preventScroll: true });
  }, []);

  // "Voir la requête SQL" from a report, or "Ouvrir" on a dashboard card
  // of a saved query: taken once, also when it arrives while mounted.
  const pendingDraft = useAnalyticsHubStore((state) => state.pendingDraft);
  useEffect(() => {
    if (!pendingDraft) return;
    const draft = useAnalyticsHubStore.getState().takePendingDraft();
    if (!draft) return;
    void (async () => {
      const queryId = draft.queryId;
      const query = queryId
        ? await appQueryDb
            .read((client) => getQuery(client, queryId))
            .catch(() => null)
        : null;
      if (query && !query.archivedAt && query.id === store().doc.queryId) {
        store().setParamValues(draft.paramValues ?? {});
        afterOpen(store().doc.chart);
        return;
      }
      if (!(await confirmLeave())) return;
      if (query && !query.archivedAt) {
        store().openQuery(query);
        store().setParamValues(draft.paramValues ?? {});
        afterOpen(query.chart);
      } else {
        store().openDraft(draft);
        afterOpen(draft.chart ?? null);
      }
    })();
  }, [pendingDraft]);

  // The doc remembered on this workstation may point to a query archived
  // since (or by another workstation): then it becomes a new query.
  useEffect(() => {
    const id = store().doc.queryId;
    if (!id) return;
    appQueryDb
      .read((client) => getQuery(client, id))
      .then((query) => {
        if (!query || query.archivedAt) store().detachQuery(id);
      })
      .catch(() => undefined);
  }, []);

  // ─── Saving ────────────────────────────────────────────────────────────

  const persist = async (
    meta: { title: string; description: string | null },
    asNew: boolean
  ) => {
    const current: ExplorerDoc = { ...store().doc, chart: effectiveChart };
    const query = await saveDoc(current, { ...meta, asNew });
    if (!query) return false;
    store().markSaved(query);
    bump();
    toast.success(
      t("analytics.explorer.saveDialog.saved", { title: query.title })
    );
    return true;
  };

  const save = () => {
    const current = store().doc;
    if (!current.sql.trim()) return;
    if (current.queryId && current.title.trim()) {
      void persist(
        { title: current.title, description: current.description },
        false
      );
    } else {
      setDialog({ mode: "save" });
    }
  };

  const closeDialog = (saved: boolean) => {
    dialog?.onDone?.(saved);
    setDialog(null);
  };

  const submitDialog = async (title: string, description: string | null) => {
    if (!dialog) return false;
    if (dialog.mode === "rename" && dialog.query) {
      const query = await renameQuery(dialog.query, { title, description });
      if (!query) return false;
      store().renameOpenQuery(query.id, query.title, query.description);
      bump();
      return true;
    }
    const ok = await persist({ title, description }, dialog.mode === "saveAs");
    if (ok) {
      dialog.onDone?.(true);
      setDialog(null);
    }
    return ok;
  };

  /** "Renommer…" of the open query (review 38): a draft is saved. */
  const renameOpen = async () => {
    setMenuOpen(false);
    const id = store().doc.queryId;
    if (!id) {
      if (store().doc.sql.trim()) setDialog({ mode: "save" });
      return;
    }
    const query =
      saved.queries?.find((item) => item.id === id) ??
      (await appQueryDb
        .read((client) => getQuery(client, id))
        .catch(() => null));
    if (query) setDialog({ mode: "rename", query });
  };

  const duplicate = async (query: SavedQuery) => {
    const copy = await duplicateQuery(
      query,
      t("analytics.explorer.saved.copySuffix")
    );
    if (!copy) return;
    bump();
    toast.success(
      t("analytics.explorer.saveDialog.saved", { title: copy.title })
    );
  };

  const archive = async (query: SavedQuery) => {
    const pins = await countPins(query.id).catch(() => 0);
    const message =
      pins > 0
        ? t("analytics.explorer.saved.archivePinned", {
            count: pins,
            title: query.title,
          })
        : t("analytics.explorer.saved.archiveConfirm", { title: query.title });
    const outcome = await confirm({
      message,
      confirmLabel: t("analytics.explorer.saved.archive"),
    });
    if (outcome !== "confirm") return;
    if (!(await archiveSavedQuery(query.id))) return;
    store().detachQuery(query.id);
    bump();
  };

  const restore = async (query: SavedQuery) => {
    if (!(await restoreArchivedQuery(query.id))) return;
    bump();
    toast.success(
      t("analytics.explorer.saved.restored", { title: query.title })
    );
  };

  // ─── Proposals ─────────────────────────────────────────────────────────

  const examine = async (query: SavedQuery) => {
    await openQuery(query);
  };

  const accept = async (query: SavedQuery) => {
    const { doc: current, baseline } = store();
    // The open proposal is accepted as edited in the editor.
    const outcome = await acceptProposalFrom(query, {
      doc: current,
      baseline,
    });
    if (outcome === false) return;
    if (outcome === true) store().markAccepted(query.id);
    else store().markSaved(outcome);
    bump();
    // The accepted query is now in "Requêtes" (review 44).
    store().showSidebarTab("queries");
    const title = typeof outcome === "object" ? outcome.title : query.title;
    toast.success(t("analytics.explorer.proposals.accepted", { title }));
    setTimeout(() => {
      document
        .querySelector(`[data-query-id="${CSS.escape(query.id)}"]`)
        ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }, 300);
  };

  const refuse = async (query: SavedQuery) => {
    const outcome = await confirm({
      message: t("analytics.explorer.proposals.refuseConfirm", {
        title: query.title,
      }),
      confirmLabel: t("analytics.explorer.proposals.refuseAction"),
      danger: true,
    });
    if (outcome !== "confirm") return;
    // The inbox file goes too, or the next poll would bring it back.
    await inbox.forget(query.id);
    if (!(await refuseQueryProposal(query.id))) return;
    store().detachQuery(query.id);
    bump();
  };

  // ─── Editor actions ────────────────────────────────────────────────────

  // "Vider l'éditeur": no Ctrl+Z on a touch screen, so ask first.
  const clearSql = async () => {
    setMenuOpen(false);
    const outcome = await confirm({
      message: t("analytics.explorer.editor.clearConfirm"),
      confirmLabel: t("analytics.explorer.editor.clear"),
      danger: true,
    });
    if (outcome !== "confirm") return;
    store().setSql("");
    editorRef.current?.focus();
  };

  const tidy = () => {
    setMenuOpen(false);
    const sql = store().doc.sql;
    const next = tidySql(sql);
    if (next !== sql) store().setSql(next);
  };

  const openHistoryEntry = async (sql: string) => {
    setHistoryOpen(false);
    if (!(await confirmLeave())) return;
    // A past run opens as a new draft: it never overwrites the open query.
    store().openDraft({ title: "", sql, params: [] });
    afterOpen(null, false);
  };

  const clearHistory = async () => {
    const outcome = await confirm({
      message: t("analytics.explorer.history.clearConfirm"),
      confirmLabel: t("analytics.explorer.history.clear"),
      danger: true,
    });
    if (outcome === "confirm") store().clearHistory();
  };

  const onDictionaryInsert = (insert: DictionaryInsert) => {
    const sql = store().doc.sql;
    if (!sql.trim()) {
      // An empty editor gets a whole query to start from (review 51).
      store().setSql(
        insert.kind === "column"
          ? `SELECT ${insert.column}\nFROM ${insert.object}\n`
          : insert.kind === "filter"
            ? `SELECT *\nFROM ${insert.object}\nWHERE ${insert.sql}\n`
            : `SELECT *\nFROM ${insert.object}\n`
      );
      return;
    }
    if (insert.kind === "column") {
      editorRef.current?.insertText(insert.column, "column");
      const refs = findReferences(sql);
      const named = [...refs.objects.map((ref) => ref.name), ...refs.ctes];
      if (
        !named.some(
          (name) => name.toLowerCase() === insert.object.toLowerCase()
        )
      ) {
        toast.info(
          t("analytics.explorer.dictionary.addFrom", { object: insert.object })
        );
      }
    } else if (insert.kind === "filter") {
      editorRef.current?.insertText(insert.sql, "filter");
    } else {
      editorRef.current?.insertText(insert.object, "object");
    }
  };

  const previewObject = async (name: string) => {
    setDrawerOpen(false);
    if (!(await confirmLeave())) return;
    store().openDraft({
      title: t("analytics.explorer.dictionary.previewTitle", { name }),
      sql: `SELECT *\nFROM ${name}\nLIMIT 50`,
      params: [],
    });
    afterOpen(null);
  };

  // Stable callbacks for the memoised results panel.
  const onChartChange = useCallback(
    (chart: ChartSpec) => store().setChart(chart),
    []
  );
  const onRetry = useCallback(() => store().requestRun(), []);
  const longSql = (runState.sql ?? "").split("\n").length > 3;
  const goToRange = errorHelp?.range ?? errorPlace;
  const onGoToError = useMemo(
    () =>
      goToRange && longSql
        ? () => editorRef.current?.select(goToRange.from, goToRange.to)
        : null,
    [goToRange?.from, goToRange?.to, longSql]
  );
  const onApplyFix = useCallback((fix: SqlFix) => {
    const { from, to, text } = fix.replace;
    if (editorRef.current) {
      editorRef.current.replaceRange(from, to, text);
    } else {
      const sql = store().doc.sql;
      store().setSql(sql.slice(0, from) + text + sql.slice(to));
    }
    store().requestRun();
  }, []);
  const onChangeProfile = useCallback(() => {
    void unlock().then((granted) => {
      if (!granted) return;
      requestParametersPage("analytics", "performance");
      useNavigationStore.getState().setPage("parameters");
    });
  }, [unlock]);

  /** "Saison 2024-2025" when the result is bound to a season (review 19). */
  const seasonLabel = useMemo(() => {
    const def = runState.defs?.find((d) => d.type === "season");
    const value = def ? runState.params[def.name] : null;
    return typeof value === "number"
      ? t("analytics.explorer.results.season", {
          label: formatSeason(value, seasonStartMonth),
        })
      : null;
  }, [runState.defs, runState.params, seasonStartMonth, t]);

  /** Parameters behave like report filters: a change runs again (20). */
  const onParamValuesChange = (values: Record<string, ParamValue>) => {
    store().setParamValues(values);
    if (
      state.status === "success" &&
      runState.sql !== null &&
      store().doc.sql.trim() === runState.sql.trim()
    ) {
      store().requestRun();
    }
  };

  // Ctrl/Cmd+Enter and Ctrl/Cmd+S outside the editor too (review 16).
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || !(event.ctrlKey || event.metaKey)) return;
    const target = event.target as HTMLElement;
    // The AI question box and the dialogs have their own Enter.
    if (target.closest?.("textarea, [role='dialog']")) return;
    if (event.key === "Enter") {
      if (!store().doc.sql.trim()) return;
      event.preventDefault();
      store().requestRun();
    } else if (event.key.toLowerCase() === "s") {
      event.preventDefault();
      save();
    }
  };

  // ─── Rendering ─────────────────────────────────────────────────────────

  // A saved query with changes (or a proposal) is saved in place first,
  // then the pin dialog opens in the same tap (review 32); a never-saved
  // one is saved by the pin dialog.
  const saveBeforePin = doc.queryId !== null && (unsaved || doc.isProposal);
  const pinSource: PinSource = doc.queryId
    ? { kind: "query", queryId: doc.queryId }
    : {
        kind: "query",
        draft: {
          title: doc.title.trim() || t("analytics.explorer.editor.untitled"),
          sql: doc.sql,
          params: doc.params,
          chart: effectiveChart,
          origin: doc.origin,
          description: doc.description,
          basedOnReportId: doc.basedOnReportId,
        },
      };
  const pinChartOverride =
    doc.queryId && !saveBeforePin && !sameChart(effectiveChart, doc.chart)
      ? effectiveChart
      : null;
  const onDraftSaved = (query: SavedQuery) => {
    // The editor now shows that query, unless it was edited meanwhile.
    const { doc: current } = store();
    if (current.queryId === null && current.sql === query.sql) {
      store().markSaved(query);
    }
    bump();
  };

  const runKeys = isMac()
    ? "⌘ ↵"
    : `${t("analytics.explorer.editor.keys.ctrl")} ↵`;
  const proposalCount = (proposals.queries?.length ?? 0) + inbox.invalid.length;
  const canSave = hasSql && (unsaved || doc.isProposal || doc.queryId === null);
  const title = doc.title.trim() || t("analytics.explorer.editor.untitled");
  const openProposal = doc.isProposal
    ? proposals.queries?.find((query) => query.id === doc.queryId)
    : undefined;

  const panel: Record<SidebarTab, JSX.Element> = {
    queries: (
      <SavedQueries
        list={saved}
        archived={archived}
        currentId={doc.queryId}
        onOpen={(query) => void openQuery(query)}
        onRename={(query) => setDialog({ mode: "rename", query })}
        onDuplicate={(query) => void duplicate(query)}
        onArchive={(query) => void archive(query)}
        onRestore={(query) => void restore(query)}
        onRetry={bump}
      />
    ),
    proposals: (
      <Proposals
        proposals={proposals.queries ?? (proposals.error ? [] : null)}
        invalid={inbox.invalid}
        currentId={doc.isProposal ? doc.queryId : null}
        mcpEnabled={mcpEnabled}
        onExamine={(query) => void examine(query)}
        onAccept={(query) => void accept(query)}
        onRefuse={(query) => void refuse(query)}
        onRemoveInvalid={(id) =>
          void inbox
            .removeInvalid(id)
            .catch((error: unknown) => toast.error(String(error)))
        }
      />
    ),
    dictionary: (
      <DictionaryPanel
        objects={objects}
        onInsert={onDictionaryInsert}
        onPreview={(name) => void previewObject(name)}
      />
    ),
  };

  const sidePanel = (
    <>
      <SidebarTabs
        active={sidebarTab}
        proposalCount={proposalCount}
        asTabs
        onSelect={(tab) => store().setSidebarTab(tab)}
      />
      <div
        id="explorer-panel"
        role="tabpanel"
        aria-labelledby={`explorer-tab-${sidebarTab}`}
        tabIndex={0}
        className="min-h-0 min-w-0 overflow-y-auto rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-steel-blue-500"
      >
        {panel[sidebarTab]}
      </div>
    </>
  );

  return (
    <div
      className="grid gap-4 pb-6 xl:grid-cols-[20rem_minmax(0,1fr)]"
      onKeyDown={onKeyDown}
    >
      {wide ? (
        <aside className="order-2 flex min-w-0 flex-col gap-3 xl:sticky xl:top-0 xl:order-1 xl:max-h-[calc(100dvh-9rem)] xl:self-start">
          {sidePanel}
        </aside>
      ) : (
        <SidebarDrawer open={drawerOpen} onOpenChange={setDrawerOpen}>
          {sidePanel}
        </SidebarDrawer>
      )}

      <div
        className="order-1 flex min-w-0 flex-col gap-3 xl:order-2"
        data-explorer-main=""
      >
        <AiAssistantPanel
          onAnswer={onAiAnswer}
          currentSql={doc.sql}
          showPreview={false}
          compact={hasSql}
          onShowResult={showResult}
          onFocusParam={focusParam}
        />

        {!wide && (
          <SidebarTabs
            active={null}
            proposalCount={proposalCount}
            asTabs={false}
            onSelect={(tab) => {
              store().setSidebarTab(tab);
              setDrawerOpen(true);
            }}
          />
        )}

        <div className="flex flex-wrap items-start gap-2">
          <div className="flex min-w-[12rem] flex-1 flex-col gap-0.5">
            <div className="flex items-start gap-1">
              <h2 className="line-clamp-2 min-w-0 pt-2 text-lg font-semibold text-gray-900 break-words">
                {title}
              </h2>
              <button
                type="button"
                className="inline-flex min-h-11 min-w-11 flex-none items-center justify-center rounded text-steel-blue-800 hover:bg-steel-blue-50 disabled:opacity-40"
                aria-label={t("analytics.explorer.editor.rename")}
                title={t("analytics.explorer.editor.rename")}
                disabled={!doc.queryId && !hasSql}
                onClick={() => void renameOpen()}
              >
                <PencilSquareIcon className="h-5 w-5" aria-hidden />
              </button>
              {!doc.isProposal && (
                <span className="flex-none pt-2.5">
                  <OriginBadge query={{ origin: doc.origin }} />
                </span>
              )}
            </div>
            {unsaved && (
              <span className="text-xs text-yellow-800">
                {t("analytics.explorer.editor.unsavedBadge")}
              </span>
            )}
            {doc.description && <Description text={doc.description} />}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={toolbarButton}
              onClick={() => void newQuery()}
            >
              <DocumentPlusIcon className="h-5 w-5" aria-hidden />
              {t("analytics.explorer.editor.new")}
            </button>
            <Popover open={examplesOpen} onOpenChange={setExamplesOpen}>
              <PopoverTrigger asChild>
                <button type="button" className={toolbarButton}>
                  <LightBulbIcon className="h-5 w-5" aria-hidden />
                  {t("analytics.explorer.examples.title")}
                </button>
              </PopoverTrigger>
              <PopoverContent
                align="end"
                className="w-96 max-w-[calc(100vw-2rem)] rounded border border-gray-200 p-1"
              >
                <ul className="flex max-h-[70vh] flex-col overflow-auto">
                  {EXAMPLE_QUERIES.map((example) => (
                    <li key={example.id}>
                      <button
                        type="button"
                        className="flex min-h-11 w-full flex-col gap-0.5 rounded px-3 py-1.5 text-left hover:bg-steel-blue-50"
                        onClick={() => void openExample(example)}
                      >
                        <span className="text-sm text-gray-900">
                          {t(`analytics.explorer.examples.items.${example.id}`)}
                        </span>
                        <span className="text-xs text-gray-600">
                          {t(
                            `analytics.explorer.examples.descriptions.${example.id}`
                          )}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </PopoverContent>
            </Popover>
            <button
              type="button"
              className={unsaved ? primaryButtonClass : toolbarButton}
              disabled={!canSave}
              onClick={save}
            >
              {t("analytics.common.actions.save")}
            </button>
            {hasSql && (
              <PinButton
                source={pinSource}
                paramValues={pinnedValues(paramValues)}
                chartOverride={pinChartOverride}
                onDraftSaved={onDraftSaved}
                beforeOpen={
                  saveBeforePin
                    ? () =>
                        persist(
                          {
                            title: store().doc.title,
                            description: store().doc.description,
                          },
                          false
                        )
                    : undefined
                }
              />
            )}
            <Popover open={menuOpen} onOpenChange={setMenuOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className={toolbarButton}
                  aria-label={t("analytics.common.actions.more")}
                  title={t("analytics.common.actions.more")}
                >
                  <EllipsisHorizontalIcon className="h-5 w-5" aria-hidden />
                </button>
              </PopoverTrigger>
              <PopoverContent
                align="end"
                className="w-64 rounded border border-gray-200 p-1"
              >
                <button
                  type="button"
                  className={menuItemClass}
                  disabled={!hasSql}
                  onClick={() => {
                    setMenuOpen(false);
                    setDialog({ mode: "saveAs" });
                  }}
                >
                  <DocumentDuplicateIcon className="h-5 w-5" aria-hidden />
                  {t("analytics.explorer.saveAs")}
                </button>
                <button
                  type="button"
                  className={menuItemClass}
                  disabled={!doc.queryId && !hasSql}
                  onClick={() => void renameOpen()}
                >
                  <PencilSquareIcon className="h-5 w-5" aria-hidden />
                  {t("analytics.explorer.saved.renameMenu")}
                </button>
                <button
                  type="button"
                  className={menuItemClass}
                  onClick={() => {
                    setMenuOpen(false);
                    setHistoryOpen(true);
                  }}
                >
                  <ClockIcon className="h-5 w-5" aria-hidden />
                  {t("analytics.explorer.history.menu")}
                </button>
                <button
                  type="button"
                  className={menuItemClass}
                  disabled={!hasSql}
                  onClick={tidy}
                >
                  <ArrowPathRoundedSquareIcon className="h-5 w-5" aria-hidden />
                  {t("analytics.explorer.editor.tidy")}
                </button>
                <button
                  type="button"
                  className={menuItemClass + " text-error-700"}
                  disabled={!hasSql}
                  onClick={() => void clearSql()}
                >
                  <TrashIcon className="h-5 w-5" aria-hidden />
                  {t("analytics.explorer.editor.clear")}
                </button>
              </PopoverContent>
            </Popover>
          </div>
        </div>

        {doc.isProposal && doc.queryId && (
          <div className="flex flex-col gap-2 rounded border border-steel-blue-200 bg-steel-blue-50 p-3 sm:flex-row sm:items-center">
            <p className="flex-1 text-sm text-gray-800">
              {t("analytics.explorer.proposals.banner", {
                client:
                  mcpClientName(openProposal?.client) ??
                  t("analytics.explorer.origin.mcp"),
                date: formatStoredDate(
                  openProposal?.createdAt ?? null,
                  i18n.language
                ),
              })}
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={primaryButtonClass}
                disabled={!openProposal}
                onClick={() => openProposal && void accept(openProposal)}
              >
                {t("analytics.explorer.proposals.accept")}
              </button>
              <button
                type="button"
                className={secondaryButtonClass}
                disabled={!openProposal}
                onClick={() => openProposal && void refuse(openProposal)}
              >
                {t("analytics.explorer.proposals.refuse")}
              </button>
            </div>
          </div>
        )}

        <Suspense
          fallback={
            <div
              className="flex min-h-40 items-center justify-center rounded border border-gray-200 bg-gray-50 text-sm text-gray-500"
              aria-busy="true"
            >
              {t("analytics.explorer.editor.loading")}
            </div>
          }
        >
          <SqlEditor
            ref={editorRef}
            value={doc.sql}
            onChange={(sql) => store().setSql(sql)}
            onRun={() => store().requestRun()}
            onSave={save}
            schema={schema}
            error={editorError}
            describeError={(payload) =>
              formatAnalyticsError(
                new AnalyticsError(payload, { sql: store().doc.sql }),
                t
              )
            }
            writeWarning={t("analytics.explorer.errors.readOnly")}
            placeholder={t("analytics.explorer.editor.placeholder")}
            ariaLabel={t("analytics.explorer.editor.label")}
            large={coarse}
          />
        </Suspense>

        <ParamsEditor
          params={doc.params}
          values={paramValues}
          onTypeChange={(name, type) => store().setParamType(name, type)}
          onValuesChange={onParamValuesChange}
          currentSeasonLabel={t("analytics.explorer.params.hubSeason", {
            label: formatSeason(hubSeason, seasonStartMonth),
          })}
        />

        <div className="flex flex-wrap items-center gap-2">
          {loading ? (
            <button
              type="button"
              className={toolbarButton}
              onClick={runState.cancel}
            >
              <StopIcon className="h-5 w-5" aria-hidden />
              {t("analytics.explorer.editor.stop", { seconds: runSeconds })}
            </button>
          ) : (
            <button
              type="button"
              className={primaryButtonClass}
              disabled={!hasSql}
              onClick={() => store().requestRun()}
              title={runKeys}
            >
              <PlayIcon className="h-5 w-5" aria-hidden />
              {t("analytics.explorer.editor.run")}
              {!coarse && (
                <kbd
                  className="ml-1 rounded border border-white/40 px-1 font-sans text-xs font-normal"
                  aria-hidden
                >
                  {runKeys}
                </kbd>
              )}
            </button>
          )}
        </div>

        {!hasSql && <FirstSteps onExample={(e) => void openExample(e)} />}

        <ResultsPanel
          state={state}
          chart={doc.chart}
          fallbackChart={fallbackChart}
          onChartChange={onChartChange}
          mode={mode}
          onModeChange={setMode}
          builderOpen={builderOpen}
          onBuilderOpenChange={setBuilderOpen}
          params={runState.params}
          hasSql={hasSql}
          stale={stale}
          errorHelp={errorHelp}
          onGoToError={onGoToError}
          onApplyFix={onApplyFix}
          onRetry={onRetry}
          onChangeProfile={onChangeProfile}
          seasonLabel={seasonLabel}
          fileSlug={slugOf(
            doc.title || t("analytics.explorer.editor.untitled")
          )}
          title={title}
        />
      </div>

      {historyOpen && (
        <SimpleDialog
          open
          modal
          onOpenChange={setHistoryOpen}
          title={t("analytics.explorer.history.title")}
          className="w-[40rem]"
        >
          {history.length === 0 ? (
            <p className="text-sm text-gray-600">
              {t("analytics.explorer.history.empty")}
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-gray-600">
                {t("analytics.explorer.history.intro")}
              </p>
              <ul className="flex max-h-[60vh] flex-col gap-1 overflow-auto">
                {history.map((entry) => (
                  <li key={`${entry.at}-${entry.sql.length}`}>
                    <button
                      type="button"
                      className="flex min-h-11 w-full flex-col gap-0.5 rounded border border-gray-200 px-3 py-2 text-left hover:bg-steel-blue-50"
                      onClick={() => void openHistoryEntry(entry.sql)}
                    >
                      <code className="line-clamp-3 font-mono text-xs text-gray-900 whitespace-pre-wrap break-all">
                        {entry.sql}
                      </code>
                      <span className="text-xs text-gray-500">
                        {formatStoredDateTime(entry.at, i18n.language)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className={secondaryButtonClass + " self-start text-error-700"}
                onClick={() => void clearHistory()}
              >
                <TrashIcon className="h-5 w-5" aria-hidden />
                {t("analytics.explorer.history.clear")}
              </button>
            </div>
          )}
        </SimpleDialog>
      )}

      {dialog && (
        <SaveQueryDialog
          open
          mode={dialog.mode}
          initialTitle={
            dialog.mode === "rename"
              ? (dialog.query?.title ?? "")
              : dialog.mode === "saveAs" && doc.title.trim()
                ? `${doc.title.trim()} ${t("analytics.explorer.saved.copySuffix")}`
                : doc.title
          }
          initialDescription={
            dialog.mode === "rename"
              ? (dialog.query?.description ?? null)
              : doc.description
          }
          onOpenChange={(open) => !open && closeDialog(false)}
          onSubmit={submitDialog}
        />
      )}

      {confirmDialog}
    </div>
  );
};
