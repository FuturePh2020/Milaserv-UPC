"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Phone, PlayCircle, StopCircle, Coffee, Sparkles } from "lucide-react";
import { AgentShell } from "@/components/layout/agent-shell";
import { KpiCard } from "@/components/kpi-card";
import { CallOutcomeForm } from "@/components/call-outcome-form";
import { Button, Card, CardHeader, CardTitle, CardContent, Badge, Select } from "@lcrm/ui";
import { api, ApiError } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { useAutoRefresh } from "@/lib/use-auto-refresh";

interface AgentSummary {
  currentStatus: string;
  sessionActive: boolean;
  sessionStartedAt: string | null;
  activeAssignments: number;
  completedToday: number;
  totalAssigned: number;
  remainingEligible: number;
  callsMadeToday: number;
  answeredCalls: number;
  busyCalls: number;
  noAnswerCalls: number;
  abandonedCalls: number;
  personalAht: number;
}

interface ActiveLead {
  id: string;
  taskCompletionStatus: string;
  lead: {
    id: string;
    customerName: string;
    primaryPhone: string;
    city?: string | null;
    notes?: string | null;
    workflowStatus: string;
    partner: { name: string };
    category: { name: string };
    task?: { name: string } | null;
  };
}

interface BreakType {
  id: string;
  name: string;
  maxDurationMinutes: number;
  color: string;
}

