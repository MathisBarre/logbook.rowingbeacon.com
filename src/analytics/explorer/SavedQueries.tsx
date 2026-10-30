import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArchiveBoxIcon,
  ArrowTopRightOnSquareIcon,
  ArrowUturnLeftIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  DocumentDuplicateIcon,
  EllipsisHorizontalIcon,
  MagnifyingGlassIcon,
  PencilSquareIcon,
} from "@heroicons/react/24/outline";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../_common/components/Popover";
import type { QueryOrigin, SavedQuery } from "../types";
import { secondaryButtonClass } from "../components/AnalyticsStates";
import { mcpClientName } from "./mcpClientName";
import { formatStoredDate, normalizeSearch, QueryList } from "./useQueryList";

/**
 * "Requêtes" (plan 1.3): the club's saved queries. Each row shows its
 * title, its description and one meta line (origin when it is not typed
 * here, last change); one "⋯" button per row holds Ouvrir, Renommer,
 * Dupliquer and Archiver (review 35). Archived queries can be restored
 * from "Archivées" at the bottom (review 40).
 */

interface SavedQueriesProps {
  list: QueryList;
  archived: QueryList;
  currentId: string | null;
  onOpen: (query: SavedQuery) => void;
  onRename: (query: SavedQuery) => void;
  onDuplicate: (query: SavedQuery) => void;
  onArchive: (query: SavedQuery) => void;
  onRestore: (query: SavedQuery) => void;
  /** Reads the lists again after a failed read. */
  onRetry: () => void;
}

const ORIGIN_CLASS: Record<QueryOrigin, string> = {
  user: "bg-gray-100 text-gray-700",
  ai: "bg-purple-100 text-purple-800",
  mcp: "bg-steel-blue-100 text-steel-blue-800",
  report: "bg-success-100 text-success-800",
};

/**
 * Where a query comes from (review 36): none for one typed here (the list
 * is shared by the club's officials, "Vous" would be wrong), "Assistant
 * IA", the AI app's name for an MCP proposal, or "Rapport".
 */
