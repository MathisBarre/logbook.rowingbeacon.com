import { useEffect, useState } from "react";
import type { QueryStatus, SavedQuery } from "../types";
import { listQueries } from "../repository/analytics.repository";
import { appQueryDb, QueryDb } from "./queryActions";
import { useExplorerStore } from "./explorer.store";

export interface QueryList {
  /** `null` while loading, and after a failed read. */
  queries: SavedQuery[] | null;
  /** True when the database could not be read (review 42). */
  error: boolean;
}

/**
 * Saved, proposed or archived queries, read again after every Explorer
 * write (`queriesVersion`). A failed read is reported as such, never as
 * an empty list ("Aucune requête enregistrée").
 */
export const useQueryList = (
  status: QueryStatus,
  {
    archived = false,
    db = appQueryDb,
  }: { archived?: boolean; db?: QueryDb } = {}
): QueryList => {
  const version = useExplorerStore((state) => state.queriesVersion);
  const [list, setList] = useState<QueryList>({ queries: null, error: false });
  useEffect(() => {
    let alive = true;
    db.read((client) => listQueries(client, { status, archived }))
      .then((queries) => {
        if (alive) setList({ queries, error: false });
      })
      .catch((error: unknown) => {
        console.error("❌ Could not list analytics queries", error);
        if (alive) setList({ queries: null, error: true });
      });
    return () => {
      alive = false;
    };
  }, [status, archived, version, db]);
  return list;
};

/** Lower case, without accents: "Évolution" matches "evol". */
export const normalizeSearch = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

/** A stored ISO time as a medium date in the locale; "" when unreadable. */
export const formatStoredDate = (iso: string | null, locale: string) =>
  formatStored(iso, locale, { dateStyle: "medium" });

/** A stored ISO time as a date and a time ("20 juin 2026, 09:47"). */
export const formatStoredDateTime = (iso: string | null, locale: string) =>
  formatStored(iso, locale, { dateStyle: "medium", timeStyle: "short" });

const formatStored = (
  iso: string | null,
  locale: string,
  options: Intl.DateTimeFormatOptions
) => {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  try {
    return new Intl.DateTimeFormat(locale, options).format(date);
  } catch {
    return date.toISOString().slice(0, options.timeStyle ? 16 : 10);
  }
};
