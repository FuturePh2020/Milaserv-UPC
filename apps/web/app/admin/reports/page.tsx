"use client";

import { useState } from "react";
import { AdminShell } from "@/components/layout/admin-shell";
import { Card, CardHeader, CardTitle, CardContent, Button, Select, Label } from "@lcrm/ui";
import { downloadFile } from "@/lib/api-client";

const REPORTS = [
  { key: "lead-imports", label: "Lead Import Report" },
  { key: "lead-assignments", label: "Lead Assignment Report" },
  { key: "untouched-leads", label: "Untouched Leads Report" },
];

const UNTOUCHED_TYPES = [
  { value: "NO_ACTIVITY", label: "No activity within X minutes" },
  { value: "NO_CALL_MADE", label: "Assigned but no call made" },
  { value: "NO_STATUS_UPDATE", label: "Assigned but no status update" },
  { value: "NEVER_ASSIGNED", label: "Imported but never assigned" },
  { value: "RETURNED_WITHOUT_ACTION", label: "Returned to pool without action" },
];

export default function ReportsPage() {
  const [untouchedType, setUntouchedType] = useState("NO_ACTIVITY");
  const [ageMinutes, setAgeMinutes] = useState(60);

  function exportReport(key: string, format: "xlsx" | "csv") {
    let path = `/reports/${key}/export?format=${format}`;
    if (key === "untouched-leads") {
      path += `&type=${untouchedType}&ageMinutes=${ageMinutes}`;
    }
    downloadFile(path, `${key}.${format === "csv" ? "csv" : "xlsx"}`);
  }

  return (
    <AdminShell>
      <h1 className="text-xl font-semibold text-slate-900">Reports</h1>
      <p className="text-sm text-slate-500">Export operational reports to Excel or CSV</p>

      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
        {REPORTS.map((r) => (
          <Card key={r.key}>
            <CardHeader>
              <CardTitle>{r.label}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {r.key === "untouched-leads" && (
                <>
                  <div>
                    <Label>Definition</Label>
                    <Select value={untouchedType} onChange={(e) => setUntouchedType(e.target.value)}>
                      {UNTOUCHED_TYPES.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </Select>
                  </div>
                  {untouchedType === "NO_ACTIVITY" && (
                    <div>
                      <Label>Age (minutes)</Label>
                      <input
                        type="number"
                        className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                        value={ageMinutes}
                        onChange={(e) => setAgeMinutes(Number(e.target.value))}
                      />
                    </div>
                  )}
                </>
              )}
              <div className="flex gap-2">
                <Button size="sm" onClick={() => exportReport(r.key, "xlsx")}>
                  Export Excel
                </Button>
                <Button size="sm" variant="outline" onClick={() => exportReport(r.key, "csv")}>
                  Export CSV
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </AdminShell>
  );
}
