"use client";

import { useEffect, useState } from "react";
import { AdminShell } from "@/components/layout/admin-shell";
import { Card, Table, TableHeader, TableBody, TableRow, TableHead, TableCell, Badge } from "@lcrm/ui";
import { api } from "@/lib/api-client";

interface AuditLog {
  id: string;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  ipAddress?: string | null;
  createdAt: string;
  user?: { username: string; fullName: string } | null;
}

export default function AuditLogsPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    api
      .get<{ items: AuditLog[]; total: number }>("/audit-logs?pageSize=100")
      .then((res) => {
        setLogs(res.items);
        setTotal(res.total);
      })
      .catch(() => undefined);
  }, []);

  return (
    <AdminShell>
      <h1 className="text-xl font-semibold text-slate-900">Audit Logs</h1>
      <p className="text-sm text-slate-500">{total} recorded events</p>

      <Card className="mt-6">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Action</TableHead>
              <TableHead>User</TableHead>
              <TableHead>Entity</TableHead>
              <TableHead>IP Address</TableHead>
              <TableHead>Time</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {logs.map((l) => (
              <TableRow key={l.id}>
                <TableCell>
                  <Badge variant="secondary">{l.action}</Badge>
                </TableCell>
                <TableCell>{l.user?.fullName ?? "System"}</TableCell>
                <TableCell>
                  {l.entityType ? `${l.entityType}${l.entityId ? ` #${l.entityId.slice(0, 8)}` : ""}` : "-"}
                </TableCell>
                <TableCell>{l.ipAddress ?? "-"}</TableCell>
                <TableCell>{new Date(l.createdAt).toLocaleString()}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </AdminShell>
  );
}
