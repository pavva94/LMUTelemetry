import { useEffect, useRef, useState } from "react";
import { WS_BASE } from "../api/client";
import type { TelemetrySnapshot } from "../types/telemetry";

export function useTelemetrySocket() {
  const [data, setData] = useState<TelemetrySnapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const retry = useRef<number>();
  useEffect(() => {
    let socket: WebSocket | null = null;
    let cancelled = false;
    const connect = () => {
      socket = new WebSocket(`${WS_BASE}/ws/telemetry`);
      socket.onopen = () => setConnected(true);
      socket.onclose = () => {
        setConnected(false);
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
  return { data, connected };
}
