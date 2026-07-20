"use client";

import { useEffect, useState } from "react";
import { AdminShell } from "@/components/layout/admin-shell";
import {
  Button,
  Card,
  CardContent,
  Input,
  Label,
  Select,
  Badge,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@lcrm/ui";
import { api, ApiError } from "@/lib/api-client";

interface UserRow {
  id: string;
  username: string;
  fullName: string;
  role: "ADMIN" | "AGENT";
  status: string;
  currentAgentStatus?: string | null;
}

interface TaskItem {
  id: string;
  name: string;
}

export default function UsersPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [form, setForm] = useState({ username: "", password: "", fullName: "", role: "AGENT", email: "" });
  const [error, setError] = useState<string | null>(null);
  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const [permittedTaskIds, setPermittedTaskIds] = useState<string[]>([]);

  async function load() {
    const [u, t] = await Promise.all([api.get<UserRow[]>("/users"), api.get<TaskItem[]>("/tasks")]);
    setUsers(u);
    setTasks(t);
  }

  useEffect(() => {
    load().catch(() => undefined);
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post("/users", form);
      setForm({ username: "", password: "", fullName: "", role: "AGENT", email: "" });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create user");
    }
  }

  async function toggleStatus(u: UserRow) {
    await api.put(`/users/${u.id}/status`, { status: u.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE" });
    await load();
  }

  async function resetPassword(u: UserRow) {
    const newPassword = window.prompt(`New password for ${u.username}`);
    if (!newPassword) return;
    await api.post(`/users/${u.id}/reset-password`, { newPassword });
    window.alert("Password reset");
  }

  async function openPermissions(u: UserRow) {
    const detail = await api.get<any>(`/users/${u.id}`);
    setSelectedUser(u.id);
    setPermittedTaskIds(detail.agentTaskPermissions.map((p: any) => p.task.id));
  }

  async function savePermissions() {
    if (!selectedUser) return;
    await api.put(`/users/${selectedUser}/task-permissions`, { taskIds: permittedTaskIds });
    setSelectedUser(null);
  }

  return (
    <AdminShell>
      <h1 className="text-xl font-semibold text-slate-900">Users</h1>
      <p className="text-sm text-slate-500">Create and manage Admin and Agent accounts</p>

      <Card className="mt-6">
        <CardContent className="p-4">
          <form onSubmit={handleCreate} className="grid grid-cols-1 gap-4 md:grid-cols-5 md:items-end">
            <div>
              <Label>Username</Label>
              <Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required />
            </div>
            <div>
              <Label>Full Name</Label>
              <Input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} required />
            </div>
            <div>
              <Label>Email (optional)</Label>
              <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div>
              <Label>Password</Label>
              <Input
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                required
              />
            </div>
            <div>
              <Label>Role</Label>
              <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                <option value="AGENT">Agent</option>
                <option value="ADMIN">Admin</option>
              </Select>
            </div>
            <Button type="submit" className="md:col-span-5 md:w-fit">
              Create User
            </Button>
          </form>
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        </CardContent>
      </Card>

      <Card className="mt-6">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Username</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Agent Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((u) => (
              <TableRow key={u.id}>
                <TableCell className="font-medium">{u.username}</TableCell>
                <TableCell>{u.fullName}</TableCell>
                <TableCell>{u.role}</TableCell>
                <TableCell>
                  <Badge variant={u.status === "ACTIVE" ? "success" : "destructive"}>{u.status}</Badge>
                </TableCell>
                <TableCell>{u.currentAgentStatus ?? "-"}</TableCell>
                <TableCell className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => toggleStatus(u)}>
                    {u.status === "ACTIVE" ? "Suspend" : "Activate"}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => resetPassword(u)}>
                    Reset password
                  </Button>
                  {u.role === "AGENT" && (
                    <Button size="sm" variant="outline" onClick={() => openPermissions(u)}>
                      Task permissions
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {selectedUser && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/40 p-4">
          <Card className="w-full max-w-md">
            <CardContent className="p-4">
              <h2 className="text-base font-semibold text-slate-900">Task Permissions</h2>
              <div className="mt-3 flex flex-col gap-2">
                {tasks.map((t) => (
                  <label key={t.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={permittedTaskIds.includes(t.id)}
                      onChange={(e) =>
                        setPermittedTaskIds((prev) =>
                          e.target.checked ? [...prev, t.id] : prev.filter((id) => id !== t.id),
                        )
                      }
                    />
                    {t.name}
                  </label>
                ))}
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <Button variant="outline" onClick={() => setSelectedUser(null)}>
                  Cancel
                </Button>
                <Button onClick={savePermissions}>Save</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </AdminShell>
  );
}
