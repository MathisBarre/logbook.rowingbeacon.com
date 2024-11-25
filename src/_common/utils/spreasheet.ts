import * as XLSX from "xlsx";

export const generateSpreadsheet = (
  payload: { sheetName: string; jsonData: any[] }[],
  fileName: string,
  fileType: "xlsx" | "ods" = "xlsx"
) => {
  // Create workbook
  const wb = XLSX.utils.book_new();

  payload.forEach(({ sheetName, jsonData }) => {
    // Convert JSON to worksheet
    const ws = XLSX.utils.json_to_sheet(jsonData);

    // Add worksheet to workbook
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  });

  // Generate file with specified format
  XLSX.writeFile(wb, `${fileName}.${fileType}`);
};
