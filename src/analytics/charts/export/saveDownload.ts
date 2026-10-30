import type { TFunction } from "i18next";
import { isTauri } from "@tauri-apps/api/core";
import { BaseDirectory, writeFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { toast } from "sonner";

/**
 * Writes an export to the Downloads folder (plan 2.10), the folder
 * `exportData` already uses. Outside the installed app (browser preview)
 * the browser downloads the file instead.
 */

export type ExportExtension = "csv" | "xlsx" | "png" | "html";

const MIME: Record<ExportExtension, string> = {
  csv: "text/csv;charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  png: "image/png",
  html: "text/html;charset=utf-8",
};

const browserDownload = (fileName: string, data: Uint8Array | string) => {
  const ext = fileName.split(".").pop() as ExportExtension;
  const part: BlobPart =
    typeof data === "string" ? data : new Uint8Array(data).buffer;
  const blob = new Blob([part], {
    type: MIME[ext] ?? "application/octet-stream",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
};

/** Saves `data` as Downloads/`fileName`; resolves with the file name. */
export const saveDownload = async (
  fileName: string,
  data: Uint8Array | string
): Promise<string> => {
  if (!isTauri()) {
    browserDownload(fileName, data);
    return fileName;
  }
  if (typeof data === "string") {
    await writeTextFile(fileName, data, { baseDir: BaseDirectory.Download });
  } else {
    await writeFile(fileName, data, { baseDir: BaseDirectory.Download });
  }
  return fileName;
};

/** "Utilisation des bateaux" → "utilisation-des-bateaux" (at most 60). */
export const slugify = (text: string): string =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "") || "export";

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * `rowing-beacon-<slug>-<season>-<YYYYMMDD>.<ext>` (plan 2.10), the date
 * from local components; `seasonLabel` ("2025-2026") is left out when
 * null.
 */
export const exportFileName = (
  slug: string,
  seasonLabel: string | null,
  ext: ExportExtension,
  now: Date = new Date()
): string => {
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const parts = ["rowing-beacon", slugify(slug)];
  if (seasonLabel) parts.push(slugify(seasonLabel));
  parts.push(date);
  return `${parts.join("-")}.${ext}`;
};

export const notifySaved = (name: string, t: TFunction) =>
  toast.success(t("analytics.common.export.saved", { name }));

export const notifyFailed = (error: unknown, t: TFunction) =>
  toast.error(
    t("analytics.common.export.failed", {
      message: error instanceof Error ? error.message : String(error),
    })
  );
