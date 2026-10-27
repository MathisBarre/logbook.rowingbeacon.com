import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import {
  Efa2Fields,
  Efa2FormatError,
  escapeXml,
  parseEfa2File,
  serializeEfa2File,
} from "./efa2Xml";

/**
 * An efa2 project: the `<name>.efa2project` file plus one data file per
 * storage object in the `<name>/` folder next to it. Logbooks and clubwork
 * books are one file each, named after the book.
 */
export interface Efa2StorageObject {
  /** efa2 storage type, e.g. "efa2boats" or "efa2logbook". */
  type: string;
  /** Object name: "boats", or the logbook name such as "2026". */
  name: string;
  header: Efa2Fields;
  records: Efa2Fields[];
}

export interface Efa2Project {
  name: string;
  /** Records of the .efa2project file (Project, Club, Boathouse, Logbook…). */
  projectRecords: Efa2Fields[];
  objects: Efa2StorageObject[];
  /**
   * Labels of custom session types, from efa's `cfg/types.efa2types` when
   * the source has it (a backup ZIP does); the project only stores keys.
   */
  sessionTypeLabels: Record<string, string>;
}

export const EFA2_PROJECT_EXTENSION = ".efa2project";

const basename = (path: string) => path.split("/").pop() ?? path;
const dirname = (path: string) =>
  path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";

/** efa2 keeps rolling copies (.s0, .s1) and journals (.j0…) next to each file. */
/** efa2 data files, apart from hidden ones (macOS "._" copies on a USB key). */
const isDataFile = (path: string) =>
  !basename(path).startsWith(".") && /\.efa2[a-z]+$/.test(path);

/**
 * Objects without which an import would wipe the club: a partial efa
 * backup, or the wrong folder.
 */
export const EFA2_REQUIRED_OBJECTS = ["efa2boats", "efa2persons"];

export class Efa2IncompleteProjectError extends Efa2FormatError {
  constructor(readonly missing: string[]) {
    super(`efa2 project without ${missing.join(", ")}`);
  }
}

/** A data folder holding several projects: the club has to pick one. */
export class Efa2SeveralProjectsError extends Efa2FormatError {
  constructor(readonly names: string[]) {
    super(`Several efa2 projects: ${names.join(", ")}`);
  }
}

/**
 * Read a project from its files, keyed by path relative to any root (a
 * data folder, or the inside of an efa2 backup ZIP).
 */
export const readEfa2Project = (
  files: Map<string, string>,
  /** Which project to read when the files hold several. */
  projectName?: string
): Efa2Project => {
  const paths = [...files.keys()]
    .map((path) => path.replace(/\\/g, "/"))
    .filter(isDataFile);
  const normalized = new Map(
    [...files.entries()].map(([path, text]) => [path.replace(/\\/g, "/"), text])
  );

  const projectPaths = paths.filter((path) =>
    path.endsWith(EFA2_PROJECT_EXTENSION)
  );
  if (projectPaths.length === 0) {
    throw new Efa2FormatError("No .efa2project file found");
  }
  const nameOfProjectFile = (path: string) =>
    basename(path).slice(0, -EFA2_PROJECT_EXTENSION.length);
  // Shallowest first: a data folder may hold several projects, a backup one.
  const depth = (path: string) => path.split("/").length;
  const shallowest = Math.min(...projectPaths.map(depth));
  const candidates = projectPaths.filter((path) => depth(path) === shallowest);
  const projectPath =
    projectName === undefined
      ? candidates.length === 1
        ? candidates[0]
        : undefined
      : projectPaths.find((path) => nameOfProjectFile(path) === projectName);
  if (!projectPath) {
    throw new Efa2SeveralProjectsError(
      candidates.map(nameOfProjectFile).sort()
    );
  }
  const name = nameOfProjectFile(projectPath);
  const projectFile = parseEfa2File(normalized.get(projectPath) ?? "");

  const folder = [dirname(projectPath), name].filter(Boolean).join("/") + "/";
  const objects = paths
    .filter(
      (path) =>
        path.startsWith(folder) && !path.slice(folder.length).includes("/")
    )
    .map((path) => ({ path, file: parseEfa2File(normalized.get(path) ?? "") }))
    // efa names each file after its object: "2026 - Kopie.efa2logbook" is a
    // copy left by hand, which would clash with the real "2026".
    .filter(
      ({ path, file }) =>
        !file.header.name ||
        !file.header.type ||
        basename(path) === `${file.header.name}.${file.header.type}`
    )
    .map(({ path, file }) => {
      const fileName = basename(path);
      const extension = fileName.slice(fileName.lastIndexOf(".") + 1);
      return {
        type: file.header.type || extension,
        name: file.header.name || fileName.slice(0, fileName.lastIndexOf(".")),
        header: file.header,
        records: file.records,
      };
    });

  const sessionTypeLabels: Record<string, string> = {};
  const typesPath = paths.find((path) => path.endsWith("types.efa2types"));
  if (typesPath) {
    for (const record of parseEfa2File(normalized.get(typesPath) ?? "")
      .records) {
      if (record.Category === "SESSION" && record.Type && record.Value) {
        sessionTypeLabels[record.Type] = record.Value;
      }
    }
  }

  // efa writes every file, even empty: a list without records is missing too.
  const missing = EFA2_REQUIRED_OBJECTS.filter(
    (type) =>
      !objects.some(
        (object) =>
          object.type === type && object.records.some((record) => record.Id)
      )
  );
  if (missing.length > 0) throw new Efa2IncompleteProjectError(missing);

  return {
    name,
    projectRecords: projectFile.records,
    objects,
    sessionTypeLabels,
  };
};

