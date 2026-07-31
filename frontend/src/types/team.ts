import type { TelemetrySnapshot } from "./telemetry";
import type { RecommendationPayload, StrategyState } from "./strategy";

export type TeamSessionConfig = {
  cloudUrl: string;
  sessionCode: string;
  displayName: string;
};

export type TeamPresence = {
  active_driver?: string | null;
  viewer_count?: number;
  publishing?: boolean;
};

export type TeamSnapshot = {
  telemetry: TelemetrySnapshot | null;
  strategy: StrategyState | null;
  recommendation: RecommendationPayload | null;
};

export type TeamPublishingStatus = {
  configured: boolean;
  publishing: boolean;
  connected: boolean;
  cloud_url?: string | null;
  session_code?: string | null;
  display_name?: string | null;
  sent_frames: number;
  last_error?: string | null;
};

