import { useEffect, useRef, useState } from "react";
import type { TeamPresence, TeamSessionConfig, TeamSnapshot } from "../types/team";
import type { TelemetrySnapshot } from "../types/telemetry";

const emptySnapshot: TeamSnapshot = { telemetry: null, strategy: null, recommendation: null };

function websocketUrl(cloudUrl: string, code: string) {
  const url = new URL(cloudUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `/ws/cloud/${encodeURIComponent(code)}`;
  return url.toString();
}

export function useTeamTelemetrySocket(config: TeamSessionConfig | null) {
  const [snapshot, setSnapshot] = useState<TeamSnapshot>(emptySnapshot);
  const [presence, setPresence] = useState<TeamPresence>({});
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [trace, setTrace] = useState<TelemetrySnapshot[]>([]);
  const retry = useRef<number>();

  useEffect(() => {
    setSnapshot(emptySnapshot);
    setPresence({});
    setTrace([]);
    if (!config) {
      setConnected(false);
      return;
    }
    let cancelled = false;
    let socket: WebSocket | null = null;
    let heartbeat: number | undefined;
    let delay = 600;

    const connect = async () => {
      try {
        const base = config.cloudUrl.replace(/\/+$/, "");
        const response = await fetch(`${base}/api/cloud/sessions/${encodeURIComponent(config.sessionCode)}/ticket`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            display_name: config.displayName,
            role: "viewer",
            access_key: config.accessKey,
          }),
        });
        if (!response.ok) throw new Error((await response.text()) || `Session lookup failed (${response.status})`);
        const { ticket } = await response.json() as { ticket: string };
        if (cancelled) return;
        socket = new WebSocket(
          websocketUrl(base, config.sessionCode),
          ["lmu.telemetry.v1", `lmu-ticket.${ticket}`],
        );
        socket.onopen = () => {
          delay = 600;
          setConnected(true);
          setError(null);
          heartbeat = window.setInterval(() => socket?.readyState === WebSocket.OPEN && socket.send("ping"), 5000);
        };
        socket.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data) as { kind?: string; payload?: Record<string, unknown> };
            if (message.kind === "presence") {
              setPresence(message.payload as TeamPresence);
              return;
            }
            if (message.kind !== "snapshot" || !message.payload) return;
            const next = message.payload as unknown as TeamSnapshot;
            setSnapshot(next);
            if (next.telemetry) {
              setTrace((current) => [...current.slice(-1499), next.telemetry as TelemetrySnapshot]);
            }
          } catch {
            // The next valid relay frame replaces malformed data.
          }
        };
        socket.onerror = () => socket?.close();
        socket.onclose = () => {
          setConnected(false);
          if (heartbeat) window.clearInterval(heartbeat);
          if (!cancelled) {
            retry.current = window.setTimeout(() => void connect(), delay);
            delay = Math.min(10_000, delay * 1.8);
          }
        };
      } catch (reason) {
        setConnected(false);
        setError(reason instanceof Error ? reason.message : "Could not connect to the team session");
        if (!cancelled) {
          retry.current = window.setTimeout(() => void connect(), delay);
          delay = Math.min(10_000, delay * 1.8);
        }
      }
    };
    void connect();
    return () => {
      cancelled = true;
      if (retry.current) window.clearTimeout(retry.current);
      if (heartbeat) window.clearInterval(heartbeat);
      socket?.close();
    };
  }, [config?.accessKey, config?.cloudUrl, config?.displayName, config?.sessionCode]);

  return { ...snapshot, presence, connected, error, trace };
}

