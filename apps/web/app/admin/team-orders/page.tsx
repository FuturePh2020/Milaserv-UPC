"use client";

import { useCallback, useEffect, useState } from "react";
import { AdminShell } from "@/components/layout/admin-shell";
import { KpiCard } from "@/components/kpi-card";
import { OrderDetail } from "@/components/order-detail";
import { Card, Table, TableHeader, TableBody, TableRow, TableHead, TableCell, Badge, Button, Select, Input, Label } from "@lcrm/ui";
import { api, downloadFile } from "@/lib/api-client";
import { useAutoRefresh } from "@/lib/use-auto-refresh";

interface Team {
  id: string;
  name: string;
}
interface UserOption {
  id: string;
  fullName: string;
}
interface Partner {
  id: string;
  name: string;
}
interface Performance {
  totalOrders: number;
  completedOrders: number;
  cashCompletedSales: number;
  insuranceCompletedSales: number;
  totalCompletedSales: number;
  totalTargetAchievementPct: number;
  pendingCompletionOrdersCount: number;
  pendingCompletionValue: number;
  filtered: boolean;
}
interface OrderRow {
  id: string;
  externalOrderNumber: string;
  customerName: string;
  customerPhone: string;
  orderType: string;
  source: string;
  status: string;
  expectedValue?: number | null;
  completedValue?: number | null;
  createdAt: string;
  responsibleUser: { fullName: string };
  partner?: { name: string } | null;
}

