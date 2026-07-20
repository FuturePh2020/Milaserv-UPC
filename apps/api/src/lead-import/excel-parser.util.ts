import * as ExcelJS from "exceljs";

export interface ParsedSheet {
  headers: string[];
  rows: Record<string, string>[];
}

/** Parses xlsx/xls/csv buffers into header + row-object form. */
export async function parseSpreadsheet(buffer: Buffer, fileName: string): Promise<ParsedSheet> {
  const workbook = new ExcelJS.Workbook();
  const isCsv = fileName.toLowerCase().endsWith(".csv");

  if (isCsv) {
    const stream = require("stream");
    const readable = new stream.Readable();
    readable.push(buffer);
    readable.push(null);
    await workbook.csv.read(readable);
  } else {
    await workbook.xlsx.load(buffer as any);
  }

  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    return { headers: [], rows: [] };
  }

  const headerRow = worksheet.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    headers[colNumber - 1] = String(cell.value ?? "").trim();
  });

  const rows: Record<string, string>[] = [];
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const obj: Record<string, string> = {};
    let hasValue = false;
    headers.forEach((header, idx) => {
      if (!header) return;
      const cell = row.getCell(idx + 1);
      let value = cell.value;
      if (value && typeof value === "object" && "text" in (value as any)) {
        value = (value as any).text;
      }
      if (value && typeof value === "object" && "result" in (value as any)) {
        value = (value as any).result;
      }
      const strValue = value === null || value === undefined ? "" : String(value).trim();
      if (strValue) hasValue = true;
      obj[header] = strValue;
    });
    if (hasValue) rows.push(obj);
  });

  return { headers, rows };
}

export async function buildRejectedRowsWorkbook(
  rows: { rowNumber: number; rawData: Record<string, unknown>; reasons: string[] }[],
): Promise<ExcelJS.Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Rejected Rows");

  const dataColumns = rows.length > 0 ? Object.keys(rows[0].rawData) : [];
  sheet.columns = [
    { header: "Row #", key: "rowNumber", width: 10 },
    ...dataColumns.map((c) => ({ header: c, key: c, width: 20 })),
    { header: "Rejection Reasons", key: "reasons", width: 40 },
  ];

  rows.forEach((r) => {
    sheet.addRow({ rowNumber: r.rowNumber, ...r.rawData, reasons: r.reasons.join("; ") });
  });

  return workbook.xlsx.writeBuffer();
}
