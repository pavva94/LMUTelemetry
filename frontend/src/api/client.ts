import type { CompetitorState, TelemetrySnapshot } from "../types/telemetry";
import type { RecommendationPayload, StrategyState } from "../types/strategy";
import type { PerformanceReportConfiguration, PerformanceReportRecord, SavedSession, SessionDashboard, SessionReview } from "../types/session";
import type { DuckdbJobStatus, LmuDuckdbScanResponse, LmuDuckdbSettings, LmuDuckdbSyncStatus } from "../types/lmuDuckdb";
import type { LiveLapAnalysis } from "../types/liveLapAnalysis";
import type { ProfileLap, ProfileLapResponse, ProfileOverview, ProfileSummary } from "../types/profile";
import type { RaceSimulationResult } from "../types/raceSimulation";

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
  liveLapAnalysis: (selectedLap?: number | null, referenceLap?: number | null, analysisLaps?: number[] | null) => {
    const params = new URLSearchParams();
    if (selectedLap != null) params.set("selected_lap", String(selectedLap));
    if (referenceLap != null) params.set("reference_lap", String(referenceLap));
    if (analysisLaps != null) params.set("analysis_laps", analysisLaps.join(","));
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
  updateAssumptions: async (body: Record<string, number | boolean | string>) => {
    const response = await fetch(`${API_BASE}/api/strategy/assumptions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error("assumption update failed");
    return response.json() as Promise<StrategyState>;
  },
  scanLmuDuckdbFolder: (path: string, limit = 250, offset = 0) =>
    postJson<LmuDuckdbScanResponse>(`/api/lmu-duckdb/sessions?limit=${limit}&offset=${offset}`, { path }),
  lmuDuckdbSettings: () => getJson<LmuDuckdbSettings>("/api/lmu-duckdb/settings"),
  saveLmuDuckdbSettings: (path: string) => postJson<LmuDuckdbSettings>("/api/lmu-duckdb/settings", { path }),
  syncLmuDuckdb: (path?: string) => postJson<LmuDuckdbSettings>("/api/lmu-duckdb/sync", path ? { path } : {}),
  startLmuDuckdbSyncRun: (path?: string) => postJson<LmuDuckdbSyncStatus>("/api/lmu-duckdb/sync-runs", path ? { path } : {}),
  currentLmuDuckdbSyncRun: () => getJson<LmuDuckdbSyncStatus | null>("/api/lmu-duckdb/sync-runs/current"),
  lmuDuckdbSessions: (limit = 250, offset = 0) => getJson<LmuDuckdbScanResponse>(`/api/lmu-duckdb/sessions?limit=${limit}&offset=${offset}`),
  reviewLmuDuckdbSession: (path: string, id: string, limit = REVIEW_SAMPLE_LIMIT) =>
    postJson<SessionReview>(`/api/lmu-duckdb/sessions/${encodeURIComponent(id)}/review?limit=${limit}`, { path }),
  reviewCachedLmuDuckdbSession: (id: string, limit = REVIEW_SAMPLE_LIMIT) =>
    getJson<SessionReview>(`/api/lmu-duckdb/sessions/${encodeURIComponent(id)}/review?limit=${limit}`),
  lmuDuckdbTrajectory: (id: string, lapA?: string, lapB?: string, maxPoints = 1600) => {
    const params = new URLSearchParams({ max_points: String(maxPoints) });
    if (lapA) params.set("lap_a", lapA);
    if (lapB) params.set("lap_b", lapB);
    return getJson<{ session_id: string; laps: string[]; points: Array<Record<string, number | string | boolean | null>>; warnings: string[] }>(`/api/lmu-duckdb/sessions/${encodeURIComponent(id)}/trajectory?${params}`);
  },
  startDuckdbSessionsJob: (limit = 250, offset = 0) => postJson<DuckdbJobStatus>(`/api/lmu-duckdb/jobs/sessions?limit=${limit}&offset=${offset}`, {}),
  startDuckdbSyncJob: (path?: string) => postJson<LmuDuckdbSyncStatus>("/api/lmu-duckdb/jobs/sync", path ? { path } : {}),
  startDuckdbReviewJob: (id: string, limit = REVIEW_SAMPLE_LIMIT) => postJson<DuckdbJobStatus>(`/api/lmu-duckdb/sessions/${encodeURIComponent(id)}/review-jobs?limit=${limit}`, {}),
  startDuckdbHistoryJob: (sessionIds: string[]) => postJson<DuckdbJobStatus>("/api/lmu-duckdb/jobs/history", { session_ids: sessionIds }),
  startProfileOverviewJob: () => postJson<DuckdbJobStatus>("/api/lmu-duckdb/jobs/profile-overview", {}),
  startPerformanceReportJob: (sessionId: string, body: PerformanceReportConfiguration) => postJson<DuckdbJobStatus>(`/api/performance-reports/sessions/${encodeURIComponent(sessionId)}/jobs`, body as unknown as Record<string, unknown>),
  performanceReports: (sessionId: string) => getJson<PerformanceReportRecord[]>(`/api/performance-reports/sessions/${encodeURIComponent(sessionId)}`),
  performanceReportDownloadUrl: (reportId: string) => `${API_BASE}/api/performance-reports/${encodeURIComponent(reportId)}/download`,
  deletePerformanceReport: async (reportId: string) => {
    const response = await fetch(`${API_BASE}/api/performance-reports/${encodeURIComponent(reportId)}`, { method: "DELETE" });
    if (!response.ok) throw new Error((await response.text()) || "Could not delete report");
  },
  startRaceSimulationJob: (body: Record<string, unknown>) => postJson<DuckdbJobStatus>("/api/race-simulation/jobs", body),
  importRaceEvent: (sessionId: string) => getJson<Record<string, unknown>>(`/api/race-simulation/events/${encodeURIComponent(sessionId)}/import`),
  startFullFieldRaceJob: (body: Record<string, unknown>) => postJson<DuckdbJobStatus>("/api/race-simulation/full-field/jobs", body),
  duckdbJobStatus: (id: string) => getJson<DuckdbJobStatus>(`/api/lmu-duckdb/jobs/${encodeURIComponent(id)}`),
  duckdbJobResult: <T>(id: string) => getJson<T>(`/api/lmu-duckdb/jobs/${encodeURIComponent(id)}/result`),
  profileOverview: () => getJson<ProfileOverview>("/api/profile/overview"),
  profileSummary: () => getJson<ProfileSummary>("/api/profile/summary"),
  profileBestLaps: () => getJson<ProfileLap[]>("/api/profile/best-laps"),
  revalidateProfileBestLaps: () => postJson<Pick<ProfileOverview, "best_laps" | "data_quality">>("/api/profile/best-laps/revalidate", {}),
  excludedProfileBestLapCandidates: () => getJson<ProfileLap[]>("/api/profile/best-laps/excluded"),
  profileLaps: (params: Record<string, string | number | boolean | null | undefined>) => {
    const search = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== null && value !== undefined && value !== "") search.set(key, String(value));
    });
    return getJson<ProfileLapResponse>(`/api/profile/laps?${search.toString()}`);
  },
};
