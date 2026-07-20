"use client";

import { useEffect, useState } from "react";
import { Card, CardHeader, CardTitle, CardContent, Badge } from "@lcrm/ui";
import { api } from "@/lib/api-client";

interface TimelineEventRow {
  id: string;
  eventType: string;
  actorRole?: string | null;
  source: string;
  notes?: string | null;
  previousValue?: unknown;
  newValue?: unknown;
  createdAt: string;
}

function formatEventType(eventType: string) {
  return eventType
    .toLowerCase()
    .split("_")
    .map((w) => w[0]?.toUpperCase() + w.slice(1))
    .join(" ");
}

export function TimelineFeed({ entityType, entityId }: { entityType: string; entityId: string }) {
  const [events, setEvents] = useState<TimelineEventRow[]>([]);

  useEffect(() => {
    if (!entityId) return;
    api
      .get<TimelineEventRow[]>(`/timeline?entityType=${entityType}&entityId=${entityId}`)
      .then(setEvents)
      .catch(() => undefined);
  }, [entityType, entityId]);

  if (events.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Timeline</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-slate-500">No timeline events yet.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Timeline</CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="flex flex-col gap-3 border-l border-slate-200 pl-4">
          {events.map((e) => (
            <li key={e.id} className="relative">
              <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-brand-teal" />
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-slate-900">{formatEventType(e.eventType)}</span>
                <Badge variant="secondary">{e.source}</Badge>
                <span className="text-xs text-slate-400">{new Date(e.createdAt).toLocaleString()}</span>
              </div>
              {e.notes && <p className="mt-0.5 text-sm text-slate-600">{e.notes}</p>}
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
