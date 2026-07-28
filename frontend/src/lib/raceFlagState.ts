import type { TelemetrySnapshot } from "../types/telemetry";

export type RaceFlagTone = "neutral" | "green" | "blue" | "yellow" | "red" | "chequered";
export type RaceFlagState = {
  tone: RaceFlagTone;
  labelKey?: string;
  detailKey?: string;
  yellowProcedure?: string;
};

const activeYellowStates = new Set(["1", "2", "3", "4", "5"]);

export function raceFlagState(telemetry: TelemetrySnapshot | null): RaceFlagState {
  const phase = String(telemetry?.session?.game_phase ?? "").trim().toLowerCase();
  const yellow = String(telemetry?.session?.yellow_flag_state ?? "").trim().toLowerCase();
  const finish = String(telemetry?.player?.finish_status ?? "").trim().toLowerCase();

  if (phase === "8" || /session.?over|finished|check|chequer/.test(`${phase} ${finish}`)) {
    return { tone: "chequered", labelKey: "liveDashboard.chequeredFlag", detailKey: "liveDashboard.sessionComplete" };
  }
  if (phase === "7" || yellow === "7" || /stopped|halt|red/.test(`${phase} ${yellow}`)) {
    return { tone: "red", labelKey: "liveDashboard.redFlag", detailKey: "liveDashboard.sessionStopped" };
  }
  if (phase === "6" || activeYellowStates.has(yellow) || /yellow|safety|fcy/.test(`${phase} ${yellow}`)) {
    return { tone: "yellow", yellowProcedure: yellow, detailKey: "liveDashboard.fullCourseProcedure" };
  }
  if (telemetry?.player?.primary_flag === 6 || /blue/.test(yellow)) {
    return { tone: "blue", labelKey: "liveDashboard.blueFlag", detailKey: "liveDashboard.blueFlagDetail" };
  }
  if (phase === "5" || yellow === "6" || /green/.test(`${phase} ${yellow}`)) {
    return { tone: "green", labelKey: "liveDashboard.greenFlag", detailKey: "liveDashboard.liveSession" };
  }
  return { tone: "neutral" };
}
