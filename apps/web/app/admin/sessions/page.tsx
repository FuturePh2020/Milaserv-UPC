"use client";

import { useEffect, useState } from "react";
import { AdminShell } from "@/components/layout/admin-shell";
import { Card, Table, TableHeader, TableBody, TableRow, TableHead, TableCell, Button } from "@lcrm/ui";
import { api } from "@/lib/api-client";

interface ActiveSession {
  id: string;
  startedAt: string;
  user: { fullName: string; username: string; currentAgentStatus: string; team?: { name: string } | null };
}

export default function SessionsPage() {
  const [sessions, setSessions] = useState<ActiveSession[]>([]);

  async function load() {
    setSessions(await api.get<ActiveSession[]>("/sessions/admin/active"));
  }

  useEffect(() => {
    load().catch(() => undefined);
    const interval = setInterval(() => load().catch(() => undefined), 15000);
    return () => clearInterval(interval);
  }, []);

  async function endSession(id: string) {
    await api.post(`/sessions/admin/${id}/end`);
    await load();
  }

  return (
    <AdminShell>
      <h1 className="text-xl font-semibold text-slate-900">Active Sessions</h1>
      <p className="text-sm text-slate-500">Agents currently signed into a work session</p>

      <Card className="mt-6">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Agent</TableHead>
              <TableHead>Team</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Started At</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {sessions.map((s) => (
              <TableRow key={s.id}>
                <TableCell className="font-medium">{s.user.fullName}</TableCell>
                <TableCell>{s.user.team?.name ?? "-"}</TableCell>
                <TableCell>{s.user.currentAgentStatus}</TableCell>
                <TableCell>{new Date(s.startedAt).toLocaleTimeString()}</TableCell>
                <TableCell>
                  <Button size="sm" variant="outline" onClick={() => endSession(s.id)}>
                    End session
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </AdminShell>
  );
}
