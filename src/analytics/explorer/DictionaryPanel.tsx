import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  FunnelIcon,
  MagnifyingGlassIcon,
  TableCellsIcon,
} from "@heroicons/react/24/outline";
import {
  DictionaryColumn,
  DictionaryObject,
  getDictionary,
  isPersonalClass,
} from "../schema/dictionary";
import type { EngineObjects } from "../types";
import { MODULE_IDS } from "../../_common/business/modules.rules";
import {
  DictionaryEntry,
  filterDictionary,
  KEY_FILTERS,
  moduleForTable,
  MOST_USEFUL_VIEW,
} from "./dictionaryModel";

/**
 * "Dictionnaire" (plan 1.3): what the queries can read, the most useful
 * views first. Each column shows its label in the user's language, its
 * name, its kind of value, a hint and the code values; a tap inserts it
 * into the editor (a whole SELECT in an empty editor, with the comma it
 * needs otherwise). An expanded view offers "Voir 50 lignes" and, for the
 * outing views, the filters that make numbers match the reports. Columns
 * that never leave the club in pseudonymised mode carry a "Donnée
 * personnelle" badge.
 */

export type DictionaryInsert =
  | { kind: "column"; object: string; column: string }
  | { kind: "object"; object: string }
  | { kind: "filter"; object: string; sql: string };

interface DictionaryPanelProps {
  objects: EngineObjects | null;
  onInsert: (insert: DictionaryInsert) => void;
  /** "Voir 50 lignes" of a view or table. */
  onPreview: (object: string) => void;
}

const isEnglish = (language: string) => language.startsWith("en");

export const objectDescription = (t: TFunction, object: DictionaryObject) =>
  t(`analytics.explorer.dictionary.objects.${object.name}`, {
    defaultValue: object.description,
  });

export const columnLabel = (t: TFunction, column: string): string | null => {
  const label = t(`analytics.columns.${column}`, { defaultValue: "" });
  return label ? label : null;
};

const columnHint = (
  t: TFunction,
  language: string,
  column: DictionaryColumn
): string =>
  t(`analytics.explorer.dictionary.hints.${column.name}`, {
    defaultValue: "",
  }) || (isEnglish(language) ? column.description : "");

export const semanticLabel = (t: TFunction, semantic: string) =>
  t(`analytics.explorer.dictionary.semantic.${semantic}`, {
    defaultValue: semantic,
  });

const codeList = (t: TFunction, column: DictionaryColumn) =>
  (column.codes ?? [])
    .map((code) => {
      const label = t(`analytics.codes.${column.name}.${code}`, {
        defaultValue: "",
      });
      return label && label !== code ? `${code} (${label})` : code;
    })
    .join(", ");

const ColumnRow = ({
  column,
  onInsert,
}: {
  column: DictionaryColumn;
  onInsert: (() => void) | null;
}) => {
  const { t, i18n } = useTranslation();
  const label = columnLabel(t, column.name);
  const hint = columnHint(t, i18n.language, column);
  const values = codeList(t, column);
  return (
    <li>
      <button
        type="button"
        className="flex min-h-11 w-full flex-col items-start gap-0.5 rounded px-2 py-1 text-left hover:bg-steel-blue-50 focus:bg-steel-blue-50 disabled:cursor-default disabled:hover:bg-transparent"
        disabled={!onInsert}
        onClick={() => onInsert?.()}
        title={onInsert ? t("analytics.explorer.dictionary.insert") : undefined}
      >
        {onInsert && (
          <span className="sr-only">
            {t("analytics.explorer.dictionary.insertPrefix")}
          </span>
        )}
        <span className="flex flex-wrap items-baseline gap-x-2">
          <code className="font-mono text-sm text-steel-blue-800">
            {column.name}
          </code>
          {label && <span className="text-sm text-gray-900">{label}</span>}
          <span className="text-xs text-gray-500">
            {semanticLabel(t, column.semantic)}
          </span>
          {isPersonalClass(column.class) && (
            <span className="rounded bg-yellow-100 px-1.5 text-xs font-medium text-yellow-800">
              {t("analytics.explorer.dictionary.personal")}
            </span>
          )}
          {column.class === "contact" && (
            <span className="text-xs text-gray-500">
              {t("analytics.explorer.dictionary.alwaysEmpty")}
            </span>
          )}
        </span>
        {hint && <span className="text-xs text-gray-600">{hint}</span>}
        {values && (
          <span className="text-xs text-gray-500 break-words">
            {t("analytics.explorer.dictionary.values", { values })}
          </span>
        )}
      </button>
    </li>
  );
};

