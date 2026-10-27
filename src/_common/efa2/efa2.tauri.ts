import { open, save } from "@tauri-apps/plugin-dialog";
import {
  readDir,
  readFile,
  readTextFile,
  writeFile,
} from "@tauri-apps/plugin-fs";
import { downloadDir, join } from "@tauri-apps/api/path";
import i18n from "../i18n/config";
import { closeDatabase, getDatabase } from "../database/database";
import { flushWrites } from "../database/writeQueue";
import { runBackup } from "../backup/backup.tauri";
import { windowPrompt } from "../utils/window.utils";
import {
  Efa2IncompleteProjectError,
  Efa2Project,
  Efa2SeveralProjectsError,
  readEfa2Project,
  readEfa2ProjectFromZip,
  withSingleZipExtension,
  writeEfa2BackupZip,
} from "./efa2Project";
import { Efa2FormatError } from "./efa2Xml";
import { planEfa2Import } from "./planEfa2Import";
import { Efa2ImportFailedError, runEfa2Import } from "./runEfa2Import";
import { buildEfa2Export } from "./buildEfa2Export";

const importLabels = () => ({
  externalBoatNote: i18n.t("efa2.externalBoatNote"),
  statusGroupPrefix: i18n.t("efa2.statusGroupPrefix"),
  closedOpenOutingNote: i18n.t("efa2.closedOpenOutingNote"),
});

/** efa2 data files only: rolling copies (.s0) and journals (.j0) are skipped. */
const DATA_FILE = /\.efa2[a-z]+$/;
const MAX_DEPTH = 3;

const readFolder = async (
  folder: string,
  prefix = "",
  depth = 0,
  files = new Map<string, string>()
) => {
  for (const entry of await readDir(folder)) {
    const path = await join(folder, entry.name);
    if (entry.name.startsWith(".")) continue;
    if (entry.isDirectory && depth < MAX_DEPTH) {
      await readFolder(path, `${prefix}${entry.name}/`, depth + 1, files);
    } else if (entry.isFile && DATA_FILE.test(entry.name)) {
      files.set(`${prefix}${entry.name}`, await readTextFile(path));
    }
  }
  return files;
};

/** Read a project, asking which one when the source holds several. */
const readChosenProject = async (
  read: (projectName?: string) => Efa2Project
): Promise<Efa2Project | null> => {
  try {
    return read();
  } catch (error) {
    if (!(error instanceof Efa2SeveralProjectsError)) throw error;
    for (;;) {
      const answer = await windowPrompt(
        i18n.t("efa2.chooseProject", { names: error.names.join(", ") }),
        error.names[0]
      );
      if (answer === null) return null;
      const name = error.names.find(
        (candidate) => candidate.toLowerCase() === answer.trim().toLowerCase()
      );
      if (name) return read(name);
    }
  }
};

/** What an import would bring, shown before the club confirms. */
export const previewEfa2Import = (project: Efa2Project) =>
  planEfa2Import({ project, labels: importLabels() }).report;

/**
 * Ask for an efa2 project: an efa backup ZIP, or efa's data folder (the
 * one holding the .efa2project file). Resolves with null when cancelled.
 * The import is planned once here, so a project it cannot handle is
 * reported now rather than when the preview opens.
 */
export const pickEfa2Project = async (
  source: "zip" | "folder"
): Promise<Efa2Project | null> => {
  let project: Efa2Project | null;
  if (source === "zip") {
    const path = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "efa2", extensions: ["zip"] }],
    });
    if (typeof path !== "string") return null;
    const zip = await readFile(path);
    project = await readChosenProject((name) =>
      readEfa2ProjectFromZip(zip, name)
    );
  } else {
    // The project files sit in subfolders: the granted scope must cover them.
    const folder = await open({
      multiple: false,
      directory: true,
      recursive: true,
    });
    if (typeof folder !== "string") return null;
    const files = await readFolder(folder);
    project = await readChosenProject((name) => readEfa2Project(files, name));
  }
  if (project) previewEfa2Import(project);
  return project;
};

/** Why a picked source could not be read, for the club. */
export const efa2ReadErrorMessage = (error: unknown) =>
  error instanceof Efa2IncompleteProjectError
    ? i18n.t("efa2.incompleteProject")
    : error instanceof Efa2FormatError
      ? i18n.t("efa2.notAProject")
      : // The files could not be read at all (access refused, unplugged…).
        i18n.t("efa2.readFailed", { reason: String(error) });

/** Replace the club data with the project (ADR 0004), after a backup. */
export const importEfa2Project = async (project: Efa2Project) => {
  const { db } = await getDatabase();
  await flushWrites();
  try {
    return await runEfa2Import(db, project, {
      backup: () => runBackup("before-import"),
      labels: importLabels(),
    });
  } catch (error) {
    // The caller reloads the app, which reopens the database.
    if (error instanceof Efa2ImportFailedError) await closeDatabase();
    throw error;
  }
};

/**
 * Write the club as an efa2 backup ZIP where the club chooses. Resolves
 * with null when cancelled.
 */
export const exportEfa2Project = async () => {
  const { db } = await getDatabase();
  await flushWrites();
  const { project, report } = await buildEfa2Export(db, {
    labels: {
      statuses: {
        member: i18n.t("efa2.status.member"),
        guest: i18n.t("efa2.status.guest"),
        other: i18n.t("efa2.status.other"),
      },
      defaultProjectName: i18n.t("efa2.defaultProjectName"),
      boathouseName: i18n.t("efa2.boathouseName"),
    },
  });
  // The club's local date, not UTC: just after midnight is still today.
  const today = new Date();
  const date = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, "0"),
    String(today.getDate()).padStart(2, "0"),
  ].join("-");
  const fileName = `efaBackup_${project.name}_${date}.zip`;
  const path = await save({
    defaultPath: await downloadDir()
      .then((folder) => join(folder, fileName))
      .catch(() => fileName),
    filters: [{ name: "efa2", extensions: ["zip"] }],
  });
  if (!path) return null;
  const zip = writeEfa2BackupZip(project, Date.now());
  const zipPath = withSingleZipExtension(path);
  // Outside the home folder, only the very path chosen may be written.
  const written = await writeFile(zipPath, zip).then(
    () => zipPath,
    () => writeFile(path, zip).then(() => path)
  );
  return { path: written, report };
};
