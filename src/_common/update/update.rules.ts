/**
 * App updates (ADR 0006): checked against the public releases, installed
 * only after a backup of the club data.
 */

/** The boathouse computer often stays on for days: check again every 6 h. */
export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** A check that gets no answer gives up, so the next one can run. */
export const UPDATE_CHECK_TIMEOUT_MS = 30 * 1000;

/** Whole download, generous for a slow boathouse connection (~100 MB). */
export const UPDATE_DOWNLOAD_TIMEOUT_MS = 30 * 60 * 1000;

/** The landing page lists what each version brings, in every language. */
export const getChangelogUrl = (locale: string | null) =>
  `https://rowingbeacon.com/${locale ?? "en-US"}/download`;

/** Download progress in whole percents, or null while the size is unknown. */
export const getDownloadPercent = (downloaded: number, total?: number) => {
  if (!total || total <= 0) return null;
  return Math.min(100, Math.floor((downloaded / total) * 100));
};

/** Notes written for the release, without the default release title. */
export const getReleaseNotes = (body: string | undefined, version: string) => {
  const notes = body?.trim();
  if (!notes || notes === `Rowing Beacon v${version}`) return null;
  return notes;
};
