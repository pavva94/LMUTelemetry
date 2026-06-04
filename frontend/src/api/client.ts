import type { CompetitorState, TelemetrySnapshot } from "../types/telemetry";
import type { RecommendationPayload, StrategyState } from "../types/strategy";
import type { SavedSession, SessionDashboard, SessionReview } from "../types/session";
import type { LmuDuckdbScanResponse, LmuDuckdbSettings } from "../types/lmuDuckdb";
import type { LiveLapAnalysis } from "../types/liveLapAnalysis";
import type { MotecSession, MotecSample } from "../types/motec";
import type { ProfileLap, ProfileLapResponse, ProfileOverview, ProfileSummary } from "../types/profile";

export const API_BASE = "";
export const WS_BASE = `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}`;
export const REVIEW_SAMPLE_LIMIT = 1200;

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`);
  if (!response.ok) throw new Error(`${path} failed with ${response.status}`);
  return response.json();
}

async function postJson<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error((await response.text()) || `${path} failed with ${response.status}`);
  return response.json();
}

export const api = {
  health: () => getJson<Record<string, unknown>>("/api/health"),
  latestTelemetry: () => getJson<TelemetrySnapshot>("/api/telemetry/latest"),
  strategy: () => getJson<StrategyState>("/api/strategy/current"),
  competitors: () => getJson<CompetitorState[]>("/api/competitors"),
  recommendation: () => getJson<RecommendationPayload>("/api/recommendations/current"),
  sessions: () => getJson<SavedSession[]>("/api/sessions"),
  review: (limit = REVIEW_SAMPLE_LIMIT) => getJson<SessionReview>(`/api/session/review?limit=${limit}`),
  reviewSession: (id: string, limit = REVIEW_SAMPLE_LIMIT) => getJson<SessionReview>(`/api/session/review/${encodeURIComponent(id)}?limit=${limit}`),
  sessionDashboard: (id: string) => getJson<SessionDashboard>(`/api/session/review/${encodeURIComponent(id)}/dashboard`),
  liveLapAnalysis: (selectedLap?: number | null, referenceLap?: number | null) => {
    const params = new URLSearchParams();
    if (selectedLap != null) params.set("selected_lap", String(selectedLap));
    if (referenceLap != null) params.set("reference_lap", String(referenceLap));
    const suffix = params.toString() ? `?${params}` : "";
    return getJson<LiveLapAnalysis>(`/api/live-lap-analysis${suffix}`);
  },
  finalizeCurrentSession: async () => {
    const response = await fetch(`${API_BASE}/api/session/current/finalize`, { method: "POST" });
    if (!response.ok) throw new Error("session finalize failed");
    return response.json() as Promise<SavedSession>;
  },
  removeSession: async (id: string) => {
    const response = await fetch(`${API_BASE}/api/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!response.ok) throw new Error("session remove failed");
    return response.json() as Promise<SavedSession>;
  },
  updateAssumptions: async (body: Record<string, number | boolean>) => {
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
  scanLmuDuckdbFolder: (path: string, limit = 250, offset = 0) =>
    postJson<LmuDuckdbScanResponse>(`/api/lmu-duckdb/sessions?limit=${limit}&offset=${offset}`, { path }),
  lmuDuckdbSettings: () => getJson<LmuDuckdbSettings>("/api/lmu-duckdb/settings"),
  saveLmuDuckdbSettings: (path: string) => postJson<LmuDuckdbSettings>("/api/lmu-duckdb/settings", { path }),
  syncLmuDuckdb: (path?: string) => postJson<LmuDuckdbSettings>("/api/lmu-duckdb/sync", path ? { path } : {}),
  lmuDuckdbSessions: (limit = 250, offset = 0) => getJson<LmuDuckdbScanResponse>(`/api/lmu-duckdb/sessions?limit=${limit}&offset=${offset}`),
  reviewLmuDuckdbSession: (path: string, id: string, limit = REVIEW_SAMPLE_LIMIT) =>
    postJson<SessionReview>(`/api/lmu-duckdb/sessions/${encodeURIComponent(id)}/review?limit=${limit}`, { path }),
  reviewCachedLmuDuckdbSession: (id: string, limit = REVIEW_SAMPLE_LIMIT) =>
    getJson<SessionReview>(`/api/lmu-duckdb/sessions/${encodeURIComponent(id)}/review?limit=${limit}`),
  profileOverview: () => getJson<ProfileOverview>("/api/profile/overview"),
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
