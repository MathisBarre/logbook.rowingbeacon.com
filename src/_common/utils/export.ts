import * as XLSX from "xlsx";
import { writeTextFile } from "@tauri-apps/plugin-fs";

export type ExportType = "xlsx" | "ods" | "json" | "csv";

export const exportSpreadsheet = (
  payload: { sheetName: string; jsonData: any[] }[],
  fileName: string,
  fileType: "xlsx" | "ods" = "xlsx"
) => {
  const wb = XLSX.utils.book_new();

  payload.forEach(({ sheetName, jsonData }) => {
    const ws = XLSX.utils.json_to_sheet(jsonData);

    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  });

  XLSX.writeFile(wb, `${fileName}.${fileType}`);
};

const saveTextFile = (args: { content: string; fileName: string }) => {
  return writeTextFile(args.fileName, args.content);
};

const getFullPath = (args: {
  data: any[];
  fileName: string;
  fileType: ExportType;
  fileDirectory: string;
}) => {
  return `${args.fileDirectory}/${args.fileName}.${args.fileType}`;
};

export const exportJson = (args: {
  data: any[];
  fileName: string;
  fileType: ExportType;
  fileDirectory: string;
}) => {
  const fullPath = getFullPath(args);
  const json = JSON.stringify(args.data, null, 2);

  return saveTextFile({
    content: json,
    fileName: fullPath,
  });
};

export const exportCsv = (args: {
  data: any[];
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
    fileName: fullPath,
  });
};

export const exportData = (args: {
  data: any[];
  fileName: string;
  fileType: ExportType;
  fileDirectory: string;
}) => {
  const { data, fileName, fileType } = args;

  if (fileType === "xlsx" || fileType === "ods") {
    return exportSpreadsheet(
      [{ sheetName: fileName, jsonData: data }],
      fileName,
      fileType
    );
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