export default function TeamOrdersPage() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [agents, setAgents] = useState<UserOption[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [teamId, setTeamId] = useState("");
  const [mode, setMode] = useState<"monthly" | "filtered">("monthly");
  const [filters, setFilters] = useState({
    dateFrom: "",
    dateTo: "",
    status: "",
    orderType: "",
    responsibleUserId: "",
    partnerId: "",
    source: "",
    customerPhone: "",
    externalOrderNumber: "",
    customerName: "",
  });
  const [performance, setPerformance] = useState<Performance | null>(null);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [total, setTotal] = useState(0);
  const [openOrderId, setOpenOrderId] = useState<string | null>(null);
  const [targetForm, setTargetForm] = useState({ cashTarget: "", insuranceTarget: "" });
  const [targetMessage, setTargetMessage] = useState<string | null>(null);

  useEffect(() => {
    api.get<Team[]>("/teams").then((t) => {
      setTeams(t);
      if (t[0]) setTeamId(t[0].id);
    });
    api.get<UserOption[]>("/users?role=AGENT").then(setAgents).catch(() => undefined);
    api.get<Partner[]>("/partners").then(setPartners).catch(() => undefined);
  }, []);

  const load = useCallback(async () => {
    if (!teamId) return;
    const perfParams = new URLSearchParams({ teamId, mode: mode === "filtered" ? "filtered" : "monthly" });
    if (mode === "filtered") {
      Object.entries(filters).forEach(([k, v]) => v && perfParams.set(k, v));
    }
    const orderParams = new URLSearchParams({ teamId });
    Object.entries(filters).forEach(([k, v]) => v && orderParams.set(k, v));

    const [perf, list] = await Promise.all([
      api.get<Performance>(`/orders/team/performance?${perfParams.toString()}`),
      api.get<{ items: OrderRow[]; total: number }>(`/orders/team?${orderParams.toString()}`),
    ]);
    setPerformance(perf);
    setOrders(list.items);
    setTotal(list.total);
  }, [teamId, mode, filters]);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  useAutoRefresh("team-orders", load, Boolean(openOrderId));

  async function saveTarget() {
    setTargetMessage(null);
    const now = new Date();
    const effectiveMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    await api.post("/orders/targets", {
      teamId,
      effectiveMonth,
      cashTarget: Number(targetForm.cashTarget) || 0,
      insuranceTarget: Number(targetForm.insuranceTarget) || 0,
    });
    setTargetMessage("Target saved for this month");
    await load();
  }

  function exportOrders(kind: "summary" | "with-items", format: "xlsx" | "csv") {
    const params = new URLSearchParams({ teamId, format });
    Object.entries(filters).forEach(([k, v]) => v && params.set(k, v));
    downloadFile(`/orders/export/${kind}?${params.toString()}`, `orders-${kind}.${format === "csv" ? "csv" : "xlsx"}`);
  }

  return (
    <AdminShell>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Team Orders</h1>
          <p className="text-sm text-slate-500">{total} orders</p>
        </div>
        <Select value={teamId} onChange={(e) => setTeamId(e.target.value)} className="w-56">
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
      </div>

      <div className="mt-4 flex gap-2">
        <Button size="sm" variant={mode === "monthly" ? "default" : "outline"} onClick={() => setMode("monthly")}>
          Monthly Team Metrics
        </Button>
        <Button size="sm" variant={mode === "filtered" ? "default" : "outline"} onClick={() => setMode("filtered")}>
          Metrics Based on Current Filters
        </Button>
      </div>

      <Card className="mt-4">
        <div className="flex flex-wrap items-end gap-3 p-4">
          <div>
            <Label className="text-xs">Cash Target (this month)</Label>
            <Input
              type="number"
              min={0}
              className="w-40"
              value={targetForm.cashTarget}
              onChange={(e) => setTargetForm({ ...targetForm, cashTarget: e.target.value })}
            />
          </div>
          <div>
            <Label className="text-xs">Insurance Target (this month)</Label>
            <Input
              type="number"
              min={0}
              className="w-40"
              value={targetForm.insuranceTarget}
              onChange={(e) => setTargetForm({ ...targetForm, insuranceTarget: e.target.value })}
            />
          </div>
          <Button size="sm" onClick={saveTarget}>
            Save Team Target
          </Button>
          {targetMessage && <p className="text-sm text-emerald-600">{targetMessage}</p>}
        </div>
      </Card>

      {performance && (
        <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
          <KpiCard label="Total Orders" value={performance.totalOrders} />
          <KpiCard label="Completed Orders" value={performance.completedOrders} />
          <KpiCard label="Cash Sales" value={performance.cashCompletedSales.toFixed(0)} />
          <KpiCard label="Insurance Sales" value={performance.insuranceCompletedSales.toFixed(0)} />
          <KpiCard label="Total Sales" value={performance.totalCompletedSales.toFixed(0)} />
          <KpiCard label="Target Achievement" value={`${performance.totalTargetAchievementPct.toFixed(1)}%`} />
          <KpiCard label="Pending Completion Orders" value={performance.pendingCompletionOrdersCount} />
          <KpiCard label="Pending Completion Value" value={performance.pendingCompletionValue.toFixed(0)} />
        </div>
      )}

      <Card className="mt-6">
        <div className="grid grid-cols-2 gap-3 p-4 md:grid-cols-5">
          <div>
            <Label className="text-xs">Date From</Label>
            <Input type="date" value={filters.dateFrom} onChange={(e) => setFilters({ ...filters, dateFrom: e.target.value })} />
          </div>
          <div>
            <Label className="text-xs">Date To</Label>
            <Input type="date" value={filters.dateTo} onChange={(e) => setFilters({ ...filters, dateTo: e.target.value })} />
          </div>
          <div>
            <Label className="text-xs">Status</Label>
            <Select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
              <option value="">All</option>
              {["PENDING", "HOLDED", "ON_THE_WAY", "PICKED_UP", "COMPLETED", "CLOSED"].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label className="text-xs">Order Type</Label>
            <Select value={filters.orderType} onChange={(e) => setFilters({ ...filters, orderType: e.target.value })}>
              <option value="">All</option>
              <option value="CASH">Cash</option>
              <option value="INSURANCE">Insurance</option>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Responsible User</Label>
            <Select value={filters.responsibleUserId} onChange={(e) => setFilters({ ...filters, responsibleUserId: e.target.value })}>
              <option value="">All</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.fullName}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label className="text-xs">Partner</Label>
            <Select value={filters.partnerId} onChange={(e) => setFilters({ ...filters, partnerId: e.target.value })}>
              <option value="">All</option>
              {partners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label className="text-xs">Customer Phone</Label>
            <Input value={filters.customerPhone} onChange={(e) => setFilters({ ...filters, customerPhone: e.target.value })} />
          </div>
          <div>
            <Label className="text-xs">Customer Name</Label>
            <Input value={filters.customerName} onChange={(e) => setFilters({ ...filters, customerName: e.target.value })} />
          </div>
          <div>
            <Label className="text-xs">Order Number</Label>
            <Input value={filters.externalOrderNumber} onChange={(e) => setFilters({ ...filters, externalOrderNumber: e.target.value })} />
          </div>
          <div className="flex items-end gap-2">
            <Button size="sm" variant="outline" onClick={() => exportOrders("summary", "xlsx")}>
              Export Summary
            </Button>
            <Button size="sm" variant="outline" onClick={() => exportOrders("with-items", "xlsx")}>
              Export With Items
            </Button>
          </div>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Order #</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Partner</TableHead>
              <TableHead>Agent</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Expected</TableHead>
              <TableHead>Completed</TableHead>
              <TableHead>Created</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {orders.map((o) => (
              <TableRow key={o.id}>
                <TableCell className="font-medium">{o.externalOrderNumber}</TableCell>
                <TableCell>
                  {o.customerName}
                  <br />
                  <span className="text-xs text-slate-400">{o.customerPhone}</span>
                </TableCell>
                <TableCell>{o.orderType}</TableCell>
                <TableCell>{o.source}</TableCell>
                <TableCell>{o.partner?.name ?? "-"}</TableCell>
                <TableCell>{o.responsibleUser.fullName}</TableCell>
                <TableCell>
                  <Badge variant="secondary">{o.status}</Badge>
                </TableCell>
                <TableCell>{o.expectedValue ?? "-"}</TableCell>
                <TableCell>{o.completedValue ?? "-"}</TableCell>
                <TableCell>{new Date(o.createdAt).toLocaleDateString()}</TableCell>
                <TableCell>
                  <Button size="sm" variant="outline" onClick={() => setOpenOrderId(o.id)}>
                    Open
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {openOrderId && (
        <div className="fixed inset-0 z-20 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
          <div className="mt-8 w-full max-w-3xl rounded-lg bg-white p-6 shadow-xl">
            <OrderDetail
              orderId={openOrderId}
              onClose={() => {
                setOpenOrderId(null);
                load();
              }}
            />
          </div>
        </div>
      )}
    </AdminShell>
  );
}
