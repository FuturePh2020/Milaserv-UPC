/** Parses every sheet of an uploaded workbook into row objects keyed by
 *  header. Shared by DIC's staged-import wizard. */
export async function parseWorkbookRows(file: File): Promise<Record<string, unknown>[]> {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(await file.arrayBuffer());
  return wb.SheetNames.flatMap((name) => {
    const sheet = wb.Sheets[name];
    return sheet ? XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' }) : [];
  });
}
