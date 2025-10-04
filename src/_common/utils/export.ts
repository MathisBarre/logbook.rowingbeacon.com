import * as XLSX from "xlsx";
import { writeTextFile, writeFile, BaseDirectory } from "@tauri-apps/plugin-fs";

export type ExportType = "xlsx" | "ods" | "json" | "csv";

export const exportData = (args: {
  data: Record<string, string>[];
  fileName: string;
  fileType: ExportType;
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

const exportSpreadsheet = (args: {
  data: Record<string, string | Date>[];
  fileName: string;
  fileType: "xlsx" | "ods";
}) => {
  const wb = XLSX.utils.book_new();

  const data = args.data.map((row) => {
    return {
      ...row,
      start_date_time: row.start_date_time
        ? new Date(row.start_date_time)
        : null,
      estimated_end_date_time: row.estimated_end_date_time
        ? new Date(row.estimated_end_date_time)
        : null,
      end_date_time: row.end_date_time ? new Date(row.end_date_time) : null,
    };
  });

  const ws = XLSX.utils.json_to_sheet(data, {
    cellDates: true,
  });

  XLSX.utils.book_append_sheet(wb, ws);

  const file = new Uint8Array(
    XLSX.write(wb, {
      type: "array",
      bookType: args.fileType,
    })
  );

  return saveFile({
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    file,
    fileName: args.fileName,
  });
};

const saveFile = (args: { file: Uint8Array; fileName: string }) => {
  return writeFile(args.fileName, args.file, {
    baseDir: BaseDirectory.Download,
  });
};

const saveTextFile = (args: { content: string; fileName: string }) => {
  return writeTextFile(args.fileName, args.content, {
    baseDir: BaseDirectory.Download,
  });
};

const exportJson = (args: {
  data: Record<string, string>[];
  fileName: string;
  fileType: ExportType;
}) => {
  const json = JSON.stringify(args.data, null, 2);

  return saveTextFile({
    content: json,
    fileName: args.fileName,
  });
};

const exportCsv = (args: {
  data: Record<string, string>[];
  fileName: string;
  fileType: ExportType;
}) => {
  const csvHeaders = Object.keys(args.data[0]).join(",");
  const csvValues = args.data
    .map((row) => Object.values(row).join(","))
    .join("\n");
  const csv = `${csvHeaders}\n${csvValues}`;

  return saveTextFile({
    content: csv,
    fileName: args.fileName,
  });
};
