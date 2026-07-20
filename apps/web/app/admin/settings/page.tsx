"use client";

import { useEffect, useState } from "react";
import { AdminShell } from "@/components/layout/admin-shell";
import { Card, CardHeader, CardTitle, CardContent, Label, Input, Select, Button } from "@lcrm/ui";
import { api } from "@/lib/api-client";

interface DistributionSettings {
  strategy: string;
  maxActiveLeadsPerAgent: number;
  allowNextBeforeCompletion: boolean;
  reservationTimeoutMinutes: number;
  autoReturnUntouched: boolean;
  maxLeadsPerHour: number;
}
interface SecuritySettings {
  maxFailedLoginAttempts: number;
  lockoutDurationMinutes: number;
  accessTokenTtlMinutes: number;
  refreshTokenTtlDays: number;
  maxUploadSizeMb: number;
}
interface InactivitySettings {
  enabled: boolean;
  inactivityThresholdMinutes: number;
  warningBeforeMinutes: number;
  gracePeriodMinutes: number;
  heartbeatIntervalSeconds: number;
  heartbeatTimeoutSeconds: number;
}
interface BreakThresholdSettings {
  warningMinutes: number;
}
interface AutoRefreshSettings {
  enabled: boolean;
  defaultIntervalSeconds: number;
  minIntervalSeconds: number;
  maxIntervalSeconds: number;
  pauseWhileEditing: boolean;
  realtimeEnabled: boolean;
  fallbackPollingEnabled: boolean;
}

