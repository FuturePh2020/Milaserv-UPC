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

interface TaskItem {
  id: string;
  name: string;
  code: string;
  description?: string | null;
  dailyTarget: number;
  priority: number;
  isActive: boolean;
  maxConcurrentBreaks: number;
}

export default function TasksPage() {
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [form, setForm] = useState({ name: "", code: "", description: "", dailyTarget: 0, priority: 0 });
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setTasks(await api.get<TaskItem[]>("/tasks"));
  }

  useEffect(() => {
    load().catch(() => undefined);
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post("/tasks", form);
      setForm({ name: "", code: "", description: "", dailyTarget: 0, priority: 0 });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create task");
    }
  }

  return (
    <AdminShell>
      <h1 className="text-xl font-semibold text-slate-900">Tasks</h1>
      <p className="text-sm text-slate-500">Define work tasks agents can be authorized for</p>

      <Card className="mt-6">
        <CardContent className="p-4">
          <form onSubmit={handleCreate} className="grid grid-cols-1 gap-4 md:grid-cols-5 md:items-end">
            <div>
              <Label htmlFor="tname">Name</Label>
              <Input id="tname" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </div>
            <div>
              <Label htmlFor="tcode">Code</Label>
              <Input id="tcode" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} required />
            </div>
            <div>
              <Label htmlFor="target">Daily Target</Label>
              <Input
                id="target"
                type="number"
                value={form.dailyTarget}
                onChange={(e) => setForm({ ...form, dailyTarget: Number(e.target.value) })}
              />
            </div>
            <div>
              <Label htmlFor="priority">Priority</Label>
              <Input
                id="priority"
                type="number"
                value={form.priority}
                onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })}
              />
            </div>
            <Button type="submit" className="md:w-fit">
              Add Task
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
              <TableHead>Daily Target</TableHead>
              <TableHead>Priority</TableHead>
              <TableHead>Max Concurrent Breaks</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tasks.map((t) => (
              <TableRow key={t.id}>
                <TableCell className="font-medium">{t.name}</TableCell>
                <TableCell>{t.code}</TableCell>
                <TableCell>{t.dailyTarget}</TableCell>
                <TableCell>{t.priority}</TableCell>
                <TableCell>{t.maxConcurrentBreaks}</TableCell>
                <TableCell>
                  <Badge variant={t.isActive ? "success" : "destructive"}>{t.isActive ? "Active" : "Inactive"}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </AdminShell>
  );
}
