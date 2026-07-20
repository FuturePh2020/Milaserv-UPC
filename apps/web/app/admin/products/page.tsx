"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AdminShell } from "@/components/layout/admin-shell";
import {
  Button,
  Card,
  CardContent,
  Input,
  Label,
  Badge,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@lcrm/ui";
import { api, ApiError, downloadFile } from "@/lib/api-client";
import { useAutoRefresh } from "@/lib/use-auto-refresh";

interface ProductRow {
  id: string;
  itemCode: string;
  barcode?: string | null;
  arabicName?: string | null;
  englishName?: string | null;
  defaultPrice?: number | null;
  cashAvailable: boolean;
  insuranceAvailable: boolean;
  isActive: boolean;
  isArchived: boolean;
}

export default function ProductsPage() {
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState({ itemCode: "", englishName: "", arabicName: "", defaultPrice: "" });
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    setProducts(await api.get<ProductRow[]>(`/products?${params.toString()}`));
  }

  useEffect(() => {
    load().catch(() => undefined);
  }, [search]);

  useAutoRefresh("products", load);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post("/products", { ...form, defaultPrice: form.defaultPrice ? Number(form.defaultPrice) : undefined });
      setForm({ itemCode: "", englishName: "", arabicName: "", defaultPrice: "" });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create item");
    }
  }

  async function toggleStatus(p: ProductRow) {
    await api.put(`/products/${p.id}/status`, { isActive: !p.isActive });
    await load();
  }

  async function archive(p: ProductRow) {
    if (!window.confirm(`Archive "${p.englishName || p.arabicName}"? It will no longer be selectable in new Orders.`)) return;
    await api.post(`/products/${p.id}/archive`, {});
    await load();
  }

  async function restore(p: ProductRow) {
    await api.post(`/products/${p.id}/restore`, {});
    await load();
  }

  return (
    <AdminShell>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Products &amp; Items</h1>
          <p className="text-sm text-slate-500">Central item catalog used across all Orders</p>
        </div>
        <div className="flex gap-2">
          <Link href="/admin/products/import">
            <Button variant="outline">Import</Button>
          </Link>
          <Button variant="outline" onClick={() => downloadFile("/products/export?format=xlsx", "products.xlsx")}>
            Export
          </Button>
        </div>
      </div>

      <Card className="mt-6">
        <CardContent className="p-4">
          <form onSubmit={handleCreate} className="grid grid-cols-1 gap-4 md:grid-cols-5 md:items-end">
            <div>
              <Label>Item Code</Label>
              <Input value={form.itemCode} onChange={(e) => setForm({ ...form, itemCode: e.target.value })} required />
            </div>
            <div>
              <Label>English Name</Label>
              <Input value={form.englishName} onChange={(e) => setForm({ ...form, englishName: e.target.value })} />
            </div>
            <div>
              <Label>Arabic Name</Label>
              <Input value={form.arabicName} onChange={(e) => setForm({ ...form, arabicName: e.target.value })} />
            </div>
            <div>
              <Label>Default Price</Label>
              <Input type="number" value={form.defaultPrice} onChange={(e) => setForm({ ...form, defaultPrice: e.target.value })} />
            </div>
            <Button type="submit" className="md:w-fit">
              Add Item
            </Button>
          </form>
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardContent className="p-4">
          <Input placeholder="Search by name, code, or barcode" value={search} onChange={(e) => setSearch(e.target.value)} />
        </CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item Code</TableHead>
              <TableHead>English Name</TableHead>
              <TableHead>Arabic Name</TableHead>
              <TableHead>Price</TableHead>
              <TableHead>Cash</TableHead>
              <TableHead>Insurance</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {products.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="font-medium">{p.itemCode}</TableCell>
                <TableCell>{p.englishName ?? "-"}</TableCell>
                <TableCell>{p.arabicName ?? "-"}</TableCell>
                <TableCell>{p.defaultPrice ?? "-"}</TableCell>
                <TableCell>{p.cashAvailable ? "Yes" : "No"}</TableCell>
                <TableCell>{p.insuranceAvailable ? "Yes" : "No"}</TableCell>
                <TableCell>
                  {p.isArchived ? (
                    <Badge variant="destructive">Archived</Badge>
                  ) : (
                    <Badge variant={p.isActive ? "success" : "secondary"}>{p.isActive ? "Active" : "Inactive"}</Badge>
                  )}
                </TableCell>
                <TableCell className="flex gap-2">
                  {!p.isArchived && (
                    <>
                      <Button size="sm" variant="outline" onClick={() => toggleStatus(p)}>
                        {p.isActive ? "Deactivate" : "Activate"}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => archive(p)}>
                        Archive
                      </Button>
                    </>
                  )}
                  {p.isArchived && (
                    <Button size="sm" variant="outline" onClick={() => restore(p)}>
                      Restore
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
