"use client";

import { useEffect, useState } from "react";
import { AdminShell } from "@/components/layout/admin-shell";
import { OrderDetail } from "@/components/order-detail";
import { Card, CardHeader, CardTitle, CardContent, Button, Input, Label, Select } from "@lcrm/ui";
import { api, ApiError } from "@/lib/api-client";
import { OrderSourceLabels } from "@lcrm/shared";

interface Partner {
  id: string;
  name: string;
}
interface UserOption {
  id: string;
  fullName: string;
  role: string;
}
interface LeadOption {
  id: string;
  customerName: string;
  primaryPhone: string;
}
interface RetentionCustomerOption {
  id: string;
  name: string;
  phone: string;
}

const SOURCES = ["INBOUND_CALL", "LEADS", "WHATSAPP", "PARTNER", "RETENTION_CUSTOMER"];

export default function CreateOrderPage() {
  const [partners, setPartners] = useState<Partner[]>([]);
  const [agents, setAgents] = useState<UserOption[]>([]);
  const [form, setForm] = useState({
    externalOrderNumber: "",
    customerName: "",
    customerPhone: "",
    orderType: "CASH",
    source: "INBOUND_CALL",
    responsibleUserId: "",
    partnerId: "",
    leadId: "",
    retentionCustomerId: "",
  });
  const [leadQuery, setLeadQuery] = useState("");
  const [leadResults, setLeadResults] = useState<LeadOption[]>([]);
  const [retentionQuery, setRetentionQuery] = useState("");
  const [retentionResults, setRetentionResults] = useState<RetentionCustomerOption[]>([]);
  const [createdOrderId, setCreatedOrderId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api.get<Partner[]>("/partners").then(setPartners).catch(() => undefined);
    api
      .get<UserOption[]>("/users?role=AGENT")
      .then(setAgents)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (form.source !== "LEADS" || !leadQuery.trim()) {
      setLeadResults([]);
      return;
    }
    const t = setTimeout(() => {
      api.get<{ items: LeadOption[] }>(`/leads?search=${encodeURIComponent(leadQuery)}&pageSize=10`).then((r) => setLeadResults(r.items)).catch(() => undefined);
    }, 250);
    return () => clearTimeout(t);
  }, [leadQuery, form.source]);

  useEffect(() => {
    if (form.source !== "RETENTION_CUSTOMER" || !retentionQuery.trim()) {
      setRetentionResults([]);
      return;
    }
    const t = setTimeout(() => {
      api.get<RetentionCustomerOption[]>(`/retention?search=${encodeURIComponent(retentionQuery)}`).then(setRetentionResults).catch(() => undefined);
    }, 250);
    return () => clearTimeout(t);
  }, [retentionQuery, form.source]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const order = await api.post<{ id: string }>("/orders", form);
      setCreatedOrderId(order.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create order");
    } finally {
      setSubmitting(false);
    }
  }

  if (createdOrderId) {
    return (
      <AdminShell>
        <h1 className="text-xl font-semibold text-slate-900">Order Created</h1>
        <p className="text-sm text-slate-500">Add items and manage the order below.</p>
        <div className="mt-6">
          <OrderDetail orderId={createdOrderId} />
        </div>
        <Button
          variant="outline"
          className="mt-4"
          onClick={() => {
            setCreatedOrderId(null);
            setForm({ ...form, externalOrderNumber: "", customerName: "", customerPhone: "", leadId: "", retentionCustomerId: "" });
          }}
        >
          Create Another Order
        </Button>
      </AdminShell>
    );
  }

  return (
    <AdminShell>
      <h1 className="text-xl font-semibold text-slate-900">Create Order</h1>
      <p className="text-sm text-slate-500">Manually create an order that may not originate from Generate Lead</p>

      <Card className="mt-6 max-w-3xl">
        <CardHeader>
          <CardTitle>Order Details</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <Label>External Order Number</Label>
              <Input
                value={form.externalOrderNumber}
                onChange={(e) => setForm({ ...form, externalOrderNumber: e.target.value })}
                placeholder="From the external order-management system"
                required
              />
            </div>
            <div>
              <Label>Order Type</Label>
              <Select value={form.orderType} onChange={(e) => setForm({ ...form, orderType: e.target.value })}>
                <option value="CASH">Cash</option>
                <option value="INSURANCE">Insurance</option>
              </Select>
            </div>
            <div>
              <Label>Customer Name</Label>
              <Input value={form.customerName} onChange={(e) => setForm({ ...form, customerName: e.target.value })} required />
            </div>
            <div>
              <Label>Customer Phone</Label>
              <Input value={form.customerPhone} onChange={(e) => setForm({ ...form, customerPhone: e.target.value })} required />
            </div>
            <div>
              <Label>Order Source</Label>
              <Select
                value={form.source}
                onChange={(e) =>
                  // Changing source must drop leadId/retentionCustomerId/partnerId
                  // from whichever source was previously picked — otherwise a
                  // stale link from an earlier selection is still submitted
                  // alongside the new source.
                  setForm({
                    ...form,
                    source: e.target.value,
                    leadId: "",
                    retentionCustomerId: "",
                    partnerId: "",
                  })
                }
              >
                {SOURCES.map((s) => (
                  <option key={s} value={s}>
                    {OrderSourceLabels[s as keyof typeof OrderSourceLabels]}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Responsible User</Label>
              <Select value={form.responsibleUserId} onChange={(e) => setForm({ ...form, responsibleUserId: e.target.value })} required>
                <option value="">Select agent</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.fullName}
                  </option>
                ))}
              </Select>
            </div>

            {form.source === "PARTNER" && (
              <div>
                <Label>Partner</Label>
                <Select value={form.partnerId} onChange={(e) => setForm({ ...form, partnerId: e.target.value })} required>
                  <option value="">Select partner</option>
                  {partners.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </div>
            )}

            {form.source === "LEADS" && (
              <div className="relative md:col-span-2">
                <Label>Search Lead (phone, name, or ID)</Label>
                <Input value={leadQuery} onChange={(e) => setLeadQuery(e.target.value)} />
                {form.leadId && <p className="mt-1 text-xs text-emerald-600">Lead linked</p>}
                {leadResults.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full rounded-md border border-slate-200 bg-white shadow-lg">
                    {leadResults.map((l) => (
                      <button
                        key={l.id}
                        type="button"
                        className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
                        onClick={() => {
                          setForm({ ...form, leadId: l.id, customerName: l.customerName, customerPhone: l.primaryPhone });
                          setLeadQuery(`${l.customerName} (${l.primaryPhone})`);
                          setLeadResults([]);
                        }}
                      >
                        {l.customerName} · {l.primaryPhone}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {form.source === "RETENTION_CUSTOMER" && (
              <div className="relative md:col-span-2">
                <Label>Search Retention Customer</Label>
                <Input value={retentionQuery} onChange={(e) => setRetentionQuery(e.target.value)} />
                {form.retentionCustomerId && <p className="mt-1 text-xs text-emerald-600">Retention customer linked</p>}
                {retentionResults.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full rounded-md border border-slate-200 bg-white shadow-lg">
                    {retentionResults.map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
                        onClick={() => {
                          setForm({ ...form, retentionCustomerId: r.id, customerName: r.name, customerPhone: r.phone });
                          setRetentionQuery(`${r.name} (${r.phone})`);
                          setRetentionResults([]);
                        }}
                      >
                        {r.name} · {r.phone}
                      </button>
                    ))}
                  </div>
                )}
                <p className="mt-1 text-xs text-slate-400">Not found? Just fill in Customer Name/Phone above to create a new one on save.</p>
              </div>
            )}

            {error && <p className="text-sm text-red-600 md:col-span-2">{error}</p>}

            <Button type="submit" disabled={submitting} className="md:col-span-2 md:w-fit">
              {submitting ? "Creating..." : "Create Order"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </AdminShell>
  );
}
