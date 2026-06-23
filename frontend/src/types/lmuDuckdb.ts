import type { SavedSession } from "./session";

export type LmuDuckdbSession = SavedSession & {
  file_name?: string;
  file_path?: string;
  file_size_bytes?: number;
  metadata?: Record<string, string>;
  warnings?: string[];
};

export type LmuDuckdbScanResponse = {
  sessions: LmuDuckdbSession[];
  warnings: string[];
  total: number;
  offset: number;
  limit: number;
  next_offset?: number | null;
};

export type LmuDuckdbSettings = {
  folder_path?: string | null;
  last_sync_at?: string | null;
  last_sync_status?: string | null;
  cached_sessions: number;
  active_sessions: number;
  warning_count: number;
  processed?: number;
  skipped?: number;
  inactive?: number;
  failed?: number;
  warnings?: string[];
};

export type LmuDuckdbSyncStatus = {
  id: string;
  folder_path: string;
  status: "queued" | "running" | "complete" | "failed" | "interrupted";
  total_files: number;
  processed: number;
  skipped: number;
  failed: number;
  inactive: number;
  completed_files: number;
  current_file?: string | null;
  warnings: string[];
  started_at: string;
  updated_at: string;
  finished_at?: string | null;
  percentage: number;
};

export type DuckdbJobStatus = {
  job_id: string;
  status: "queued" | "running" | "complete" | "failed";
  phase: string;
  message: string;
  completed_items: number;
  total_items: number;
  percentage: number;
  error?: string | null;
};
