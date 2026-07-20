"use client";

import { useEffect, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { AdminShell } from "@/components/layout/admin-shell";
import { KpiCard } from "@/components/kpi-card";
import { Card, CardHeader, CardTitle, CardContent } from "@lcrm/ui";
import { api } from "@/lib/api-client";

interface AdminSummary {
  totalLeads: number;
  assignedLeads: number;
  remainingLeads: number;
  completedLeads: number;
  insuranceLeads: number;
  cashLeads: number;
  activeAgents: number;
  availableAgents: number;
  agentsOnCalls: number;
  agentsOnBreak: number;
  offlineAgents: number;
  totalOutboundCalls: number;
  answeredCalls: number;
  busyCalls: number;
  noAnswerCalls: number;
  abandonedCalls: number;
  averageAht: number;
  conversionRate: number;
}

export default function AdminDashboardPage() {
  const [summary, setSummary] = useState<AdminSummary | null>(null);
  const [byPartner, setByPartner] = useState<{ partner: string; count: number }[]>([]);
  const [byStatus, setByStatus] = useState<{ status: string; count: number }[]>([]);

  useEffect(() => {
    api.get<AdminSummary>("/dashboard/admin/summary").then(setSummary).catch(() => undefined);
    api
      .get<{ partner: string; count: number }[]>("/dashboard/admin/charts/leads-by-partner")
      .then(setByPartner)
      .catch(() => undefined);
    api
      .get<{ status: string; count: number }[]>("/dashboard/admin/charts/leads-by-status")
      .then(setByStatus)
      .catch(() => undefined);
  }, []);

  return (
    <AdminShell>
      <h1 className="text-xl font-semibold text-slate-900">Admin Dashboard</h1>
      <p className="text-sm text-slate-500">Live overview of leads, agents, and calls</p>

      <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <KpiCard label="Total Leads" value={summary?.totalLeads ?? "-"} />
        <KpiCard label="Assigned Leads" value={summary?.assignedLeads ?? "-"} />
        <KpiCard label="Remaining Leads" value={summary?.remainingLeads ?? "-"} />
        <KpiCard label="Completed Leads" value={summary?.completedLeads ?? "-"} />
        <KpiCard label="Insurance Leads" value={summary?.insuranceLeads ?? "-"} />
        <KpiCard label="Cash Leads" value={summary?.cashLeads ?? "-"} />
        <KpiCard label="Available Agents" value={summary?.availableAgents ?? "-"} />
        <KpiCard label="Agents On Break" value={summary?.agentsOnBreak ?? "-"} />
        <KpiCard label="Agents On Calls" value={summary?.agentsOnCalls ?? "-"} />
        <KpiCard label="Offline Agents" value={summary?.offlineAgents ?? "-"} />
        <KpiCard label="Total Calls" value={summary?.totalOutboundCalls ?? "-"} />
        <KpiCard label="Answered Calls" value={summary?.answeredCalls ?? "-"} />
        <KpiCard label="Busy Calls" value={summary?.busyCalls ?? "-"} />
        <KpiCard label="No Answer Calls" value={summary?.noAnswerCalls ?? "-"} />
        <KpiCard label="Abandoned Calls" value={summary?.abandonedCalls ?? "-"} />
        <KpiCard
          label="Avg AHT"
          value={summary ? `${Math.round(summary.averageAht)}s` : "-"}
        />
        <KpiCard
          label="Conversion Rate"
          value={summary ? `${(summary.conversionRate * 100).toFixed(1)}%` : "-"}
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Leads by Partner</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={byPartner}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="partner" tick={{ fontSize: 12 }} />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="count" fill="#0f172a" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Leads by Status</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={byStatus}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="status" tick={{ fontSize: 10 }} interval={0} angle={-25} textAnchor="end" height={70} />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </AdminShell>
  );
}
