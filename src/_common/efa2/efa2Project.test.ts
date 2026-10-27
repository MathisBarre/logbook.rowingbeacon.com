import { describe, expect, test } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import {
  Efa2IncompleteProjectError,
  Efa2SeveralProjectsError,
  findObject,
  findObjects,
  readEfa2Project,
  readEfa2ProjectFromZip,
  withSingleZipExtension,
  writeEfa2BackupZip,
} from "./efa2Project";
import {
  Efa2FormatError,
  parseEfa2File,
  serializeEfa2File,
} from "./efa2Xml";
import { readFixtureProject } from "./__fixtures__/readFixtureProject";

describe("efa2 project files", () => {
  test("reads every storage object of a backup ZIP made by efa", () => {
    const project = readFixtureProject();

    expect(project.name).toBe("TestClub");
    expect(project.projectRecords.map((r) => r.Type).sort()).toEqual([
      "Boathouse",
      "Club",
      "ClubworkBook",
      "Logbook",
      "Logbook",
      "Project",
    ]);
    expect(findObject(project, "efa2boats")?.records).toHaveLength(13);
    expect(findObject(project, "efa2persons")?.records).toHaveLength(30);
    expect(
      findObjects(project, "efa2logbook")
        .map((l) => l.name)
        .sort()
    ).toEqual(["2025", "2026"]);
    expect(project.sessionTypeLabels.NORMAL).toBe("normale Fahrt");
  });

  test("keeps empty fields and unescapes text", () => {
    const file = parseEfa2File(
      "<efa><header><type>efa2boats</type></header><data><record><Name>A &amp; B</Name><TypeDescription></TypeDescription><X/></record></data></efa>"
    );
    expect(file.records[0]).toEqual({
      Name: "A & B",
      TypeDescription: "",
      X: "",
    });
  });

  test("writes files that read back identically", () => {
    const project = readFixtureProject();
    const boats = findObject(project, "efa2boats")!;
    const again = parseEfa2File(
      serializeEfa2File({ header: boats.header, records: boats.records })
    );
    expect(again.records).toEqual(boats.records);
  });

  test("a written backup ZIP reads back as the same project", () => {
    const project = readFixtureProject();
    const zip = writeEfa2BackupZip(project, 0);
    const again = readEfa2ProjectFromZip(zip);

    expect(again.projectRecords).toEqual(project.projectRecords);
    expect(
      again.objects.map((o) => [o.type, o.name, o.records.length]).sort()
    ).toEqual(
      project.objects.map((o) => [o.type, o.name, o.records.length]).sort()
    );
  });

  test("refuses a project without boats or persons", () => {
    const project = readFixtureProject();
    project.objects = project.objects.filter((o) => o.type !== "efa2persons");
    expect(() =>
      readEfa2ProjectFromZip(writeEfa2BackupZip(project, 0))
    ).toThrow(Efa2IncompleteProjectError);
  });

  test("refuses a project whose boats or persons list is empty", () => {
    const project = readFixtureProject();
    project.objects.find((o) => o.type === "efa2boats")!.records = [];
    expect(() =>
      readEfa2ProjectFromZip(writeEfa2BackupZip(project, 0))
    ).toThrow(Efa2IncompleteProjectError);
  });

  test("ignores hand-made copies and macOS hidden files", () => {
    const zip = unzipSync(writeEfa2BackupZip(readFixtureProject(), 0));
    const files = new Map<string, string>();
    for (const [path, content] of Object.entries(zip)) {
      files.set(path, strFromU8(content));
      if (path.endsWith("/2026.efa2logbook")) {
        files.set(path.replace("2026.", "2026 - Kopie."), strFromU8(content));
      }
      if (path.endsWith(".efa2project") || path.endsWith("boats.efa2boats")) {
        const parts = path.split("/");
        parts.push(`._${parts.pop()}`);
        files.set(parts.join("/"), "\u0000\u0005binary");
      }
    }
    const project = readEfa2Project(files);
    expect(project.name).toBe("TestClub");
    expect(findObjects(project, "efa2logbook").map((l) => l.name).sort()).toEqual(
      ["2025", "2026"]
    );
  });

  test("a damaged ZIP or character is not a crash", () => {
    expect(() => readEfa2ProjectFromZip(new Uint8Array([1, 2, 3]))).toThrow(
      Efa2FormatError
    );
    expect(
      parseEfa2File(
        "<efa><data><record><Name>&#x110000;</Name></record></data></efa>"
      ).records[0].Name
    ).toBe("&#x110000;");
  });

  test("characters XML forbids are not written", () => {
    const xml = serializeEfa2File({
      header: { type: "efa2boats" },
      records: [{ Name: "Hiron\u0007delle" }],
    });
    expect(parseEfa2File(xml).records[0].Name).toBe("Hirondelle");
  });

  test("asks which project to read when a folder holds several", () => {
    const zip = unzipSync(writeEfa2BackupZip(readFixtureProject(), 0));
    const files = new Map<string, string>();
    for (const [path, content] of Object.entries(zip)) {
      files.set(path, strFromU8(content));
      if (path.startsWith("data/TestClub")) {
        files.set(
          path.replace("data/TestClub", "data/Other"),
          strFromU8(content)
        );
      }
    }
    let error: unknown;
    try {
      readEfa2Project(files);
    } catch (thrown) {
      error = thrown;
    }
    expect(error).toBeInstanceOf(Efa2SeveralProjectsError);
    expect((error as Efa2SeveralProjectsError).names).toEqual([
      "Other",
      "TestClub",
    ]);
    expect(readEfa2Project(files, "Other").name).toBe("Other");
  });
});

describe("efa2 export file name", () => {
  test("keeps a single .zip when the name typed already ends with it", () => {
    expect(withSingleZipExtension("/Users/a/club.zip.zip")).toBe(
      "/Users/a/club.zip"
    );
    expect(withSingleZipExtension("/Users/a/club.ZIP.zip")).toBe(
      "/Users/a/club.zip"
    );
    expect(withSingleZipExtension("/Users/a/club.zip")).toBe(
      "/Users/a/club.zip"
    );
    expect(withSingleZipExtension("/Users/a/club")).toBe("/Users/a/club");
  });
});
