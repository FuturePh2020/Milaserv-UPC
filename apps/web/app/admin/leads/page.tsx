"use client";

import { useEffect, useState } from "react";
import { AdminShell } from "@/components/layout/admin-shell";
import { Card, Badge, Table, TableHeader, TableBody, TableRow, TableHead, TableCell, Button, Select } from "@lcrm/ui";
import { api } from "@/lib/api-client";

interface Lead {
  id: string;
  customerName: string;
  primaryPhone: string;
  workflowStatus: string;
  assignmentStatus: string;
  partner: { name: string };
  category: { name: string };
  task?: { name: string } | null;
  importedAt: string;
}

export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState("");

  async function load() {
    const params = new URLSearchParams();
    if (status) params.set("workflowStatus", status);
    const result = await api.get<{ items: Lead[]; total: number }>(`/leads?${params.toString()}`);
    setLeads(result.items);
    setTotal(result.total);
  }

  useEffect(() => {
    load().catch(() => undefined);
  }, [status]);

  async function returnToPool(id: string) {
    const reason = window.prompt("Reason for returning this lead to the pool?") || "";
    await api.post(`/leads/${id}/return-to-pool`, { reason });
    await load();
  }

  return (
    <AdminShell>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Leads</h1>
          <p className="text-sm text-slate-500">{total} total leads</p>
        </div>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-56">
          <option value="">All statuses</option>
          {[
            "NEW",
            "ASSIGNED",
            "IN_PROGRESS",
            "CONTACTED",
            "CALLBACK_REQUIRED",
            "INVALID_NUMBER",
            "NOT_INTERESTED",
            "INTERESTED",
            "CONVERTED",
            "COMPLETED",
            "ESCALATED",
            "UNREACHABLE",
            "RETURNED_TO_POOL",
            "DUPLICATE",
          ].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
      </div>

      <Card className="mt-6">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Customer</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Partner</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Task</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Assignment</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {leads.map((l) => (
              <TableRow key={l.id}>
                <TableCell className="font-medium">{l.customerName}</TableCell>
                <TableCell>{l.primaryPhone}</TableCell>
                <TableCell>{l.partner.name}</TableCell>
                <TableCell>{l.category.name}</TableCell>
                <TableCell>{l.task?.name ?? "-"}</TableCell>
                <TableCell>
                  <Badge variant="secondary">{l.workflowStatus}</Badge>
                </TableCell>
                <TableCell>{l.assignmentStatus}</TableCell>
                <TableCell>
                  {l.assignmentStatus !== "UNASSIGNED" && (
                    <Button size="sm" variant="outline" onClick={() => returnToPool(l.id)}>
                      Return to pool
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
