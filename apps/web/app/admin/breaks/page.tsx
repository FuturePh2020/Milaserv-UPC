"use client";

import { useEffect, useState } from "react";
import { AdminShell } from "@/components/layout/admin-shell";
import { Card, Table, TableHeader, TableBody, TableRow, TableHead, TableCell, Badge, Button } from "@lcrm/ui";
import { api } from "@/lib/api-client";

interface LiveBreak {
  agentId: string;
  agentName: string;
  username: string;
  team: string | null;
  breakType: string;
  breakTypeColor: string;
  startedAt: string;
  currentDurationSeconds: number;
  totalTodaySeconds: number;
  sessionDurationSeconds: number | null;
  isAutomatic: boolean;
  wasOverridden: boolean;
}

function fmt(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

export default function LiveBreakMonitorPage() {
  const [breaks, setBreaks] = useState<LiveBreak[]>([]);

  async function load() {
    setBreaks(await api.get<LiveBreak[]>("/breaks/live-monitor"));
  }

  useEffect(() => {
    load().catch(() => undefined);
    const interval = setInterval(() => load().catch(() => undefined), 10000);
    return () => clearInterval(interval);
  }, []);

  async function endBreak(agentId: string) {
    await api.post(`/breaks/admin/${agentId}/end`);
    await load();
  }

  return (
    <AdminShell>
      <h1 className="text-xl font-semibold text-slate-900">Live Break Monitor</h1>
      <p className="text-sm text-slate-500">Auto-refreshes every 10 seconds</p>

      <Card className="mt-6">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Agent</TableHead>
              <TableHead>Team</TableHead>
              <TableHead>Break Type</TableHead>
              <TableHead>Current Duration</TableHead>
              <TableHead>Total Today</TableHead>
              <TableHead>Session</TableHead>
              <TableHead>Source</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {breaks.map((b) => (
              <TableRow key={b.agentId}>
                <TableCell className="font-medium">{b.agentName}</TableCell>
                <TableCell>{b.team ?? "-"}</TableCell>
                <TableCell>
                  <Badge style={{ background: `${b.breakTypeColor}22`, color: b.breakTypeColor }}>{b.breakType}</Badge>
                </TableCell>
                <TableCell>{fmt(b.currentDurationSeconds)}</TableCell>
                <TableCell>
                  <span className={b.totalTodaySeconds >= 3600 ? "text-red-600 font-medium" : "text-emerald-600 font-medium"}>
                    {fmt(b.totalTodaySeconds)}
                  </span>
                </TableCell>
                <TableCell>{b.sessionDurationSeconds !== null ? fmt(b.sessionDurationSeconds) : "-"}</TableCell>
                <TableCell>
                  {b.isAutomatic && <Badge variant="secondary">Auto</Badge>}
                  {b.wasOverridden && <Badge variant="warning">Override</Badge>}
                  {!b.isAutomatic && !b.wasOverridden && <Badge variant="outline">Manual</Badge>}
                </TableCell>
                <TableCell>
                  <Button size="sm" variant="outline" onClick={() => endBreak(b.agentId)}>
                    End break
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