const KeyFilters = ({
  object,
  onInsert,
}: {
  object: string;
  onInsert: (insert: DictionaryInsert) => void;
}) => {
  const { t } = useTranslation();
  const filters = KEY_FILTERS[object];
  if (!filters) return null;
  return (
    <div className="mx-1 mb-1 flex flex-col gap-1 rounded border border-success-200 bg-success-50 p-2">
      <h4 className="flex items-center gap-1 text-xs font-semibold text-success-800">
        <FunnelIcon className="h-4 w-4" aria-hidden />
        {t("analytics.explorer.dictionary.keyFiltersTitle")}
      </h4>
      <ul className="flex flex-col">
        {filters.map((filter) => (
          <li key={filter.id}>
            <button
              type="button"
              className="flex min-h-11 w-full flex-wrap items-baseline gap-x-2 rounded px-1 text-left hover:bg-success-100"
              title={t("analytics.explorer.dictionary.insert")}
              onClick={() =>
                onInsert({ kind: "filter", object, sql: filter.sql })
              }
            >
              <span className="sr-only">
                {t("analytics.explorer.dictionary.insertPrefix")}
              </span>
              <code className="font-mono text-sm text-steel-blue-800">
                {filter.sql}
              </code>
              <span className="text-xs text-gray-700">
                {t(`analytics.explorer.dictionary.keyFilters.${filter.id}`)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};

const ObjectItem = ({
  entry,
  expanded,
  onToggle,
  onInsert,
  onPreview,
}: {
  entry: DictionaryEntry;
  expanded: boolean;
  onToggle: () => void;
  onInsert: (insert: DictionaryInsert) => void;
  onPreview: (object: string) => void;
}) => {
  const { t } = useTranslation();
  const { object, missingTable } = entry;
  const Chevron = expanded ? ChevronDownIcon : ChevronRightIcon;
  const module = missingTable ? moduleForTable(missingTable) : null;
  return (
    <li
      className={
        "rounded border bg-white " +
        (missingTable ? "border-gray-100" : "border-gray-200")
      }
    >
      <div className="flex items-start gap-1">
        <button
          type="button"
          className="flex min-h-11 min-w-0 flex-1 items-start gap-1 px-2 py-2 text-left"
          aria-expanded={expanded}
          onClick={onToggle}
        >
          <Chevron
            className="mt-0.5 h-4 w-4 flex-none text-gray-500"
            aria-hidden
          />
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <code
                className={
                  "font-mono text-sm font-semibold break-all " +
                  (missingTable ? "text-gray-400" : "text-gray-900")
                }
              >
                {object.name}
              </code>
              {object.name === MOST_USEFUL_VIEW && !missingTable && (
                <span className="rounded bg-success-100 px-1.5 text-xs font-medium text-success-800">
                  {t("analytics.explorer.dictionary.mostUseful")}
                </span>
              )}
            </span>
            <span className="text-xs text-gray-600">
              {objectDescription(t, object)}
            </span>
            {missingTable && (
              <span className="text-xs text-gray-500">
                {module && (MODULE_IDS as readonly string[]).includes(module)
                  ? t("analytics.common.unavailable.module", {
                      module: t(`modules.${module}.name`, {
                        defaultValue: module,
                      }),
                    })
                  : t("analytics.explorer.dictionary.unavailable")}
              </span>
            )}
          </span>
        </button>
        {!missingTable && (
          <button
            type="button"
            className="min-h-11 flex-none rounded px-2 text-xs font-medium text-steel-blue-800 hover:bg-steel-blue-50"
            aria-label={t("analytics.explorer.dictionary.insertObject", {
              name: object.name,
            })}
            onClick={() => onInsert({ kind: "object", object: object.name })}
          >
            {t("analytics.explorer.dictionary.insertShort")}
          </button>
        )}
      </div>
      {expanded && (
        <div className="flex flex-col border-t border-gray-100 py-1">
          {!missingTable && (
            <button
              type="button"
              className="mx-1 mb-1 inline-flex min-h-11 items-center gap-2 self-start rounded px-2 text-sm font-medium text-steel-blue-800 hover:bg-steel-blue-50"
              onClick={() => onPreview(object.name)}
            >
              <TableCellsIcon className="h-5 w-5" aria-hidden />
              {t("analytics.explorer.dictionary.preview")}
            </button>
          )}
          {!missingTable && (
            <KeyFilters object={object.name} onInsert={onInsert} />
          )}
          <ul className="flex flex-col px-1">
            {entry.columns.map((column) => (
              <ColumnRow
                key={column.name}
                column={column}
                onInsert={
                  missingTable
                    ? null
                    : () =>
                        onInsert({
                          kind: "column",
                          object: object.name,
                          column: column.name,
                        })
                }
              />
            ))}
          </ul>
        </div>
      )}
    </li>
  );
};

export const DictionaryPanel = ({
  objects,
  onInsert,
  onPreview,
}: DictionaryPanelProps) => {
  const { t, i18n } = useTranslation();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [tablesOpen, setTablesOpen] = useState(false);

  const view = useMemo(
    () =>
      filterDictionary(
        getDictionary().objects,
        search,
        {
          object: (object) => objectDescription(t, object),
          column: (column) =>
            [
              columnLabel(t, column.name) ?? "",
              columnHint(t, i18n.language, column),
              semanticLabel(t, column.semantic),
              codeList(t, column),
            ].join(" "),
        },
        objects
      ),
    [search, objects, t, i18n.language]
  );

  const searching = search.trim() !== "";
  const isOpen = (entry: DictionaryEntry) =>
    open[entry.object.name] ?? (searching && entry.matched);
  const toggle = (entry: DictionaryEntry) =>
    setOpen({ ...open, [entry.object.name]: !isOpen(entry) });
  const showTables = tablesOpen || (searching && view.tables.length > 0);

  return (
    <div className="flex flex-col gap-3">
      <label className="relative">
        <span className="sr-only">
          {t("analytics.explorer.dictionary.search")}
        </span>
        <MagnifyingGlassIcon
          className="pointer-events-none absolute left-2 top-3 h-5 w-5 text-gray-400"
          aria-hidden
        />
        <input
          type="search"
          className="min-h-11 w-full rounded border border-gray-300 pl-9 pr-2 text-sm"
          placeholder={t("analytics.explorer.dictionary.search")}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </label>
      <p className="text-xs text-gray-500">
        {t("analytics.explorer.dictionary.intro")}
      </p>

      <section className="flex flex-col gap-1">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          {t("analytics.explorer.dictionary.views")}
        </h3>
        <ul className="flex flex-col gap-1">
          {view.views.map((entry) => (
            <ObjectItem
              key={entry.object.name}
              entry={entry}
              expanded={isOpen(entry)}
              onToggle={() => toggle(entry)}
              onInsert={onInsert}
              onPreview={onPreview}
            />
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-1">
        <button
          type="button"
          className="flex min-h-11 items-center gap-1 text-left text-xs font-semibold uppercase tracking-wide text-gray-500"
          aria-expanded={showTables}
          onClick={() => setTablesOpen(!showTables)}
        >
          {showTables ? (
            <ChevronDownIcon className="h-4 w-4" aria-hidden />
          ) : (
            <ChevronRightIcon className="h-4 w-4" aria-hidden />
          )}
          {t("analytics.explorer.dictionary.tables")}
        </button>
        {showTables && (
          <ul className="flex flex-col gap-1">
            {view.tables.map((entry) => (
              <ObjectItem
                key={entry.object.name}
                entry={entry}
                expanded={isOpen(entry)}
                onToggle={() => toggle(entry)}
                onInsert={onInsert}
                onPreview={onPreview}
              />
            ))}
          </ul>
        )}
      </section>

      {searching && view.views.length === 0 && view.tables.length === 0 && (
        <p className="text-sm text-gray-600">
          {t("analytics.explorer.dictionary.noMatch", { query: search })}
        </p>
      )}
    </div>
  );
};