export default function AgentDashboardPage() {
  const { user, refresh } = useAuth();
  const [summary, setSummary] = useState<AgentSummary | null>(null);
  const [activeLeads, setActiveLeads] = useState<ActiveLead[]>([]);
  const [breakTypes, setBreakTypes] = useState<BreakType[]>([]);
  const [selectedBreakType, setSelectedBreakType] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [callStarted, setCallStarted] = useState(false);
  const [lastOrderId, setLastOrderId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [s, leads, types] = await Promise.all([
      api.get<AgentSummary>("/dashboard/agent/summary"),
      api.get<ActiveLead[]>("/leads/my-active"),
      api.get<BreakType[]>("/breaks/types"),
    ]);
    setSummary(s);
    setActiveLeads(leads);
    setBreakTypes(types);
  }, []);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  useAutoRefresh("agent-dashboard", load, callStarted);

  async function startSession() {
    setMessage(null);
    try {
      await api.post("/sessions/start");
      await Promise.all([load(), refresh()]);
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : "Failed to start session");
    }
  }

  async function endSession() {
    setMessage(null);
    try {
      await api.post("/sessions/end");
      await Promise.all([load(), refresh()]);
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : "Failed to end session");
    }
  }

  async function generateLead() {
    setMessage(null);
    setBusy(true);
    try {
      await api.post("/distribution/generate-lead", {});
      await Promise.all([load(), refresh()]);
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : "No eligible lead available right now");
    } finally {
      setBusy(false);
    }
  }

  async function startBreak() {
    if (!selectedBreakType) return;
    setMessage(null);
    try {
      await api.post("/breaks/start", { breakTypeId: selectedBreakType });
      await Promise.all([load(), refresh()]);
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : "Failed to start break");
    }
  }

  async function endBreak() {
    setMessage(null);
    try {
      await api.post("/breaks/end");
      await Promise.all([load(), refresh()]);
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : "Failed to end break");
    }
  }

  async function callLead(phone: string, leadId: string, taskId?: string) {
    try {
      await api.post("/voip/calls/initiate", { customerPhone: phone, leadId, taskId });
      setCallStarted(true);
      setMessage("Call initiated. Log the call result once the call is completed.");
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : "Failed to initiate call");
    }
  }

  async function handleOutcomeSubmitted(result: { orderId?: string }) {
    setCallStarted(false);
    setLastOrderId(result.orderId ?? null);
    setMessage(result.orderId ? "Call outcome saved. Order created — add items in My Orders." : "Call outcome saved.");
    await load();
  }

  const currentLead = activeLeads[0];
  const status = summary?.currentStatus ?? user?.currentAgentStatus;

  return (
    <AgentShell>
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-slate-900">Welcome, {user?.fullName}</h1>
        <div className="flex items-center gap-2">
          <Badge variant={status === "AVAILABLE" ? "success" : status === "ON_BREAK" ? "warning" : "secondary"}>
            {status}
          </Badge>
          {summary?.sessionActive && summary.sessionStartedAt && (
            <span className="text-xs text-slate-500">
              Session started {new Date(summary.sessionStartedAt).toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>

      {message && <p className="mt-3 rounded-md bg-amber-50 p-2 text-sm text-amber-800">{message}</p>}

      <Card className="mt-6">
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          {!summary?.sessionActive ? (
            <Button onClick={startSession}>
              <PlayCircle size={16} /> Start Session
            </Button>
          ) : (
            <Button variant="destructive" onClick={endSession}>
              <StopCircle size={16} /> End Session
            </Button>
          )}

          <Button onClick={generateLead} disabled={busy || !summary?.sessionActive || status !== "AVAILABLE"}>
            <Sparkles size={16} /> Generate Lead
          </Button>

          <div className="flex items-center gap-2">
            <Select value={selectedBreakType} onChange={(e) => setSelectedBreakType(e.target.value)} className="w-48">
              <option value="">Select break type</option>
              {breakTypes.map((bt) => (
                <option key={bt.id} value={bt.id}>
                  {bt.name} ({bt.maxDurationMinutes}m)
                </option>
              ))}
            </Select>
            {status === "ON_BREAK" ? (
              <Button variant="outline" onClick={endBreak}>
                <Coffee size={16} /> End Break
              </Button>
            ) : (
              <Button variant="outline" onClick={startBreak} disabled={!selectedBreakType}>
                <Coffee size={16} /> Start Break
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <KpiCard label="Completed Today" value={summary?.completedToday ?? "-"} />
        <KpiCard label="Total Assigned" value={summary?.totalAssigned ?? "-"} />
        <KpiCard label="Remaining Eligible" value={summary?.remainingEligible ?? "-"} />
        <KpiCard label="Calls Today" value={summary?.callsMadeToday ?? "-"} />
        <KpiCard label="Answered" value={summary?.answeredCalls ?? "-"} />
        <KpiCard label="Busy" value={summary?.busyCalls ?? "-"} />
        <KpiCard label="No Answer" value={summary?.noAnswerCalls ?? "-"} />
        <KpiCard label="Personal AHT" value={summary ? `${Math.round(summary.personalAht)}s` : "-"} />
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Current Lead</CardTitle>
        </CardHeader>
        <CardContent>
          {!currentLead ? (
            <p className="text-sm text-slate-500">No lead currently assigned. Click Generate Lead to get one.</p>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-3">
                <div>
                  <p className="text-xs text-slate-500">Customer</p>
                  <p className="font-medium">{currentLead.lead.customerName}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Phone</p>
                  <p className="font-medium">{currentLead.lead.primaryPhone}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Partner</p>
                  <p className="font-medium">{currentLead.lead.partner.name}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Category</p>
                  <p className="font-medium">{currentLead.lead.category.name}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Task</p>
                  <p className="font-medium">{currentLead.lead.task?.name ?? "-"}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">City</p>
                  <p className="font-medium">{currentLead.lead.city ?? "-"}</p>
                </div>
              </div>

              <Button className="w-fit" onClick={() => callLead(currentLead.lead.primaryPhone, currentLead.lead.id)}>
                <Phone size={16} /> Call Customer
              </Button>

              {lastOrderId && (
                <p className="text-sm text-brand-teal">
                  Order created —{" "}
                  <Link href="/agent/my-orders" className="underline">
                    open My Orders to add items
                  </Link>
                  .
                </p>
              )}

              {callStarted && (
                <div className="border-t border-slate-100 pt-4">
                  <p className="mb-2 text-sm font-medium text-slate-700">Call Result</p>
                  <CallOutcomeForm leadId={currentLead.lead.id} onSubmitted={handleOutcomeSubmitted} />
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </AgentShell>
  );
}
