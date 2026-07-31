import type { TelemetrySnapshot } from "./telemetry";
import type { RecommendationPayload, StrategyState } from "./strategy";

export type TeamSessionConfig = {
  cloudUrl: string;
  sessionCode: string;
  accessKey: string;
  displayName: string;
  role?: "leader" | "member";
};

export type TeamSessionInfo = {
  code: string;
  name: string;
  team_name: string;
  track_name?: string | null;
  status: string;
  created_at: string;
  ended_at?: string | null;
  active_driver?: string | null;
  viewer_count: number;
  publishing?: boolean;
  sequence?: number;
  last_snapshot_at?: string | null;
};

export type TeamParticipant = {
  display_name: string;
  role: "leader" | "driver" | "viewer";
  active_role?: "driver" | "viewer" | null;
  online: boolean;
  lap_count: number;
  fastest_lap?: number | null;
  last_lap?: number | null;
  joined_at: string;
  last_seen_at: string;
};

export type TeamPresence = {
  active_driver?: string | null;
  viewer_count?: number;
  publishing?: boolean;
  sequence?: number;
  last_snapshot_at?: string | null;
};

export type TeamSnapshot = {
  telemetry: TelemetrySnapshot | null;
  strategy: StrategyState | null;
  recommendation: RecommendationPayload | null;
};

export type TeamPublishingStatus = {
  configured: boolean;
  publishing: boolean;
  socket_connected?: boolean;
  connected: boolean;
  cloud_url?: string | null;
  session_code?: string | null;
  display_name?: string | null;
  sent_frames: number;
  acknowledged_frames?: number;
  last_acknowledged_at?: string | null;
  last_frame_bytes?: number | null;
  last_error?: string | null;
};

