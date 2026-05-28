import { useEffect, useRef, useState } from "react";
import { api, WS_BASE } from "../api/client";
import type { TelemetrySnapshot } from "../types/telemetry";

export function useTelemetrySocket() {
  const [data, setData] = useState<TelemetrySnapshot | null>(null);
  const [socketConnected, setSocketConnected] = useState(false);
  const [apiReachable, setApiReachable] = useState(false);
  const retry = useRef<number>();

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const snapshot = await api.latestTelemetry();
        if (!cancelled) {
          setData(snapshot);
          setApiReachable(true);
        }
      } catch {
        if (!cancelled) setApiReachable(false);
      }
    };
    void poll();
    const id = window.setInterval(() => void poll(), 1000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let cancelled = false;
    const connect = () => {
      socket = new WebSocket(`${WS_BASE}/ws/telemetry`);
      socket.onopen = () => setSocketConnected(true);
      socket.onclose = () => {
        setSocketConnected(false);
        if (!cancelled) retry.current = window.setTimeout(connect, 1200);
      };
      socket.onerror = () => socket?.close();
      socket.onmessage = (event) => {
        try {
          setData(JSON.parse(event.data));
        } catch {
          // Ignore malformed frames; the next valid telemetry update will replace it.
        }
      };
    };
    connect();
    return () => {
      cancelled = true;
      if (retry.current) window.clearTimeout(retry.current);
      socket?.close();
    };
  }, []);
  return { data, connected: socketConnected || apiReachable };
}
