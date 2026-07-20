"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Card, CardHeader, CardTitle, CardContent, Badge, Select, Input, Label, Textarea } from "@lcrm/ui";
import { api, ApiError } from "@/lib/api-client";
import { TimelineFeed } from "@/components/timeline-feed";

interface Product {
  id: string;
  itemCode: string;
  arabicName?: string | null;
  englishName?: string | null;
  defaultPrice?: number | null;
}

interface OrderItem {
  id: string;
  productId?: string | null;
  itemCodeSnapshot?: string | null;
  arabicNameSnapshot?: string | null;
  englishNameSnapshot?: string | null;
  quantity: number;
  unitPrice?: number | null;
  lineValue?: number | null;
}

interface OrderNote {
  id: string;
  text: string;
  authorRole: string;
  createdAt: string;
}

interface Order {
  id: string;
  externalOrderNumber: string;
  customerName: string;
  customerPhone: string;
  orderType: string;
  source: string;
  status: string;
  expectedValue?: number | null;
  completedValue?: number | null;
  nextRefillDate?: string | null;
  refillIntervalDays?: number | null;
  partner?: { id: string; name: string } | null;
  responsibleUser: { id: string; fullName: string };
  items: OrderItem[];
  orderNotes: OrderNote[];
}

const STATUS_OPTIONS = ["PENDING", "HOLDED", "ON_THE_WAY", "PICKED_UP", "COMPLETED", "CLOSED"];

