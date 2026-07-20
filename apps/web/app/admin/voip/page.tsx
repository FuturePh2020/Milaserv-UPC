"use client";

import { useEffect, useState } from "react";
import { AdminShell } from "@/components/layout/admin-shell";
import { Card, CardHeader, CardTitle, CardContent, Label, Input, Button, Badge } from "@lcrm/ui";
import { api } from "@/lib/api-client";

interface VoipSettings {
  providerName: string;
  apiBaseUrl?: string | null;
  apiKeyConfigured: boolean;
  apiSecretConfigured: boolean;
  webhookSecretConfigured: boolean;
  pollingIntervalSeconds: number;
  isActive: boolean;
}

export default function VoipSettingsPage() {
  const [settings, setSettings] = useState<VoipSettings | null>(null);
  const [form, setForm] = useState({
    providerName: "",
    apiBaseUrl: "",
    apiKey: "",
    apiSecret: "",
    webhookSecret: "",
    pollingIntervalSeconds: 30,
    isActive: false,
  });
  const [saved, setSaved] = useState(false);

  async function load() {
    const s = await api.get<VoipSettings>("/voip/settings");
    setSettings(s);
    setForm((f) => ({
      ...f,
      providerName: s.providerName,
      apiBaseUrl: s.apiBaseUrl ?? "",
      pollingIntervalSeconds: s.pollingIntervalSeconds,
      isActive: s.isActive,
    }));
  }

  useEffect(() => {
    load().catch(() => undefined);
  }, []);

  async function save() {
    await api.post("/voip/settings", form);
    setSaved(true);
    await load();
  }

  return (
    <AdminShell>
      <h1 className="text-xl font-semibold text-slate-900">VoIP Integration</h1>
      <p className="text-sm text-slate-500">
        Credentials are encrypted at rest and never exposed back to the browser. Currently shipping with a mock
        provider; connect a real vendor by implementing the <code>VoipProviderAdapter</code> interface.
      </p>

      <Card className="mt-6 max-w-2xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Provider Settings
            {settings && <Badge variant={settings.isActive ? "success" : "secondary"}>{settings.isActive ? "Active" : "Inactive"}</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div>
            <Label>Provider Name</Label>
            <Input value={form.providerName} onChange={(e) => setForm({ ...form, providerName: e.target.value })} />
          </div>
          <div>
            <Label>API Base URL</Label>
            <Input value={form.apiBaseUrl} onChange={(e) => setForm({ ...form, apiBaseUrl: e.target.value })} />
          </div>
          <div>
            <Label>API Key {settings?.apiKeyConfigured && <span className="text-emerald-600">(configured)</span>}</Label>
            <Input
              type="password"
              placeholder="Leave blank to keep existing"
              value={form.apiKey}
              onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
            />
          </div>
          <div>
            <Label>API Secret {settings?.apiSecretConfigured && <span className="text-emerald-600">(configured)</span>}</Label>
            <Input
              type="password"
              placeholder="Leave blank to keep existing"
              value={form.apiSecret}
              onChange={(e) => setForm({ ...form, apiSecret: e.target.value })}
            />
          </div>
          <div>
            <Label>
              Webhook Secret {settings?.webhookSecretConfigured && <span className="text-emerald-600">(configured)</span>}
            </Label>
            <Input
              type="password"
              placeholder="Leave blank to keep existing"
              value={form.webhookSecret}
              onChange={(e) => setForm({ ...form, webhookSecret: e.target.value })}
            />
          </div>
          <div>
            <Label>Polling Interval (seconds)</Label>
            <Input
              type="number"
              value={form.pollingIntervalSeconds}
              onChange={(e) => setForm({ ...form, pollingIntervalSeconds: Number(e.target.value) })}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
            />
            Active
          </label>
          <Button onClick={save} className="w-fit">
            Save
          </Button>
          {saved && <p className="text-sm text-emerald-600">Saved</p>}
        </CardContent>
      </Card>
    </AdminShell>
  );
}
