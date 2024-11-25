import * as XLSX from "xlsx";
import { writeTextFile, writeFile } from "@tauri-apps/plugin-fs";

export type ExportType = "xlsx" | "ods" | "json" | "csv";

export const exportSpreadsheet = (args: {
  data: Record<string, string>[];
  fileName: string;
  fileType: "xlsx" | "ods";
  fileDirectory: string;
}) => {
  const wb = XLSX.utils.book_new();

  const ws = XLSX.utils.json_to_sheet(args.data);

  XLSX.utils.book_append_sheet(wb, ws, args.fileName);

  const file = new Uint8Array(
    XLSX.write(wb, {
      type: "array",
      bookType: args.fileType,
    })
  );

  const fullPath = getFullPath(args);

  return saveFile({
    file,
    fullPath,
  });
};

const saveFile = (args: { file: Uint8Array; fullPath: string }) => {
  return writeFile(args.fullPath, args.file);
};

const saveTextFile = (args: { content: string; fullPath: string }) => {
  return writeTextFile(args.fullPath, args.content);
};

const getFullPath = (args: {
  data: Record<string, string>[];
  fileName: string;
  fileType: ExportType;
  fileDirectory: string;
}) => {
  return `${args.fileDirectory}/${args.fileName}.${args.fileType}`;
};

export const exportJson = (args: {
  data: Record<string, string>[];
  fileName: string;
  fileType: ExportType;
  fileDirectory: string;
}) => {
  const fullPath = getFullPath(args);
  const json = JSON.stringify(args.data, null, 2);

  return saveTextFile({
    content: json,
    fullPath,
  });
};

export const exportCsv = (args: {
  data: Record<string, string>[];
  fileName: string;
  fileType: ExportType;
  fileDirectory: string;
}) => {
  const fullPath = getFullPath(args);

  const csvHeaders = Object.keys(args.data[0]).join(",");
  const csvValues = args.data
    .map((row) => Object.values(row).join(","))
    .join("\n");
  const csv = `${csvHeaders}\n${csvValues}`;

  return saveTextFile({
    content: csv,
    fullPath: fullPath,
  });
};

export const exportData = (args: {
  data: Record<string, string>[];
  fileName: string;
  fileType: ExportType;
  fileDirectory: string;
}) => {
  const { fileType } = args;

  if (fileType === "xlsx" || fileType === "ods") {
    return exportSpreadsheet({
      ...args,
      fileType,
    });
  }

  if (fileType === "json") {
    return exportJson(args);
  }

  if (fileType === "csv") {
    return exportCsv(args);
  }
};

export const getInfosFromPath = (filePath: string) => {
  const lastSlashIndex = filePath.lastIndexOf("/");
  const fileDirectory = filePath.slice(0, lastSlashIndex);

  const [fileName, fileType] = filePath.slice(lastSlashIndex + 1).split(".");

  return {
    fileName,
    fileType,
    fileDirectory,
  };
};
