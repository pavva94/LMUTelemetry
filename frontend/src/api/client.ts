import type { CompetitorState, TelemetrySnapshot } from "../types/telemetry";
import type { RecommendationPayload, StrategyState } from "../types/strategy";
import type { SavedSession, SessionReview } from "../types/session";
import type { MotecSession, MotecSample } from "../types/motec";
import type { ProfileLap, ProfileLapResponse, ProfileSummary } from "../types/profile";

export const API_BASE = "";
export const WS_BASE = `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}`;

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
  sessions: () => getJson<SavedSession[]>("/api/sessions"),
  review: (limit = 5000) => getJson<SessionReview>(`/api/session/review?limit=${limit}`),
  reviewSession: (id: string, limit = 5000) => getJson<SessionReview>(`/api/session/review/${encodeURIComponent(id)}?limit=${limit}`),
  finalizeCurrentSession: async () => {
    const response = await fetch(`${API_BASE}/api/session/current/finalize`, { method: "POST" });
    if (!response.ok) throw new Error("session finalize failed");
    return response.json() as Promise<SavedSession>;
  },
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
  profileSummary: () => getJson<ProfileSummary>("/api/profile/summary"),
  profileBestLaps: () => getJson<ProfileLap[]>("/api/profile/best-laps"),
  profileLaps: (params: Record<string, string | number | boolean | null | undefined>) => {
    const search = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== null && value !== undefined && value !== "") search.set(key, String(value));
    });
    return getJson<ProfileLapResponse>(`/api/profile/laps?${search.toString()}`);
  },
  motecImport: async (file: File, metadata: Record<string, string>) => {
    const params = new URLSearchParams({ filename: file.name, ...metadata });
    const response = await fetch(`${API_BASE}/api/motec/sessions/import?${params.toString()}`, {
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
