import { useEffect, useRef, useState } from "react";
import { WS_BASE } from "../api/client";
import type { RecommendationPayload, StrategyState } from "../types/strategy";

export function useStrategySocket() {
  const [strategy, setStrategy] = useState<StrategyState | null>(null);
  const [recommendation, setRecommendation] = useState<RecommendationPayload | null>(null);
  const [connected, setConnected] = useState(false);
  const retry = useRef<number>();
  useEffect(() => {
    let strategySocket: WebSocket | null = null;
    let recommendationSocket: WebSocket | null = null;
    let cancelled = false;
    const connect = () => {
      strategySocket = new WebSocket(`${WS_BASE}/ws/strategy`);
      recommendationSocket = new WebSocket(`${WS_BASE}/ws/recommendations`);
      strategySocket.onopen = () => setConnected(true);
      strategySocket.onclose = () => {
        setConnected(false);
        if (!cancelled) retry.current = window.setTimeout(connect, 1200);
      };
      strategySocket.onerror = () => strategySocket?.close();
      strategySocket.onmessage = (event) => {
        try { setStrategy(JSON.parse(event.data)); } catch {}
      };
      recommendationSocket.onmessage = (event) => {
        try { setRecommendation(JSON.parse(event.data)); } catch {}
      };
    };
    connect();
    return () => {
      cancelled = true;
      if (retry.current) window.clearTimeout(retry.current);
      strategySocket?.close();
      recommendationSocket?.close();
    };
  }, []);
  return { strategy, recommendation, connected };
}
