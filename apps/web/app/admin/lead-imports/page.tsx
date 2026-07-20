"use client";

import { useEffect, useState } from "react";
import { AdminShell } from "@/components/layout/admin-shell";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Label,
  Select,
  Badge,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@lcrm/ui";
import { api, ApiError, downloadFile } from "@/lib/api-client";

interface Partner {
  id: string;
  name: string;
  requiredImportColumns: string[];
}
interface LeadCategory {
  id: string;
  name: string;
}
interface TaskItem {
  id: string;
  name: string;
}
interface Batch {
  id: string;
  fileName: string;
  status: string;
  totalRows: number;
  successRows: number;
  failedRows: number;
  duplicateRows: number;
  duplicateHandling: string;
  createdAt: string;
  partner: { name: string };
}

const CORE_FIELDS = [
  "customerName",
  "primaryPhone",
  "secondaryPhone",
  "nationalOrInsId",
  "city",
  "area",
  "address",
  "externalReference",
  "source",
  "notes",
];

export default function LeadImportsPage() {
  const [partners, setPartners] = useState<Partner[]>([]);
  const [categories, setCategories] = useState<LeadCategory[]>([]);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);

  const [partnerId, setPartnerId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [taskId, setTaskId] = useState("");
  const [duplicateHandling, setDuplicateHandling] = useState("MARK_FOR_REVIEW");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<{ headers: string[]; sampleRows: any[]; totalRowsDetected: number } | null>(
    null,
  );
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function loadRefData() {
    const [p, c, t, b] = await Promise.all([
      api.get<Partner[]>("/partners"),
      api.get<LeadCategory[]>("/lead-categories"),
      api.get<TaskItem[]>("/tasks"),
      api.get<Batch[]>("/lead-imports/batches"),
    ]);
    setPartners(p);
    setCategories(c);
    setTasks(t);
    setBatches(b);
  }

  useEffect(() => {
    loadRefData().catch(() => undefined);
  }, []);

  async function handlePreview() {
    if (!file || !partnerId) return;
    setMessage(null);
    const formData = new FormData();
    formData.append("file", file);
    formData.append("partnerId", partnerId);
    try {
      const result = await api.postForm<{ headers: string[]; sampleRows: any[]; totalRowsDetected: number }>(
        "/lead-imports/preview",
        formData,
      );
      setPreview(result);
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : "Preview failed");
    }
  }

  async function handleUpload() {
    if (!file || !partnerId || !categoryId) return;
    setBusy(true);
    setMessage(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("partnerId", partnerId);
      formData.append("categoryId", categoryId);
      if (taskId) formData.append("taskId", taskId);
      formData.append("mapping", JSON.stringify(mapping));
      formData.append("duplicateHandling", duplicateHandling);
      const batch = await api.postForm<Batch>("/lead-imports/batches", formData);
      setMessage(
        `Batch created: ${batch.successRows} valid rows, ${batch.failedRows} rejected. Review below then commit or cancel.`,
      );
      setPreview(null);
      setFile(null);
      await loadRefData();
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function commitBatch(id: string) {
    await api.post(`/lead-imports/batches/${id}/commit`);
    await loadRefData();
  }

  async function cancelBatch(id: string) {
    await api.post(`/lead-imports/batches/${id}/cancel`);
    await loadRefData();
  }

  return (
    <AdminShell>
      <h1 className="text-xl font-semibold text-slate-900">Lead Imports</h1>
      <p className="text-sm text-slate-500">Upload Excel/CSV lead sheets and map columns before importing</p>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>New Import</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <div>
              <Label>Partner</Label>
              <Select value={partnerId} onChange={(e) => setPartnerId(e.target.value)}>
                <option value="">Select partner</option>
                {partners.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Lead Category</Label>
              <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="">Select category</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Task</Label>
              <Select value={taskId} onChange={(e) => setTaskId(e.target.value)}>
                <option value="">None</option>
                {tasks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Duplicate Handling</Label>
              <Select value={duplicateHandling} onChange={(e) => setDuplicateHandling(e.target.value)}>
                <option value="SKIP">Skip</option>
                <option value="IMPORT">Import anyway</option>
                <option value="MARK_FOR_REVIEW">Mark for review</option>
              </Select>
            </div>
          </div>

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

          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={handlePreview} disabled={!file || !partnerId}>
              Preview
            </Button>
            <Button type="button" onClick={handleUpload} disabled={!file || !partnerId || !categoryId || busy}>
              {busy ? "Uploading..." : "Upload & Validate"}
            </Button>
          </div>

          {message && <p className="text-sm text-slate-700">{message}</p>}

          {preview && (
            <div className="mt-2">
              <p className="mb-2 text-sm font-medium text-slate-700">
                Map columns ({preview.totalRowsDetected} rows detected)
              </p>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                {CORE_FIELDS.map((field) => (
                  <div key={field}>
                    <Label className="text-xs">{field}</Label>
                    <Select
                      value={mapping[field] ?? ""}
                      onChange={(e) => setMapping({ ...mapping, [field]: e.target.value })}
                    >
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
          <CardTitle>Import Batches</CardTitle>
        </CardHeader>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>File</TableHead>
              <TableHead>Partner</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Rows</TableHead>
              <TableHead>Success</TableHead>
              <TableHead>Failed</TableHead>
              <TableHead>Duplicates</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {batches.map((b) => (
              <TableRow key={b.id}>
                <TableCell>{b.fileName}</TableCell>
                <TableCell>{b.partner.name}</TableCell>
                <TableCell>
                  <Badge variant={b.status === "COMPLETED" ? "success" : b.status === "FAILED" ? "destructive" : "secondary"}>
                    {b.status}
                  </Badge>
                </TableCell>
                <TableCell>{b.totalRows}</TableCell>
                <TableCell>{b.successRows}</TableCell>
                <TableCell>{b.failedRows}</TableCell>
                <TableCell>{b.duplicateRows}</TableCell>
                <TableCell className="flex gap-2">
                  {b.status === "PENDING" && (
                    <>
                      <Button size="sm" onClick={() => commitBatch(b.id)}>
                        Commit
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => cancelBatch(b.id)}>
                        Cancel
                      </Button>
                    </>
                  )}
                  {b.failedRows > 0 && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => downloadFile(`/lead-imports/batches/${b.id}/rejected-rows/export`, `rejected-${b.id}.xlsx`)}
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
