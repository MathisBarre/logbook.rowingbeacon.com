import { v4 as uuidv4 } from "uuid";
import type {
  ParamValue,
  PrivacyMode,
  QueryResult,
  RunQueryRequest,
} from "../types";
import { getEngine } from "./engine";
import { AnalyticsError, toAnalyticsError } from "./errors";
import { localNow } from "../params/season";
import { getActivePerformance } from "./activePerformance";

/**
 * The only way analytics code runs a query (plan 2.6): one query at a time
 * so the boathouse is never slowed down (on the Standard and Puissant
 * performance profiles, `concurrentQueries` at a time: each runs on its
 * own read-only WAL connection); high priority jobs (the report
 * the user just opened, editor runs) jump ahead of dashboard cards;
 * identical requests in flight share one promise. There is no result cache
 * here: the Rust engine caches by `PRAGMA data_version`.
 *
 * An `exclusive` job (free SQL: Explorer, AI assistant, proposals; heavy
 * reports) always runs alone: SQLite counts the memory of the whole
 * process, so a query beside it would count against its memory budget,
 * and it against theirs (review D, M1). Only light prebuilt queries,
 * far under the budget, run side by side.
 */

export type QueryPriority = "high" | "normal";
export interface RunQueryOptions {
  priority?: QueryPriority;
  /** Abort while queued removes the job; while running cancels it. */
  signal?: AbortSignal;
  /** Runs alone, with no other query beside it (free SQL, heavy reports). */
  exclusive?: boolean;
}

interface Subscriber {
  resolve: (result: QueryResult) => void;
  reject: (error: AnalyticsError) => void;
  detach: () => void;
}

interface Job {
  key: string;
  request: RunQueryRequest;
  priority: QueryPriority;
  exclusive: boolean;
  subscribers: Set<Subscriber>;
  state: "queued" | "running";
}

let queued: Job[] = [];
const running = new Set<Job>();
const inFlight = new Map<string, Job>();

/** Requests that differ only by `requestId` are the same query. */
const keyOf = (request: RunQueryRequest) =>
  JSON.stringify([
    request.sql,
    Object.entries(request.params).sort(([a], [b]) => (a < b ? -1 : 1)),
    request.maxRows,
    request.timeoutMs,
    request.privacy,
    request.now,
    request.useCache,
  ]);

const cancelledError = (request: RunQueryRequest) =>
  new AnalyticsError(
    { code: "cancelled", message: "Query cancelled" },
    { sql: request.sql, timeoutMs: request.timeoutMs }
  );

const settle = (job: Job, outcome: (subscriber: Subscriber) => void) => {
  for (const subscriber of job.subscribers) {
    subscriber.detach();
    outcome(subscriber);
  }
  job.subscribers.clear();
};

/** The next job to start: the first high priority one, else the first. */
const nextIndex = () => {
  const index = queued.findIndex((job) => job.priority === "high");
  return index === -1 ? 0 : index;
};

const pump = () => {
  const slots = Math.max(1, getActivePerformance().limits.concurrentQueries);
  while (running.size < slots && queued.length > 0) {
    // Nothing starts beside an exclusive job, and an exclusive job waits
    // for the running ones (in order: it is never overtaken).
    if ([...running].some((job) => job.exclusive)) return;
    const index = nextIndex();
    if (queued[index].exclusive && running.size > 0) return;
    start(index);
  }
};

const start = (index: number) => {
  const [job] = queued.splice(index, 1);
  running.add(job);
  job.state = "running";

  let promise: Promise<QueryResult>;
  try {
    promise = getEngine().run(job.request);
  } catch (error) {
    promise = Promise.reject(
      error instanceof Error ? error : new Error(String(error))
    );
  }

  promise
    .then(
      (result) => settle(job, (subscriber) => subscriber.resolve(result)),
      (error: unknown) => {
        const analyticsError = toAnalyticsError(error, {
          sql: job.request.sql,
          timeoutMs: job.request.timeoutMs,
        });
        settle(job, (subscriber) => subscriber.reject(analyticsError));
      }
    )
    .finally(() => {
      if (inFlight.get(job.key) === job) {
        inFlight.delete(job.key);
      }
      running.delete(job);
      pump();
    });
};

const leave = (job: Job, subscriber: Subscriber) => {
  if (!job.subscribers.delete(subscriber)) {
    return;
  }
  subscriber.detach();
  subscriber.reject(cancelledError(job.request));
  if (job.subscribers.size > 0) {
    return;
  }
  // Nobody waits for this job any more.
  if (inFlight.get(job.key) === job) {
    inFlight.delete(job.key);
  }
  if (job.state === "queued") {
    queued = queued.filter((other) => other !== job);
  } else {
    void getEngine()
      .cancel(job.request.requestId)
      .catch((error: unknown) => {
        console.error("❌ Failed to cancel an analytics query", error);
      });
  }
};

export const runQuery = (
  request: RunQueryRequest,
  options: RunQueryOptions = {}
): Promise<QueryResult> =>
  new Promise<QueryResult>((resolve, reject) => {
    const { signal, priority = "normal", exclusive = false } = options;
    if (signal?.aborted) {
      reject(cancelledError(request));
      return;
    }

    const key = keyOf(request);
    let job = inFlight.get(key);
    if (!job) {
      job = {
        key,
        request,
        priority,
        exclusive,
        subscribers: new Set(),
        state: "queued",
      };
      inFlight.set(key, job);
      queued.push(job);
    } else {
      if (priority === "high" && job.priority === "normal") {
        job.priority = "high";
      }
      if (exclusive && job.state === "queued") {
        job.exclusive = true;
      }
    }

    const sharedJob = job;
    const onAbort = () => leave(sharedJob, subscriber);
    const subscriber: Subscriber = {
      resolve,
      reject,
      detach: () => signal?.removeEventListener("abort", onAbort),
    };
    sharedJob.subscribers.add(subscriber);
    signal?.addEventListener("abort", onAbort, { once: true });

    pump();
  });

/**
 * Builds a request with a fresh id and the local `now`. Default timeout:
 * the report timeout of the performance profile (20 s on Économe).
 */
export const createRequest = (input: {
  sql: string;
  params?: Record<string, ParamValue>;
  maxRows?: number;
  timeoutMs?: number;
  useCache?: boolean;
  privacy?: PrivacyMode;
  now?: string;
}): RunQueryRequest => ({
  requestId: uuidv4(),
  sql: input.sql,
  params: input.params ?? {},
  maxRows: input.maxRows ?? 5000,
  timeoutMs: input.timeoutMs ?? getActivePerformance().limits.reportTimeoutMs,
  privacy: input.privacy ?? "nominative",
  now: input.now ?? localNow(),
  useCache: input.useCache ?? true,
});

/** Test helper: forgets every job (does not settle them). */
export const resetQueueForTests = () => {
  queued = [];
  running.clear();
  inFlight.clear();
};
