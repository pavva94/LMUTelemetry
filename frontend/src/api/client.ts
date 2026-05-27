import type { CompetitorState, TelemetrySnapshot } from "../types/telemetry";
import type { RecommendationPayload, StrategyState } from "../types/strategy";
import type { SessionReview } from "../types/session";
import type { MotecSession, MotecSample } from "../types/motec";

export const API_BASE = "http://127.0.0.1:8000";
export const WS_BASE = "ws://127.0.0.1:8000";

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`);
  if (!response.ok) throw new Error(`${path} failed with ${response.status}`);
  return response.json();
}

export const api = {
  health: () => getJson<Record<string, unknown>>("/api/health"),
  latestTelemetry: () => getJson<TelemetrySnapshot>("/api/telemetry/latest"),
  strategy: () => getJson<StrategyState>("/api/strategy/current"),
  competitors: () => getJson<CompetitorState[]>("/api/competitors"),
  recommendation: () => getJson<RecommendationPayload>("/api/recommendations/current"),
  review: () => getJson<SessionReview>("/api/session/review"),
  updateAssumptions: async (body: Record<string, number>) => {
    const response = await fetch(`${API_BASE}/api/strategy/assumptions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error("assumption update failed");
    return response.json() as Promise<StrategyState>;
  },
  motecSessions: () => getJson<MotecSession[]>("/api/motec/sessions"),
  motecSession: (id: string) => getJson<MotecSession>(`/api/motec/sessions/${id}`),
  motecImport: async (file: File) => {
    const response = await fetch(`${API_BASE}/api/motec/sessions/import?filename=${encodeURIComponent(file.name)}`, {
      method: "POST",
      headers: { "Content-Type": "text/csv" },
      body: file,
    });
    if (!response.ok) throw new Error((await response.text()) || "CSV import failed");
    return response.json() as Promise<MotecSession>;
  },
  motecSamples: (sessionId: string, channels: string[], lap?: string, maxPoints = 3000) => {
    const params = new URLSearchParams({ channels: channels.join(","), max_points: String(maxPoints) });
    if (lap) params.set("lap", lap);
    return getJson<{ totalSamples: number; returnedSamples: number; decimation: number; samples: MotecSample[] }>(`/api/motec/sessions/${sessionId}/samples?${params}`);
  },
};
