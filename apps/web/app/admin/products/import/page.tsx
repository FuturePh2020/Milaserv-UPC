"use client";

import { useEffect, useState } from "react";
import { AdminShell } from "@/components/layout/admin-shell";
import { Button, Card, CardHeader, CardTitle, CardContent, Label, Select, Badge, Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@lcrm/ui";
import { api, ApiError, downloadFile } from "@/lib/api-client";

interface Batch {
  id: string;
  fileName: string;
  status: string;
  behavior: string;
  totalRows: number;
  createdRows: number;
  updatedRows: number;
  skippedRows: number;
  rejectedRows: number;
  createdAt: string;
}

const IMPORT_FIELDS = [
  "itemCode",
  "barcode",
  "arabicName",
  "englishName",
  "scientificName",
  "activeIngredient",
  "defaultPrice",
  "currency",
  "cashAvailable",
  "insuranceAvailable",
  "isActive",
  "notes",
];

const BEHAVIORS = [
  { value: "CREATE_ONLY", label: "Create new Items only" },
  { value: "UPDATE_BY_CODE", label: "Update existing Items using Item Code" },
  { value: "UPDATE_BY_BARCODE", label: "Update existing Items using Barcode" },
  { value: "CREATE_AND_UPDATE", label: "Create new and update existing" },
  { value: "SKIP_DUPLICATES", label: "Skip duplicates" },
  { value: "REJECT_DUPLICATES", label: "Reject duplicates" },
];

export default function ProductImportPage() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<{ headers: string[]; sampleRows: any[]; totalRowsDetected: number } | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [behavior, setBehavior] = useState("CREATE_AND_UPDATE");
  const [batches, setBatches] = useState<Batch[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function loadBatches() {
    setBatches(await api.get<Batch[]>("/products/import/batches"));
  }

  useEffect(() => {
    loadBatches().catch(() => undefined);
  }, []);

  async function handlePreview() {
    if (!file) return;
    setMessage(null);
    const formData = new FormData();
    formData.append("file", file);
    try {
      setPreview(await api.postForm("/products/import/preview", formData));
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : "Preview failed");
    }
  }

  async function handleCommit() {
    if (!file) return;
    setBusy(true);
    setMessage(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("mapping", JSON.stringify(mapping));
      formData.append("behavior", behavior);
      const batch = await api.postForm<Batch>("/products/import/commit", formData);
      setMessage(`Import complete: ${batch.createdRows} created, ${batch.updatedRows} updated, ${batch.skippedRows} skipped, ${batch.rejectedRows} rejected.`);
      setFile(null);
      setPreview(null);
      await loadBatches();
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminShell>
      <h1 className="text-xl font-semibold text-slate-900">Import Products &amp; Items</h1>
      <p className="text-sm text-slate-500">Upload an Excel/CSV file to bulk create or update the item catalog</p>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>New Import</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div>
            <Label>File (.xlsx, .xls, .csv)</Label>
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setPreview(null);
              }}
              className="mt-1 block text-sm"
            />
          </div>
          <div>
            <Label>Import Behavior</Label>
            <Select value={behavior} onChange={(e) => setBehavior(e.target.value)} className="max-w-md">
              {BEHAVIORS.map((b) => (
                <option key={b.value} value={b.value}>
                  {b.label}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={handlePreview} disabled={!file}>
              Preview
            </Button>
            <Button type="button" onClick={handleCommit} disabled={!file || busy}>
              {busy ? "Importing..." : "Import"}
            </Button>
          </div>

          {message && <p className="text-sm text-slate-700">{message}</p>}

          {preview && (
            <div>
              <p className="mb-2 text-sm font-medium text-slate-700">Map columns ({preview.totalRowsDetected} rows detected)</p>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {IMPORT_FIELDS.map((field) => (
                  <div key={field}>
                    <Label className="text-xs">{field}</Label>
                    <Select value={mapping[field] ?? ""} onChange={(e) => setMapping({ ...mapping, [field]: e.target.value })}>
                      <option value="">Not mapped</option>
                      {preview.headers.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </Select>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Import History</CardTitle>
        </CardHeader>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>File</TableHead>
              <TableHead>Behavior</TableHead>
              <TableHead>Total</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Updated</TableHead>
              <TableHead>Skipped</TableHead>
              <TableHead>Rejected</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {batches.map((b) => (
              <TableRow key={b.id}>
                <TableCell>{b.fileName}</TableCell>
                <TableCell>
                  <Badge variant="secondary">{b.behavior}</Badge>
                </TableCell>
                <TableCell>{b.totalRows}</TableCell>
                <TableCell>{b.createdRows}</TableCell>
                <TableCell>{b.updatedRows}</TableCell>
                <TableCell>{b.skippedRows}</TableCell>
                <TableCell>{b.rejectedRows}</TableCell>
                <TableCell>
                  {b.rejectedRows > 0 && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => downloadFile(`/products/import/batches/${b.id}/rejected-rows/export`, `rejected-products-${b.id}.xlsx`)}
                    >
                      Rejected rows
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </AdminShell>
  );
}
