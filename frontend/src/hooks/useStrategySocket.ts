import { useEffect, useRef, useState } from "react";
import { api, WS_BASE } from "../api/client";
import type { RecommendationPayload, StrategyState } from "../types/strategy";

export function useStrategySocket(enabled = true) {
  const [strategy, setStrategy] = useState<StrategyState | null>(null);
  const [recommendation, setRecommendation] = useState<RecommendationPayload | null>(null);
  const [socketConnected, setSocketConnected] = useState(false);
  const [apiReachable, setApiReachable] = useState(false);
  const retry = useRef<number>();

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const [nextStrategy, nextRecommendation] = await Promise.all([api.strategy(), api.recommendation()]);
        if (!cancelled) {
          setStrategy(nextStrategy);
          setRecommendation(nextRecommendation);
          setApiReachable(true);
        }
      } catch {
        if (!cancelled) setApiReachable(false);
      }
    };
    void poll();
    const id = window.setInterval(() => void poll(), 2000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    let strategySocket: WebSocket | null = null;
    let recommendationSocket: WebSocket | null = null;
    let cancelled = false;
    const connect = () => {
      strategySocket = new WebSocket(`${WS_BASE}/ws/strategy`);
      recommendationSocket = new WebSocket(`${WS_BASE}/ws/recommendations`);
      strategySocket.onopen = () => setSocketConnected(true);
      strategySocket.onclose = () => {
        setSocketConnected(false);
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
  }, [enabled]);
  return { strategy, recommendation, connected: socketConnected || apiReachable };
}
