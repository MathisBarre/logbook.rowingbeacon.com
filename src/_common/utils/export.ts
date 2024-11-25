import * as XLSX from "xlsx";

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

const downloadBlob = (blob: Blob, fileName: string) => {
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
};

export const exportJson = (data: any[], fileName: string) => {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  downloadBlob(blob, `${fileName}.json`);
};

export const exportCsv = (data: any[], fileName: string) => {
  const csv = data.map((row) => Object.values(row).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  downloadBlob(blob, `${fileName}.csv`);
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
    return exportJson(data, fileName);
  }

  if (fileType === "csv") {
    return exportCsv(data, fileName);
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
