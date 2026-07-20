"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { api } from "./api-client";

interface AutoRefreshSettings {
  enabled: boolean;
  defaultIntervalSeconds: number;
  minIntervalSeconds: number;
  maxIntervalSeconds: number;
  pauseWhileEditing: boolean;
  fallbackPollingEnabled: boolean;
  pageIntervals: Record<string, number>;
}

/**
 * Configurable polling refresh (spec section 19). Refreshes data via the
 * given callback without a full page reload, so callers keep their current
 * filters/pagination/search state — they just re-fetch into existing state.
 * Pauses while `paused` is true (e.g. a form or modal is open).
 */
export function useAutoRefresh(pageKey: string, onTick: () => void | Promise<void>, paused = false) {
  const [settings, setSettings] = useState<AutoRefreshSettings | null>(null);
  const onTickRef = useRef(onTick);
  onTickRef.current = onTick;

  useEffect(() => {
    api.get<AutoRefreshSettings>("/workflow-settings/auto-refresh").then(setSettings).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!settings || !settings.enabled || !settings.fallbackPollingEnabled) return;
    if (paused && settings.pauseWhileEditing) return;

    const seconds = settings.pageIntervals?.[pageKey] || settings.defaultIntervalSeconds;
    const clamped = Math.min(Math.max(seconds, settings.minIntervalSeconds), settings.maxIntervalSeconds);
    const interval = setInterval(() => {
      onTickRef.current();
    }, clamped * 1000);

    return () => clearInterval(interval);
  }, [settings, pageKey, paused]);

  const refreshNow = useCallback(() => onTickRef.current(), []);
  return { refreshNow, intervalSeconds: settings?.defaultIntervalSeconds };
}
