"use client";

import { useCallback, useEffect, useState } from "react";
import { AgentShell } from "@/components/layout/agent-shell";
import { KpiCard } from "@/components/kpi-card";
import { OrderDetail } from "@/components/order-detail";
import { Card, Table, TableHeader, TableBody, TableRow, TableHead, TableCell, Badge, Button } from "@lcrm/ui";
import { api } from "@/lib/api-client";
import { useAutoRefresh } from "@/lib/use-auto-refresh";

interface Performance {
  totalOrders: number;
  completedOrders: number;
  cashOrders: number;
  insuranceOrders: number;
  cashCompletedSales: number;
  insuranceCompletedSales: number;
  totalCompletedSales: number;
  cashTarget: number;
  insuranceTarget: number;
  totalTarget: number;
  cashTargetAchievementPct: number;
  insuranceTargetAchievementPct: number;
  totalTargetAchievementPct: number;
  pendingCompletionOrdersCount: number;
  pendingCompletionValue: number;
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
  nextRefillDate?: string | null;
  partner?: { name: string } | null;
}

export default function MyOrdersPage() {
  const [performance, setPerformance] = useState<Performance | null>(null);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [total, setTotal] = useState(0);
  const [openOrderId, setOpenOrderId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [perf, list] = await Promise.all([
      api.get<Performance>("/orders/my/performance"),
      api.get<{ items: OrderRow[]; total: number }>("/orders/my"),
    ]);
    setPerformance(perf);
    setOrders(list.items);
    setTotal(list.total);
  }, []);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  useAutoRefresh("my-orders", load, Boolean(openOrderId));

  return (
    <AgentShell>
      <h1 className="text-xl font-semibold text-slate-900">My Orders</h1>
      <p className="text-sm text-slate-500">{total} orders · month to date</p>

      {performance && (
        <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
          <KpiCard label="Total Orders" value={performance.totalOrders} />
          <KpiCard label="Completed Orders" value={performance.completedOrders} />
          <KpiCard label="Cash Sales" value={performance.cashCompletedSales.toFixed(0)} />
          <KpiCard label="Insurance Sales" value={performance.insuranceCompletedSales.toFixed(0)} />
          <KpiCard label="Total Sales" value={performance.totalCompletedSales.toFixed(0)} />
          <KpiCard label="Total Target Achievement" value={`${performance.totalTargetAchievementPct.toFixed(1)}%`} />
          <KpiCard label="Pending Completion Orders" value={performance.pendingCompletionOrdersCount} />
          <KpiCard label="Pending Completion Value" value={performance.pendingCompletionValue.toFixed(0)} />
        </div>
      )}

      <Card className="mt-6">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Order #</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Partner</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Expected</TableHead>
              <TableHead>Completed</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Next Refill</TableHead>
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
                <TableCell>
                  <Badge variant="secondary">{o.status}</Badge>
                </TableCell>
                <TableCell>{o.expectedValue ?? "-"}</TableCell>
                <TableCell>{o.completedValue ?? "-"}</TableCell>
                <TableCell>{new Date(o.createdAt).toLocaleDateString()}</TableCell>
                <TableCell>{o.nextRefillDate ? new Date(o.nextRefillDate).toLocaleDateString() : "-"}</TableCell>
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
    </AgentShell>
  );
}