export const readEfa2ProjectFromZip = (
  zip: Uint8Array,
  projectName?: string
): Efa2Project => {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(zip, { filter: (file) => isDataFile(file.name) });
  } catch {
    throw new Efa2FormatError("Not a readable ZIP file");
  }
  return readEfa2Project(
    new Map(
      Object.entries(entries).map(([path, content]) => [
        path,
        strFromU8(content),
      ])
    ),
    projectName
  );
};

export const findObject = (project: Efa2Project, type: string) =>
  project.objects.find((object) => object.type === type);

export const findObjects = (project: Efa2Project, type: string) =>
  project.objects.filter((object) => object.type === type);

const DESCRIPTIONS: Record<string, string> = {
  efa2project: "Project",
  efa2boats: "Boats",
  efa2persons: "Persons",
  efa2status: "Status",
  efa2groups: "Groups",
  efa2crews: "Crews",
  efa2destinations: "Destinations",
  efa2waters: "Waters",
  efa2boatstatus: "Boat Status",
  efa2boatdamages: "Boat Damages",
  efa2boatreservations: "Boat Reservations",
  efa2messages: "Messages",
  efa2sessiongroups: "Session Groups",
  efa2fahrtenabzeichen: "Fahrtenabzeichen",
  efa2statistics: "Statistics",
  efa2autoincrement: "AutoIncrement",
  efa2logbook: "Logbook",
  efa2clubwork: "Clubwork",
};

const header = (name: string, type: string, scn: number): Efa2Fields => ({
  program: "efa",
  version: "2.5.3_17",
  name,
  type,
  scn: String(scn),
});

/**
 * Write a project as an efa2 backup ZIP: efa2 can restore it, or it can
 * be unzipped into efa's data folder. `backup.meta` lists each object with
 * its record count and change number, which efa2 checks on restore.
 */
/**
 * The macOS save panel keeps ".zip" after the selected name, so typing
 * "club.zip" there gives "club.zip.zip": efa would not list that file.
 */
export const withSingleZipExtension = (path: string) =>
  path.replace(/(\.zip)+$/i, ".zip");

export const writeEfa2BackupZip = (
  project: Efa2Project,
  timestamp: number
): Uint8Array => {
  const files: Record<string, Uint8Array> = {};
  const meta: string[] = [];

  const add = (
    path: string,
    name: string,
    type: string,
    records: Efa2Fields[]
  ) => {
    const scn = Math.max(records.length, 1);
    files[path] = strToU8(
      serializeEfa2File({ header: header(name, type, scn), records })
    );
    meta.push(
      [
        "  <Object>",
        `    <Name>${escapeXml(name)}</Name>`,
        `    <Type>${type}</Type>`,
        `    <FileName>${escapeXml(path)}</FileName>`,
        `    <Description>${DESCRIPTIONS[type] ?? type}</Description>`,
        `    <Records>${records.length}</Records>`,
        `    <Scn>${scn}</Scn>`,
        "  </Object>",
      ].join("\n")
    );
  };

  add(
    `data/${project.name}${EFA2_PROJECT_EXTENSION}`,
    project.name,
    "efa2project",
    project.projectRecords
  );
  for (const object of project.objects) {
    add(
      `data/${project.name}/${object.name}.${object.type}`,
      object.name,
      object.type,
      object.records
    );
  }

  files["backup.meta"] = strToU8(
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      "<EfaBackup>",
      `  <TimeStamp>${timestamp}</TimeStamp>`,
      `  <ProjectName>${escapeXml(project.name)}</ProjectName>`,
      ...meta,
      "</EfaBackup>",
      "",
    ].join("\n")
  );

  return zipSync(files, { level: 6 });
};
