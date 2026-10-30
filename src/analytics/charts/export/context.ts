import type { TFunction } from "i18next";
import type { ChartSpec } from "../../chartSpec";
import type { ParamValue, QueryResult } from "../../types";
import {
  columnLabel,
  formatValue,
  ResolvedFormat,
  resolveFormatByName,
} from "../format";
import { specFormat } from "../model";

/** What every export needs to label and format a result. */
export interface ExportContext {
  t: TFunction;
  locale: string;
  seasonStartMonth: number;
}

export interface ExportInput {
  result: QueryResult;
  spec?: ChartSpec | null;
  params?: Record<string, ParamValue>;
}

/** Translated header of each result column. */
export const exportHeaders = (
  { result, spec, params }: ExportInput,
  ctx: ExportContext
): string[] =>
  result.columns.map((c) =>
    columnLabel(c.name, ctx.t, spec?.labels, spec?.labelKeys, params)
  );

/** Resolved format of a column (spec first, then the name rules). */
export const exportFormat = (
  spec: ChartSpec | null | undefined,
  column: string,
  sample: (string | number | null)[]
): ResolvedFormat | null => {
  const explicit = spec ? specFormat(spec, column) : undefined;
  if (explicit && explicit !== "auto") return explicit;
  return resolveFormatByName(column, sample);
};

/** Display text of a cell, as the table shows it. */
export const exportText = (
  input: ExportInput,
  ctx: ExportContext,
  columnIndex: number,
  value: string | number | null
) => {
  const column = input.result.columns[columnIndex].name;
  return formatValue(column, value, {
    locale: ctx.locale,
    seasonStartMonth: ctx.seasonStartMonth,
    params: input.params,
    format: input.spec ? specFormat(input.spec, column) : undefined,
    t: ctx.t,
  });
};
