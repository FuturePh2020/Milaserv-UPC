"use client";

import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";

let sharedSocket: Socket | null = null;

/**
 * One socket.io connection shared by every page in the tab. Connects
 * same-origin by default (works behind the nginx `/api/` proxy in
 * production); set NEXT_PUBLIC_API_ORIGIN for local dev where the web app
 * (3000) and API (4000) run as separate origins with no reverse proxy.
 */
function getSharedSocket(): Socket {
  if (!sharedSocket) {
    const origin = process.env.NEXT_PUBLIC_API_ORIGIN || undefined;
    sharedSocket = io(origin, {
      path: "/api/socket.io",
      withCredentials: true,
      transports: ["websocket", "polling"],
    });
  }
  return sharedSocket;
}

/**
 * Subscribes to realtime "refresh" pushes for a channel (spec section 19:
 * WebSocket/SSE preferred, polling fallback). Returns whether the socket is
 * currently connected so useAutoRefresh can fall back to interval polling
 * while it isn't.
 */
export function useRealtimeChannel(channel: string | null, onRefresh: () => void): { connected: boolean } {
  const [connected, setConnected] = useState(false);
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  useEffect(() => {
    if (!channel) return;
    const socket = getSharedSocket();
    setConnected(socket.connected);

    const handleConnect = () => {
      setConnected(true);
      socket.emit("subscribe", [channel]);
    };
    const handleDisconnect = () => setConnected(false);
    const handleRefresh = (payload: { channel: string }) => {
      if (payload.channel === channel) onRefreshRef.current();
    };

    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    socket.on("refresh", handleRefresh);
    if (socket.connected) socket.emit("subscribe", [channel]);

    return () => {
      socket.emit("unsubscribe", [channel]);
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
      socket.off("refresh", handleRefresh);
    };
  }, [channel]);

  return { connected };
}
