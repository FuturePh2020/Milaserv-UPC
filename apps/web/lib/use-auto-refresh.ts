"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { api } from "./api-client";
import { useRealtimeChannel } from "./use-realtime-channel";

interface AutoRefreshSettings {
  enabled: boolean;
  defaultIntervalSeconds: number;
  minIntervalSeconds: number;
  maxIntervalSeconds: number;
  pauseWhileEditing: boolean;
  realtimeEnabled: boolean;
  fallbackPollingEnabled: boolean;
  pageIntervals: Record<string, number>;
}

/**
 * Realtime-first refresh with configurable polling fallback (spec section
 * 19). Refreshes data via the given callback without a full page reload, so
 * callers keep their current filters/pagination/search state — they just
 * re-fetch into existing state. Pauses while `paused` is true (e.g. a form
 * or modal is open). Subscribes to a WebSocket channel (named after
 * `pageKey` by default) for instant pushes; falls back to interval polling
 * only while that socket is disconnected.
 */
export function useAutoRefresh(
  pageKey: string,
  onTick: () => void | Promise<void>,
  paused = false,
  realtimeChannel: string | null = pageKey,
) {
  const [settings, setSettings] = useState<AutoRefreshSettings | null>(null);
  const onTickRef = useRef(onTick);
  onTickRef.current = onTick;

  useEffect(() => {
    api.get<AutoRefreshSettings>("/workflow-settings/auto-refresh").then(setSettings).catch(() => undefined);
  }, []);

  const isPaused = paused && settings?.pauseWhileEditing;
  const wantsRealtime = !isPaused && settings?.enabled && settings?.realtimeEnabled;
  const { connected } = useRealtimeChannel(wantsRealtime ? realtimeChannel : null, () => onTickRef.current());

  useEffect(() => {
    if (!settings || !settings.enabled || !settings.fallbackPollingEnabled) return;
    if (isPaused) return;
    if (connected) return; // realtime channel is live — polling is only the fallback path

    const seconds = settings.pageIntervals?.[pageKey] || settings.defaultIntervalSeconds;
    const clamped = Math.min(Math.max(seconds, settings.minIntervalSeconds), settings.maxIntervalSeconds);
    const interval = setInterval(() => {
      onTickRef.current();
    }, clamped * 1000);

    return () => clearInterval(interval);
  }, [settings, pageKey, isPaused, connected]);

  const refreshNow = useCallback(() => onTickRef.current(), []);
  return { refreshNow, intervalSeconds: settings?.defaultIntervalSeconds, realtimeConnected: connected };
}