export const OriginBadge = ({
  query,
}: {
  query: Pick<SavedQuery, "origin"> & { client?: string | null };
}) => {
  const { t } = useTranslation();
  if (query.origin === "user") return null;
  const label =
    query.origin === "mcp"
      ? (mcpClientName(query.client) ?? t("analytics.explorer.origin.mcp"))
      : t(`analytics.explorer.origin.${query.origin}`);
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ${ORIGIN_CLASS[query.origin]}`}
    >
      {label}
    </span>
  );
};

const menuItemClass =
  "flex min-h-11 w-full items-center gap-2 rounded px-3 text-left text-sm text-gray-900 hover:bg-steel-blue-50";

const RowMenu = ({
  query,
  onOpen,
  onRename,
  onDuplicate,
  onArchive,
}: {
  query: SavedQuery;
  onOpen: () => void;
  onRename: () => void;
  onDuplicate: () => void;
  onArchive: () => void;
}) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const item = (action: () => void) => () => {
    setOpen(false);
    action();
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex min-h-11 min-w-11 flex-none items-center justify-center rounded text-steel-blue-800 hover:bg-steel-blue-100"
          aria-label={t("analytics.explorer.saved.actionsFor", {
            title: query.title,
          })}
        >
          <EllipsisHorizontalIcon className="h-5 w-5" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-56 rounded border border-gray-200 p-1"
      >
        <button type="button" className={menuItemClass} onClick={item(onOpen)}>
          <ArrowTopRightOnSquareIcon className="h-5 w-5" aria-hidden />
          {t("analytics.common.actions.open")}
        </button>
        <button
          type="button"
          className={menuItemClass}
          onClick={item(onRename)}
        >
          <PencilSquareIcon className="h-5 w-5" aria-hidden />
          {t("analytics.explorer.saved.renameMenu")}
        </button>
        <button
          type="button"
          className={menuItemClass}
          onClick={item(onDuplicate)}
        >
          <DocumentDuplicateIcon className="h-5 w-5" aria-hidden />
          {t("analytics.explorer.saved.duplicate")}
        </button>
        <button
          type="button"
          className={menuItemClass}
          onClick={item(onArchive)}
        >
          <ArchiveBoxIcon className="h-5 w-5" aria-hidden />
          {t("analytics.explorer.saved.archiveMenu")}
        </button>
      </PopoverContent>
    </Popover>
  );
};

const Archived = ({
  archived,
  onRestore,
}: {
  archived: QueryList;
  onRestore: (query: SavedQuery) => void;
}) => {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const queries = archived.queries ?? [];
  if (queries.length === 0) return null;
  const Chevron = open ? ChevronDownIcon : ChevronRightIcon;
  return (
    <section className="flex flex-col gap-1 border-t border-gray-200 pt-2">
      <button
        type="button"
        className="flex min-h-11 items-center gap-1 text-left text-sm font-medium text-gray-700"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Chevron className="h-4 w-4" aria-hidden />
        {t("analytics.explorer.saved.archived", { count: queries.length })}
      </button>
      {open && (
        <ul className="flex flex-col gap-1">
          {queries.map((query) => (
            <li
              key={query.id}
              className="flex items-center gap-2 rounded border border-gray-100 bg-gray-50 py-1 pl-2 pr-1"
            >
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="line-clamp-2 text-sm text-gray-700 break-words">
                  {query.title}
                </span>
                <span className="text-xs text-gray-500">
                  {t("analytics.explorer.saved.archivedOn", {
                    date: formatStoredDate(query.archivedAt, i18n.language),
                  })}
                </span>
              </span>
              <button
                type="button"
                className={secondaryButtonClass + " flex-none text-xs"}
                aria-label={t("analytics.explorer.saved.restoreTitle", {
                  title: query.title,
                })}
                onClick={() => onRestore(query)}
              >
                <ArrowUturnLeftIcon className="h-4 w-4" aria-hidden />
                {t("analytics.explorer.saved.restore")}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

export const SavedQueries = ({
  list,
  archived,
  currentId,
  onOpen,
  onRename,
  onDuplicate,
  onArchive,
  onRestore,
  onRetry,
}: SavedQueriesProps) => {
  const { t, i18n } = useTranslation();
  const [search, setSearch] = useState("");
  const queries = list.queries;
  const shown = useMemo(() => {
    const needle = normalizeSearch(search);
    if (!queries || !needle) return queries;
    return queries.filter((query) =>
      normalizeSearch(`${query.title} ${query.description ?? ""}`).includes(
        needle
      )
    );
  }, [queries, search]);

  if (list.error) {
    return (
      <div className="flex flex-col items-start gap-2 p-2" role="alert">
        <p className="text-sm text-error-700">
          {t("analytics.explorer.saved.readError")}
        </p>
        <button
          type="button"
          className={secondaryButtonClass}
          onClick={onRetry}
        >
          {t("analytics.common.actions.retry")}
        </button>
      </div>
    );
  }
  if (queries === null) {
    return (
      <div
        className="h-24 animate-pulse rounded bg-gray-100"
        aria-busy="true"
      />
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {queries.length === 0 && (
        <p className="p-2 text-sm text-gray-600">
          {t("analytics.explorer.saved.empty")}
        </p>
      )}
      {queries.length > 5 && (
        <label className="relative">
          <span className="sr-only">
            {t("analytics.explorer.saved.search")}
          </span>
          <MagnifyingGlassIcon
            className="pointer-events-none absolute left-2 top-3 h-5 w-5 text-gray-400"
            aria-hidden
          />
          <input
            type="search"
            className="min-h-11 w-full rounded border border-gray-300 pl-9 pr-2 text-sm"
            placeholder={t("analytics.explorer.saved.search")}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
      )}
      {queries.length > 0 && (
        <ul className="flex flex-col gap-1">
          {(shown ?? []).map((query) => {
            const current = query.id === currentId;
            return (
              <li
                key={query.id}
                data-query-id={query.id}
                className={
                  "flex items-start gap-1 rounded border py-1 pl-2 pr-1 " +
                  (current
                    ? "border-steel-blue-400 bg-steel-blue-50"
                    : "border-gray-200 bg-white")
                }
              >
                <button
                  type="button"
                  className="flex min-h-11 min-w-0 flex-1 flex-col items-start justify-center gap-0.5 py-1 text-left"
                  onClick={() => onOpen(query)}
                  aria-current={current ? "true" : undefined}
                >
                  <span className="line-clamp-2 text-sm font-medium text-gray-900 break-words">
                    {query.title}
                  </span>
                  {query.description && (
                    <span className="line-clamp-1 text-xs text-gray-600 break-all">
                      {query.description}
                    </span>
                  )}
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-gray-500">
                    <OriginBadge query={query} />
                    {t("analytics.explorer.saved.updated", {
                      date: formatStoredDate(query.updatedAt, i18n.language),
                    })}
                  </span>
                </button>
                <RowMenu
                  query={query}
                  onOpen={() => onOpen(query)}
                  onRename={() => onRename(query)}
                  onDuplicate={() => onDuplicate(query)}
                  onArchive={() => onArchive(query)}
                />
              </li>
            );
          })}
        </ul>
      )}
      {queries.length > 0 && shown?.length === 0 && (
        <p className="p-2 text-sm text-gray-600">
          {t("analytics.explorer.saved.noMatch", { query: search })}
        </p>
      )}
      <Archived archived={archived} onRestore={onRestore} />
    </div>
  );
};
