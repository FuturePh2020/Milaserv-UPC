"use client";

import { useState } from "react";
import { Button, Select, Textarea, Label, Input } from "@lcrm/ui";
import { api, ApiError } from "@/lib/api-client";

const ANSWERED_OUTCOMES = [
  { value: "ORDER_CREATED", label: "Order Created" },
  { value: "NOT_INTERESTED", label: "Not Interested" },
  { value: "WRONG_TIME", label: "Wrong Time" },
  { value: "RESCHEDULE_CALL", label: "Reschedule Call" },
  { value: "ALREADY_DISPENSED", label: "Already Dispensed" },
  { value: "INTERESTED_FOLLOWUP", label: "Interested for Follow-up" },
  { value: "WRONG_LEAD", label: "Wrong Lead" },
];

const TIMING_TYPES = [
  { value: "EXACT_TIME", label: "Exact Time" },
  { value: "MORNING", label: "Morning" },
  { value: "EVENING", label: "Evening" },
];

interface Props {
  leadId: string;
  onSubmitted: (result: { orderId?: string }) => void;
}

export function CallOutcomeForm({ leadId, onSubmitted }: Props) {
  const [callResult, setCallResult] = useState<"" | "NO_ANSWER" | "ANSWERED">("");
  const [answeredOutcome, setAnsweredOutcome] = useState("");
  const [form, setForm] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function set(field: string, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function submit() {
    setError(null);
    if (!callResult) {
      setError("Select a call result");
      return;
    }
    if (callResult === "ANSWERED" && !answeredOutcome) {
      setError("Select an outcome");
      return;
    }
    if (answeredOutcome === "ORDER_CREATED" && !form.externalOrderNumber?.trim()) {
      setError("External Order Number is required");
      return;
    }

    setSubmitting(true);
    try {
      const result = await api.post<{ orderId?: string }>("/call-outcomes", {
        leadId,
        callResult,
        answeredOutcome: callResult === "ANSWERED" ? answeredOutcome : undefined,
        notes: form.notes,
        nextCallAt: form.nextCallAt || undefined,
        notInterestedReason: form.notInterestedReason || undefined,
        preferredCallbackDate: form.preferredCallbackDate || undefined,
        preferredCallbackTime: form.preferredCallbackTime || undefined,
        followUpDate: form.followUpDate || undefined,
        contactTimingType: form.contactTimingType || undefined,
        exactTime: form.exactTime || undefined,
        followUpPriority: form.followUpPriority || undefined,
        lastDispensingDate: form.lastDispensingDate || undefined,
        expectedNextRefillDate: form.expectedNextRefillDate || undefined,
        wrongLeadReason: form.wrongLeadReason || undefined,
        externalOrderNumber: form.externalOrderNumber || undefined,
      });
      setCallResult("");
      setAnsweredOutcome("");
      setForm({});
      onSubmitted(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save call outcome");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-4">
      <div>
        <Label>Call Result</Label>
        <Select aria-label="Call Result" value={callResult} onChange={(e) => setCallResult(e.target.value as any)}>
          <option value="">Select call result</option>
          <option value="NO_ANSWER">No Answer</option>
          <option value="ANSWERED">Answered</option>
        </Select>
      </div>

      {callResult === "NO_ANSWER" && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <Label>Next Call Date/Time (optional)</Label>
            <Input type="datetime-local" value={form.nextCallAt ?? ""} onChange={(e) => set("nextCallAt", e.target.value)} />
          </div>
        </div>
      )}

      {callResult === "ANSWERED" && (
        <div>
          <Label>Outcome</Label>
          <Select aria-label="Outcome" value={answeredOutcome} onChange={(e) => setAnsweredOutcome(e.target.value)}>
            <option value="">Select outcome</option>
            {ANSWERED_OUTCOMES.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>
      )}

      {answeredOutcome === "ORDER_CREATED" && (
        <div>
          <Label>External Order Number</Label>
          <Input
            value={form.externalOrderNumber ?? ""}
            onChange={(e) => set("externalOrderNumber", e.target.value)}
            placeholder="From the external order-management system"
          />
        </div>
      )}

      {answeredOutcome === "NOT_INTERESTED" && (
        <div>
          <Label>Not Interested Reason (optional)</Label>
          <Input value={form.notInterestedReason ?? ""} onChange={(e) => set("notInterestedReason", e.target.value)} />
        </div>
      )}

      {answeredOutcome === "WRONG_TIME" && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <Label>Preferred Callback Date</Label>
            <Input type="date" value={form.preferredCallbackDate ?? ""} onChange={(e) => set("preferredCallbackDate", e.target.value)} />
          </div>
          <div>
            <Label>Preferred Callback Time</Label>
            <Input type="time" value={form.preferredCallbackTime ?? ""} onChange={(e) => set("preferredCallbackTime", e.target.value)} />
          </div>
        </div>
      )}

      {(answeredOutcome === "RESCHEDULE_CALL" || answeredOutcome === "INTERESTED_FOLLOWUP") && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <Label>Follow-up Date</Label>
            <Input type="date" value={form.followUpDate ?? ""} onChange={(e) => set("followUpDate", e.target.value)} />
          </div>
          <div>
            <Label>Contact Timing</Label>
            <Select value={form.contactTimingType ?? ""} onChange={(e) => set("contactTimingType", e.target.value)}>
              <option value="">Select timing</option>
              {TIMING_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
          </div>
          {form.contactTimingType === "EXACT_TIME" && (
            <div>
              <Label>Exact Time</Label>
              <Input type="time" value={form.exactTime ?? ""} onChange={(e) => set("exactTime", e.target.value)} />
            </div>
          )}
          {answeredOutcome === "INTERESTED_FOLLOWUP" && (
            <div>
              <Label>Follow-up Priority</Label>
              <Select value={form.followUpPriority ?? ""} onChange={(e) => set("followUpPriority", e.target.value)}>
                <option value="">Select priority</option>
                <option value="LOW">Low</option>
                <option value="MEDIUM">Medium</option>
                <option value="HIGH">High</option>
              </Select>
            </div>
          )}
        </div>
      )}

      {answeredOutcome === "ALREADY_DISPENSED" && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <Label>Last Dispensing Date</Label>
            <Input type="date" value={form.lastDispensingDate ?? ""} onChange={(e) => set("lastDispensingDate", e.target.value)} />
          </div>
          <div>
            <Label>Expected Next Refill Date (optional)</Label>
            <Input type="date" value={form.expectedNextRefillDate ?? ""} onChange={(e) => set("expectedNextRefillDate", e.target.value)} />
          </div>
        </div>
      )}

      {answeredOutcome === "WRONG_LEAD" && (
        <div>
          <Label>Wrong Lead Reason</Label>
          <Select value={form.wrongLeadReason ?? ""} onChange={(e) => set("wrongLeadReason", e.target.value)}>
            <option value="">Select reason</option>
            <option value="Wrong customer">Wrong customer</option>
            <option value="Wrong phone number">Wrong phone number</option>
            <option value="Duplicate lead">Duplicate lead</option>
            <option value="Customer does not belong to Partner">Customer does not belong to Partner</option>
            <option value="Invalid insurance data">Invalid insurance data</option>
            <option value="Other">Other</option>
          </Select>
        </div>
      )}

      {callResult && (
        <div>
          <Label>Notes</Label>
          <Textarea aria-label="Notes" value={form.notes ?? ""} onChange={(e) => set("notes", e.target.value)} placeholder="Notes" />
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      {callResult && (
        <Button onClick={submit} disabled={submitting} className="w-fit">
          {submitting ? "Saving..." : "Save Call Outcome"}
        </Button>
      )}
    </div>
  );
}
