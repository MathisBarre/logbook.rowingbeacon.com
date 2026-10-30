import { z } from "zod";
import { ChartSpec, ParamDef } from "../chartSpec";
import type { AiProvider } from "../engine/ipc";
import type { AiDraft } from "../types";

/**
 * The assistant's memory on this computer (review #7): the last answered
 * questions with their answer, so a question asked again next month is
 * replayed on today's data without paying the AI again. Kept in
 * localStorage under `rb.analytics.*`, so "Supprimer toutes les données"
 * clears it with the rest (localMemory.ts). It holds the question, the
 * SQL and the AI's texts: never results or rowers' data.
 */

export const AI_HISTORY_STORAGE_KEY = "rb.analytics.ai.history";
export const AI_HISTORY_MAX = 10;

export interface AiHistoryEntry {
  question: string;
  draft: AiDraft;
  /** ISO time of the answer. */
  at: string;
  provider: AiProvider | null;
  model: string | null;
}

const Entry = z.object({
  question: z.string().min(1).max(2000),
  draft: z.object({
    title: z.string().max(200),
    sql: z.string().min(1),
    params: z.array(ParamDef),
    chart: ChartSpec,
    explanation: z.string(),
    assumptions: z.array(z.string()),
  }),
  at: z.string(),
  provider: z.enum(["anthropic", "openai", "openai_compatible"]).nullable(),
  model: z.string().nullable(),
});

/** The stored entries, newest first; [] when unreadable or blocked. */
export const readAiHistory = (): AiHistoryEntry[] => {
  let value: unknown;
  try {
    const raw = window.localStorage.getItem(AI_HISTORY_STORAGE_KEY);
    value = raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];
  const entries: AiHistoryEntry[] = [];
  for (const item of value) {
    const parsed = Entry.safeParse(item);
    if (parsed.success) entries.push(parsed.data);
  }
  return entries.slice(0, AI_HISTORY_MAX);
};

const sameQuestion = (a: string, b: string) =>
  a.trim().toLowerCase().replace(/\s+/g, " ") ===
  b.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * The history with this answer first: the same question asked again
 * replaces its older answer. Pure, for tests.
 */
export const withAiHistoryEntry = (
  entries: AiHistoryEntry[],
  entry: AiHistoryEntry
): AiHistoryEntry[] =>
  [
    entry,
    ...entries.filter((e) => !sameQuestion(e.question, entry.question)),
  ].slice(0, AI_HISTORY_MAX);

/** Remembers an answer; returns the new history. */
export const rememberAiAnswer = (entry: AiHistoryEntry): AiHistoryEntry[] => {
  const next = withAiHistoryEntry(readAiHistory(), entry);
  try {
    window.localStorage.setItem(AI_HISTORY_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage blocked or full: only a convenience is lost.
  }
  return next;
};
