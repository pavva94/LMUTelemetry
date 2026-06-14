import type { LmuDuckdbSession } from "../types/lmuDuckdb";

const text = (value?: string | number | null) => (value == null || value === "" ? "" : String(value));

function filenameStem(fileName?: string | null) {
  return text(fileName).replace(/\.[^.]+$/, "");
}

export function duckdbFilenameParts(session?: LmuDuckdbSession | null) {
  const parts = filenameStem(session?.file_name).split(/\s*-\s*/).map((part) => part.trim()).filter(Boolean);
  return {
    sessionType: parts[0] || "",
    track: parts[1] || "",
    car: parts.slice(2).join(" - "),
  };
}

export function duckdbLapCount(session?: LmuDuckdbSession | null) {
  const lapCount = Number(session?.lap_count);
  if (Number.isFinite(lapCount) && lapCount > 0) return lapCount;
  const latestLap = Number(session?.latest_lap_number);
  return Number.isFinite(latestLap) && latestLap > 0 ? latestLap : null;
}

export function duckdbSessionParts(session?: LmuDuckdbSession | null) {
  const filename = duckdbFilenameParts(session);
  return {
    sessionType: text(session?.session_type) || filename.sessionType || "Session",
    track: text(session?.track_name) || filename.track || "Unknown track",
    car: text(session?.vehicle_model) || text(session?.vehicle_name) || filename.car || "Unknown car",
  };
}

export function duckdbSessionLabel(session: LmuDuckdbSession) {
  const parts = duckdbSessionParts(session);
  const laps = duckdbLapCount(session);
  const date = text(session.created_at) || session.id;
  return `${parts.sessionType} - ${parts.track} - ${parts.car} - ${date}${laps ? ` (${laps} laps)` : ""}`;
}

export function duckdbSessionSearchText(session: LmuDuckdbSession) {
  const parts = duckdbSessionParts(session);
  const filename = duckdbFilenameParts(session);
  return [
    parts.sessionType,
    parts.track,
    parts.car,
    filename.sessionType,
    filename.track,
    filename.car,
    session.file_name,
    session.file_path,
    session.created_at,
    session.id,
    duckdbLapCount(session),
  ].map(text).join(" ").toLowerCase();
}

export function filterDuckdbSessions(sessions: LmuDuckdbSession[], query: string, selectedId?: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) return sessions;
  return sessions.filter((session) => session.id === selectedId || duckdbSessionSearchText(session).includes(needle));
}