export default function SettingsPage() {
  const [dist, setDist] = useState<DistributionSettings | null>(null);
  const [security, setSecurity] = useState<SecuritySettings | null>(null);
  const [inactivity, setInactivity] = useState<InactivitySettings | null>(null);
  const [breakThreshold, setBreakThreshold] = useState<BreakThresholdSettings | null>(null);
  const [autoRefresh, setAutoRefresh] = useState<AutoRefreshSettings | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    api.get<DistributionSettings>("/settings/distribution").then(setDist);
    api.get<SecuritySettings>("/settings/security").then(setSecurity);
    api.get<InactivitySettings>("/settings/inactivity").then(setInactivity);
    api.get<BreakThresholdSettings>("/settings/break-thresholds").then(setBreakThreshold);
    api.get<AutoRefreshSettings>("/settings/auto-refresh").then(setAutoRefresh);
  }, []);

  async function saveDist() {
    if (!dist) return;
    await api.put("/settings/distribution", dist);
    setSaved("Distribution settings saved");
  }
  async function saveSecurity() {
    if (!security) return;
    await api.put("/settings/security", security);
    setSaved("Security settings saved");
  }
  async function saveInactivity() {
    if (!inactivity) return;
    await api.put("/settings/inactivity", inactivity);
    setSaved("Inactivity settings saved");
  }
  async function saveBreakThreshold() {
    if (!breakThreshold) return;
    await api.put("/settings/break-thresholds", breakThreshold);
    setSaved("Break threshold settings saved");
  }
  async function saveAutoRefresh() {
    if (!autoRefresh) return;
    await api.put("/settings/auto-refresh", autoRefresh);
    setSaved("Auto refresh settings saved");
  }

  return (
    <AdminShell>
      <h1 className="text-xl font-semibold text-slate-900">Settings</h1>
      {saved && <p className="mt-2 text-sm text-emerald-600">{saved}</p>}

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {dist && (
          <Card>
            <CardHeader>
              <CardTitle>Lead Distribution</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div>
                <Label>Strategy</Label>
                <Select value={dist.strategy} onChange={(e) => setDist({ ...dist, strategy: e.target.value })}>
                  {[
                    "FIFO",
                    "OLDEST_FIRST",
                    "HIGHEST_PRIORITY",
                    "ROUND_ROBIN",
                    "WEIGHTED",
                    "PARTNER_PRIORITY",
                    "TASK_PRIORITY",
                    "REGION_MATCH",
                    "CATEGORY_MATCH",
                    "MANUAL",
                  ].map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label>Max active leads per agent</Label>
                <Input
                  type="number"
                  value={dist.maxActiveLeadsPerAgent}
                  onChange={(e) => setDist({ ...dist, maxActiveLeadsPerAgent: Number(e.target.value) })}
                />
              </div>
              <div>
                <Label>Reservation timeout (minutes)</Label>
                <Input
                  type="number"
                  value={dist.reservationTimeoutMinutes}
                  onChange={(e) => setDist({ ...dist, reservationTimeoutMinutes: Number(e.target.value) })}
                />
              </div>
              <div>
                <Label>Max leads per hour (0 = unlimited)</Label>
                <Input
                  type="number"
                  value={dist.maxLeadsPerHour}
                  onChange={(e) => setDist({ ...dist, maxLeadsPerHour: Number(e.target.value) })}
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={dist.allowNextBeforeCompletion}
                  onChange={(e) => setDist({ ...dist, allowNextBeforeCompletion: e.target.checked })}
                />
                Allow requesting next lead before completing current
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={dist.autoReturnUntouched}
                  onChange={(e) => setDist({ ...dist, autoReturnUntouched: e.target.checked })}
                />
                Auto-return untouched leads on reservation timeout
              </label>
              <Button onClick={saveDist} className="w-fit">
                Save
              </Button>
            </CardContent>
          </Card>
        )}

        {security && (
          <Card>
            <CardHeader>
              <CardTitle>Security</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div>
                <Label>Max failed login attempts</Label>
                <Input
                  type="number"
                  value={security.maxFailedLoginAttempts}
                  onChange={(e) => setSecurity({ ...security, maxFailedLoginAttempts: Number(e.target.value) })}
                />
              </div>
              <div>
                <Label>Lockout duration (minutes)</Label>
                <Input
                  type="number"
                  value={security.lockoutDurationMinutes}
                  onChange={(e) => setSecurity({ ...security, lockoutDurationMinutes: Number(e.target.value) })}
                />
              </div>
              <div>
                <Label>Access token TTL (minutes)</Label>
                <Input
                  type="number"
                  value={security.accessTokenTtlMinutes}
                  onChange={(e) => setSecurity({ ...security, accessTokenTtlMinutes: Number(e.target.value) })}
                />
              </div>
              <div>
                <Label>Refresh token TTL (days)</Label>
                <Input
                  type="number"
                  value={security.refreshTokenTtlDays}
                  onChange={(e) => setSecurity({ ...security, refreshTokenTtlDays: Number(e.target.value) })}
                />
              </div>
              <div>
                <Label>Max upload size (MB)</Label>
                <Input
                  type="number"
                  value={security.maxUploadSizeMb}
                  onChange={(e) => setSecurity({ ...security, maxUploadSizeMb: Number(e.target.value) })}
                />
              </div>
              <Button onClick={saveSecurity} className="w-fit">
                Save
              </Button>
            </CardContent>
          </Card>
        )}

        {inactivity && (
          <Card>
            <CardHeader>
              <CardTitle>Inactivity &amp; Standby</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={inactivity.enabled}
                  onChange={(e) => setInactivity({ ...inactivity, enabled: e.target.checked })}
                />
                Enabled
              </label>
              <div>
                <Label>Inactivity threshold (minutes)</Label>
                <Input
                  type="number"
                  value={inactivity.inactivityThresholdMinutes}
                  onChange={(e) =>
                    setInactivity({ ...inactivity, inactivityThresholdMinutes: Number(e.target.value) })
                  }
                />
              </div>
              <div>
                <Label>Grace period (minutes)</Label>
                <Input
                  type="number"
                  value={inactivity.gracePeriodMinutes}
                  onChange={(e) => setInactivity({ ...inactivity, gracePeriodMinutes: Number(e.target.value) })}
                />
              </div>
              <div>
                <Label>Heartbeat interval (seconds)</Label>
                <Input
                  type="number"
                  value={inactivity.heartbeatIntervalSeconds}
                  onChange={(e) =>
                    setInactivity({ ...inactivity, heartbeatIntervalSeconds: Number(e.target.value) })
                  }
                />
              </div>
              <div>
                <Label>Heartbeat timeout (seconds)</Label>
                <Input
                  type="number"
                  value={inactivity.heartbeatTimeoutSeconds}
                  onChange={(e) => setInactivity({ ...inactivity, heartbeatTimeoutSeconds: Number(e.target.value) })}
                />
              </div>
              <Button onClick={saveInactivity} className="w-fit">
                Save
              </Button>
            </CardContent>
          </Card>
        )}

        {breakThreshold && (
          <Card>
            <CardHeader>
              <CardTitle>Break Dashboard Thresholds</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div>
                <Label>Warning threshold (minutes) — red above this total</Label>
                <Input
                  type="number"
                  value={breakThreshold.warningMinutes}
                  onChange={(e) => setBreakThreshold({ ...breakThreshold, warningMinutes: Number(e.target.value) })}
                />
              </div>
              <Button onClick={saveBreakThreshold} className="w-fit">
                Save
              </Button>
            </CardContent>
          </Card>
        )}

        {autoRefresh && (
          <Card>
            <CardHeader>
              <CardTitle>Auto Refresh &amp; Realtime</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={autoRefresh.enabled}
                  onChange={(e) => setAutoRefresh({ ...autoRefresh, enabled: e.target.checked })}
                />
                Enabled
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={autoRefresh.realtimeEnabled}
                  onChange={(e) => setAutoRefresh({ ...autoRefresh, realtimeEnabled: e.target.checked })}
                />
                Use realtime WebSocket push (instant updates instead of waiting for the next poll)
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={autoRefresh.fallbackPollingEnabled}
                  onChange={(e) => setAutoRefresh({ ...autoRefresh, fallbackPollingEnabled: e.target.checked })}
                />
                Fall back to polling when the realtime connection is unavailable
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={autoRefresh.pauseWhileEditing}
                  onChange={(e) => setAutoRefresh({ ...autoRefresh, pauseWhileEditing: e.target.checked })}
                />
                Pause refreshing while a form or modal is open
              </label>
              <div>
                <Label>Default polling interval (seconds)</Label>
                <Input
                  type="number"
                  value={autoRefresh.defaultIntervalSeconds}
                  onChange={(e) => setAutoRefresh({ ...autoRefresh, defaultIntervalSeconds: Number(e.target.value) })}
                />
              </div>
              <div>
                <Label>Minimum interval (seconds)</Label>
                <Input
                  type="number"
                  value={autoRefresh.minIntervalSeconds}
                  onChange={(e) => setAutoRefresh({ ...autoRefresh, minIntervalSeconds: Number(e.target.value) })}
                />
              </div>
              <div>
                <Label>Maximum interval (seconds)</Label>
                <Input
                  type="number"
                  value={autoRefresh.maxIntervalSeconds}
                  onChange={(e) => setAutoRefresh({ ...autoRefresh, maxIntervalSeconds: Number(e.target.value) })}
                />
              </div>
              <Button onClick={saveAutoRefresh} className="w-fit">
                Save
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </AdminShell>
  );
}