export function OrderDetail({ orderId, onClose }: { orderId: string; onClose?: () => void }) {
  const [order, setOrder] = useState<Order | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [itemQuery, setItemQuery] = useState("");
  const [itemResults, setItemResults] = useState<Product[]>([]);
  const [statusForm, setStatusForm] = useState({ status: "", completedValue: "", cancellationReason: "", cancellationNotes: "", notes: "" });
  const [expectedValueInput, setExpectedValueInput] = useState("");
  const [noteText, setNoteText] = useState("");
  const [refillForm, setRefillForm] = useState({ mode: "NUMBER_OF_DAYS", days: "", exactDate: "" });

  const load = useCallback(async () => {
    const o = await api.get<Order>(`/orders/${orderId}`);
    setOrder(o);
    setStatusForm((f) => ({ ...f, status: o.status }));
    setExpectedValueInput(o.expectedValue?.toString() ?? "");
  }, [orderId]);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  useEffect(() => {
    if (!itemQuery.trim() || !order) {
      setItemResults([]);
      return;
    }
    const t = setTimeout(() => {
      api
        .get<Product[]>(`/products/search?q=${encodeURIComponent(itemQuery)}&orderType=${order.orderType}${order.partner ? `&partnerId=${order.partner.id}` : ""}`)
        .then(setItemResults)
        .catch(() => undefined);
    }, 250);
    return () => clearTimeout(t);
  }, [itemQuery, order]);

  async function addItem(productId: string) {
    try {
      await api.post(`/orders/${orderId}/items`, { productId, quantity: 1 });
      setItemQuery("");
      setItemResults([]);
      await load();
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : "Failed to add item");
    }
  }

  async function updateQuantity(itemId: string, quantity: number) {
    if (quantity < 1) return;
    await api.put(`/orders/${orderId}/items/${itemId}`, { quantity });
    await load();
  }

  async function removeItem(itemId: string) {
    await api.delete(`/orders/${orderId}/items/${itemId}`);
    await load();
  }

  async function saveStatus() {
    setMessage(null);
    try {
      await api.put(`/orders/${orderId}/status`, {
        status: statusForm.status,
        completedValue: statusForm.status === "COMPLETED" ? Number(statusForm.completedValue) : undefined,
        cancellationReason: statusForm.status === "CLOSED" ? statusForm.cancellationReason : undefined,
        cancellationNotes: statusForm.status === "CLOSED" ? statusForm.cancellationNotes : undefined,
        notes: statusForm.notes || undefined,
      });
      setMessage("Status updated");
      await load();
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : "Failed to update status");
    }
  }

  async function saveExpectedValue() {
    try {
      await api.put(`/orders/${orderId}/expected-value`, { expectedValue: Number(expectedValueInput) });
      await load();
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : "Failed to set expected value");
    }
  }

  async function addNote() {
    if (!noteText.trim()) return;
    await api.post(`/orders/${orderId}/notes`, { text: noteText, visibility: "INTERNAL" });
    setNoteText("");
    await load();
  }

  async function saveRefill() {
    try {
      await api.put(`/orders/${orderId}/next-refill`, {
        mode: refillForm.mode,
        days: refillForm.mode === "NUMBER_OF_DAYS" ? Number(refillForm.days) : undefined,
        exactDate: refillForm.mode === "EXACT_DATE" ? refillForm.exactDate : undefined,
      });
      await load();
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : "Failed to update next refill");
    }
  }

  if (!order) return <p className="text-sm text-slate-500">Loading order...</p>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Order #{order.externalOrderNumber}</h2>
          <p className="text-sm text-slate-500">
            {order.customerName} · {order.customerPhone} · {order.orderType} · {order.source}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary">{order.status}</Badge>
          {onClose && (
            <Button variant="outline" size="sm" onClick={onClose}>
              Close
            </Button>
          )}
        </div>
      </div>

      {message && <p className="rounded-md bg-amber-50 p-2 text-sm text-amber-800">{message}</p>}

      <Card>
        <CardHeader>
          <CardTitle>Items</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="relative">
            <Input placeholder="Search item by Arabic/English name, code, or barcode" value={itemQuery} onChange={(e) => setItemQuery(e.target.value)} />
            {itemResults.length > 0 && (
              <div className="absolute z-10 mt-1 w-full rounded-md border border-slate-200 bg-white shadow-lg">
                {itemResults.map((p) => (
                  <button
                    key={p.id}
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-slate-50"
                    onClick={() => addItem(p.id)}
                  >
                    <span>
                      {p.englishName || p.arabicName} <span className="text-slate-400">({p.itemCode})</span>
                    </span>
                    <span className="text-slate-500">{p.defaultPrice ?? "-"}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-slate-500">
                <th className="py-1">Item</th>
                <th className="py-1">Qty</th>
                <th className="py-1">Unit Price</th>
                <th className="py-1">Line Value</th>
                <th className="py-1" />
              </tr>
            </thead>
            <tbody>
              {order.items.map((item) => (
                <tr key={item.id} className="border-t border-slate-100">
                  <td className="py-1.5">{item.englishNameSnapshot || item.arabicNameSnapshot || item.itemCodeSnapshot}</td>
                  <td className="py-1.5">
                    <Input
                      type="number"
                      min={1}
                      className="w-16"
                      value={item.quantity}
                      onChange={(e) => updateQuantity(item.id, Number(e.target.value))}
                    />
                  </td>
                  <td className="py-1.5">{item.unitPrice ?? "-"}</td>
                  <td className="py-1.5">{item.lineValue ?? "-"}</td>
                  <td className="py-1.5">
                    <Button size="sm" variant="ghost" onClick={() => removeItem(item.id)}>
                      Remove
                    </Button>
                  </td>
                </tr>
              ))}
              {order.items.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-2 text-slate-400">
                    No items added yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Status &amp; Value</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <Label>Status</Label>
            <Select value={statusForm.status} onChange={(e) => setStatusForm({ ...statusForm, status: e.target.value })}>
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </div>
          {statusForm.status === "COMPLETED" && (
            <div>
              <Label>Completed Order Value</Label>
              <Input
                type="number"
                min={0}
                value={statusForm.completedValue}
                onChange={(e) => setStatusForm({ ...statusForm, completedValue: e.target.value })}
              />
            </div>
          )}
          {statusForm.status === "CLOSED" && (
            <>
              <div>
                <Label>Cancellation Reason</Label>
                <Input value={statusForm.cancellationReason} onChange={(e) => setStatusForm({ ...statusForm, cancellationReason: e.target.value })} />
              </div>
              <div>
                <Label>Cancellation Notes</Label>
                <Input value={statusForm.cancellationNotes} onChange={(e) => setStatusForm({ ...statusForm, cancellationNotes: e.target.value })} />
              </div>
            </>
          )}
          <div className="md:col-span-2">
            <Button size="sm" onClick={saveStatus}>
              Update Status
            </Button>
          </div>

          <div>
            <Label>Expected Order Value</Label>
            <div className="flex gap-2">
              <Input type="number" min={0} value={expectedValueInput} onChange={(e) => setExpectedValueInput(e.target.value)} />
              <Button size="sm" variant="outline" onClick={saveExpectedValue}>
                Save
              </Button>
            </div>
          </div>
          <div>
            <Label>Completed Value</Label>
            <p className="mt-1.5 text-sm font-medium text-slate-900">{order.completedValue ?? "-"}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Next Refill</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div>
            <Label>Mode</Label>
            <Select value={refillForm.mode} onChange={(e) => setRefillForm({ ...refillForm, mode: e.target.value })}>
              <option value="NUMBER_OF_DAYS">Number of Days</option>
              <option value="EXACT_DATE">Exact Date</option>
            </Select>
          </div>
          {refillForm.mode === "NUMBER_OF_DAYS" ? (
            <div>
              <Label>Days</Label>
              <Input type="number" min={1} value={refillForm.days} onChange={(e) => setRefillForm({ ...refillForm, days: e.target.value })} />
            </div>
          ) : (
            <div>
              <Label>Date</Label>
              <Input type="date" value={refillForm.exactDate} onChange={(e) => setRefillForm({ ...refillForm, exactDate: e.target.value })} />
            </div>
          )}
          <Button size="sm" onClick={saveRefill}>
            Save
          </Button>
          {order.nextRefillDate && (
            <p className="text-sm text-slate-500">Current: {new Date(order.nextRefillDate).toLocaleDateString()}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Notes</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex gap-2">
            <Textarea value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="Add a note" className="flex-1" />
            <Button size="sm" onClick={addNote}>
              Add
            </Button>
          </div>
          <div className="flex flex-col gap-2">
            {order.orderNotes.map((n) => (
              <div key={n.id} className="rounded-md bg-slate-50 p-2 text-sm">
                <p>{n.text}</p>
                <p className="mt-1 text-xs text-slate-400">
                  {n.authorRole} · {new Date(n.createdAt).toLocaleString()}
                </p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <TimelineFeed entityType="Order" entityId={orderId} />
    </div>
  );
}
