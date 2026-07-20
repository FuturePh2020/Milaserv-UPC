"use client";

import { useEffect, useState } from "react";
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
import { api, ApiError } from "@/lib/api-client";

interface LeadCategory {
  id: string;
  name: string;
  code: string;
}

interface Partner {
  id: string;
  name: string;
  code: string;
  partnerType?: string | null;
  insuranceEnabled: boolean;
  cashEnabled: boolean;
  isActive: boolean;
  categories: { category: LeadCategory }[];
}

export default function PartnersPage() {
  const [partners, setPartners] = useState<Partner[]>([]);
  const [categories, setCategories] = useState<LeadCategory[]>([]);
  const [form, setForm] = useState({ name: "", code: "", partnerType: "", insuranceEnabled: false, cashEnabled: false });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    const [p, c] = await Promise.all([
      api.get<Partner[]>("/partners"),
      api.get<LeadCategory[]>("/lead-categories"),
    ]);
    setPartners(p);
    setCategories(c);
  }

  useEffect(() => {
    load().catch(() => undefined);
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const categoryIds = categories
        .filter((c) => (form.insuranceEnabled && c.code === "INSURANCE") || (form.cashEnabled && c.code === "CASH"))
        .map((c) => c.id);
      await api.post("/partners", { ...form, categoryIds });
      setForm({ name: "", code: "", partnerType: "", insuranceEnabled: false, cashEnabled: false });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create partner");
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleActive(partner: Partner) {
    await api.put(`/partners/${partner.id}/active`, { isActive: !partner.isActive });
    await load();
  }

  return (
    <AdminShell>
      <h1 className="text-xl font-semibold text-slate-900">Partners</h1>
      <p className="text-sm text-slate-500">Manage lead partners and their category access</p>

      <Card className="mt-6">
        <CardContent className="p-4">
          <form onSubmit={handleCreate} className="grid grid-cols-1 gap-4 md:grid-cols-5 md:items-end">
            <div>
              <Label htmlFor="name">Name</Label>
              <Input id="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </div>
            <div>
              <Label htmlFor="code">Code</Label>
              <Input id="code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} required />
            </div>
            <div>
              <Label htmlFor="partnerType">Type</Label>
              <Input
                id="partnerType"
                value={form.partnerType}
                onChange={(e) => setForm({ ...form, partnerType: e.target.value })}
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="insurance"
                checked={form.insuranceEnabled}
                onChange={(e) => setForm({ ...form, insuranceEnabled: e.target.checked })}
              />
              <Label htmlFor="insurance">Insurance</Label>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="cash"
                checked={form.cashEnabled}
                onChange={(e) => setForm({ ...form, cashEnabled: e.target.checked })}
              />
              <Label htmlFor="cash">Cash</Label>
            </div>
            <Button type="submit" disabled={submitting} className="md:col-span-5 md:w-fit">
              Add Partner
            </Button>
          </form>
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        </CardContent>
      </Card>

      <Card className="mt-6">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Code</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Categories</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {partners.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="font-medium">{p.name}</TableCell>
                <TableCell>{p.code}</TableCell>
                <TableCell>{p.partnerType || "-"}</TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    {p.categories.map((c) => (
                      <Badge key={c.category.id} variant="secondary">
                        {c.category.name}
                      </Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant={p.isActive ? "success" : "destructive"}>{p.isActive ? "Active" : "Inactive"}</Badge>
                </TableCell>
                <TableCell>
                  <Button size="sm" variant="outline" onClick={() => toggleActive(p)}>
                    {p.isActive ? "Deactivate" : "Activate"}
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
