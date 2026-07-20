"use client";

import { useCallback, useEffect, useState } from "react";
import { AdminShell } from "@/components/layout/admin-shell";
import { Card, Table, TableHeader, TableBody, TableRow, TableHead, TableCell, Badge, Button, Select } from "@lcrm/ui";
import { api, downloadFile } from "@/lib/api-client";
import { useAutoRefresh } from "@/lib/use-auto-refresh";

interface RetentionCustomer {
  id: string;
  name: string;
  phone: string;
  orderType?: string | null;
  lastOrderNumber?: string | null;
  lastOrderDate?: string | null;
  lastDispensingDate?: string | null;
  nextRefillDate?: string | null;
  isActive: boolean;
  partner?: { name: string } | null;
  responsibleAgent?: { fullName: string } | null;
}

const WINDOWS = [
  { value: "TODAY", label: "Today" },
  { value: "OVERDUE", label: "Overdue" },
  { value: "TOMORROW", label: "Tomorrow" },
  { value: "WITHIN_7_DAYS", label: "Within 7 Days" },
];

export default function RetentionPage() {
  const [window, setWindow] = useState("WITHIN_7_DAYS");
  const [customers, setCustomers] = useState<RetentionCustomer[]>([]);

  const load = useCallback(async () => {
    const data = await api.get<RetentionCustomer[]>(`/retention/due?window=${window}`);
    setCustomers(data);
  }, [window]);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  useAutoRefresh("retention", load);

  return (
    <AdminShell>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Retention Follow-ups</h1>
          <p className="text-sm text-slate-500">{customers.length} customers due for refill</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={window} onChange={(e) => setWindow(e.target.value)} className="w-48">
            {WINDOWS.map((w) => (
              <option key={w.value} value={w.value}>
                {w.label}
              </option>
            ))}
          </Select>
          <Button variant="outline" onClick={() => downloadFile("/retention/export?format=xlsx", "retention-customers.xlsx")}>
            Export
          </Button>
        </div>
      </div>

      <Card className="mt-6">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Customer</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Partner</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Last Order</TableHead>
              <TableHead>Last Dispensing</TableHead>
              <TableHead>Next Refill</TableHead>
              <TableHead>Responsible Agent</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {customers.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium">{c.name}</TableCell>
                <TableCell>{c.phone}</TableCell>
                <TableCell>{c.partner?.name ?? "-"}</TableCell>
                <TableCell>{c.orderType ?? "-"}</TableCell>
                <TableCell>{c.lastOrderNumber ?? "-"}</TableCell>
                <TableCell>{c.lastDispensingDate ? new Date(c.lastDispensingDate).toLocaleDateString() : "-"}</TableCell>
                <TableCell>{c.nextRefillDate ? new Date(c.nextRefillDate).toLocaleDateString() : "-"}</TableCell>
                <TableCell>{c.responsibleAgent?.fullName ?? "-"}</TableCell>
                <TableCell>
                  <Badge variant={c.isActive ? "success" : "secondary"}>{c.isActive ? "Active" : "Inactive"}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </AdminShell>
  );
}
