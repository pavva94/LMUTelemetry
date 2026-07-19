import { describe, expect, it } from "vitest";
import { raceFlagState } from "./raceFlagState";
import type { TelemetrySnapshot } from "../types/telemetry";

const snapshot = (gamePhase: string, yellow = "0", primaryFlag?: number, finishStatus?: string) => ({
  timestamp: "2026-07-19T12:00:00Z",
  connected: true,
  session: { game_phase: gamePhase, yellow_flag_state: yellow },
  player: { primary_flag: primaryFlag, finish_status: finishStatus },
  competitors: [],
  environment: {},
}) as TelemetrySnapshot;

describe("raceFlagState", () => {
  it("recognises green and player-specific blue flags", () => {
    expect(raceFlagState(snapshot("5", "0", 0)).tone).toBe("green");
    expect(raceFlagState(snapshot("5", "0", 6)).tone).toBe("blue");
  });

  it("gives yellow procedure priority over the player flag", () => {
    expect(raceFlagState(snapshot("6", "4", 6)).tone).toBe("yellow");
  });

  it("gives stopped and completed sessions the highest priority", () => {
    expect(raceFlagState(snapshot("7", "0", 6)).tone).toBe("red");
    expect(raceFlagState(snapshot("8", "4", 6)).tone).toBe("chequered");
    expect(raceFlagState(snapshot("5", "0", 0, "Finished")).tone).toBe("chequered");
  });
});
