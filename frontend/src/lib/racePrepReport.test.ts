import { describe, expect, it } from "vitest";
import { buildRacePrepReport } from "./racePrepReport";
import type { SessionReview } from "../types/session";

describe("race prep report", () => {
  it("uses real tyre samples and ignores disconnected placeholder tyre rows", () => {
    const review: SessionReview = {
      session: null,
      recommendations: [],
      pit_events: [],
      laps: [
        { lap_number: 1, lap_time: 90, fuel_used: 3, valid_lap: true, in_pit: false },
        { lap_number: 2, lap_time: 91, fuel_used: 3.1, valid_lap: true, in_pit: false },
      ],
      telemetry_samples: [
        {
          game_time: 1,
          fuel_liters: 50,
          fuel_capacity_liters: 100,
          tyre_wear_fl: 0.01,
          tyre_wear_fr: 0.02,
          tyre_wear_rl: 0.03,
          tyre_wear_rr: 0.04,
          tyre_pressure_fl: 180,
          tyre_pressure_fr: 181,
          tyre_pressure_rl: 182,
          tyre_pressure_rr: 183,
          tyre_temp_fl: 80,
          tyre_temp_fr: 81,
          tyre_temp_rl: 82,
          tyre_temp_rr: 83,
        },
        {
          game_time: 2,
          fuel_liters: 47,
          tyre_wear_fl: 0.03,
          tyre_wear_fr: 0.04,
          tyre_wear_rl: 0.05,
          tyre_wear_rr: 0.06,
          tyre_pressure_fl: 190,
          tyre_pressure_fr: 191,
          tyre_pressure_rl: 192,
          tyre_pressure_rr: 193,
          tyre_temp_fl: 90,
          tyre_temp_fr: 91,
          tyre_temp_rl: 92,
          tyre_temp_rr: 93,
        },
        {
          game_time: 3,
          fuel_liters: 47,
          tyre_wear_fl: 0,
          tyre_wear_fr: 0,
          tyre_wear_rl: 0,
          tyre_wear_rr: 0,
          tyre_pressure_fl: null,
          tyre_pressure_fr: null,
          tyre_pressure_rl: null,
          tyre_pressure_rr: null,
          tyre_temp_fl: null,
          tyre_temp_fr: null,
          tyre_temp_rl: null,
          tyre_temp_rr: null,
        },
      ],
    };

    const report = buildRacePrepReport(review);

    expect(report.tyres.wear.fl.start).toBe(0.01);
    expect(report.tyres.wear.fl.end).toBe(0.03);
    expect(report.tyres.wear.fl.delta).toBeCloseTo(0.02);
    expect(report.tyres.temperature.fl.average).toBe(85);
    expect(report.tyres.pressure.fl.average).toBe(185);
  });

  it("uses saved lap and aggregate summaries when finalized sessions have no raw samples", () => {
    const review: SessionReview = {
      session: { id: "saved", track_name: "Spa", session_type: "Race", vehicle_model: "Porsche" },
      recommendations: [],
      pit_events: [],
      summary: {
        total_distance_km: 14,
        top_speed: 301,
        average_tyre_temp: 86,
        average_tyre_pressure: 188,
      },
      telemetry_samples: [],
      laps: [
        {
          lap_number: 1,
          lap_time: 91,
          fuel_start: 90,
          fuel_end: 86,
          fuel_used: 4,
          valid_lap: true,
          in_pit: false,
          track_temp: 31,
          ambient_temp: 23,
          top_speed: 298,
          tyre_wear_start_fl: 0.01,
          tyre_wear_end_fl: 0.03,
          tyre_wear_delta_fl: 0.02,
          tyre_temp_fl: 85,
          tyre_pressure_fl: 187,
        },
        {
          lap_number: 2,
          lap_time: 92,
          fuel_start: 86,
          fuel_end: 82,
          fuel_used: 4,
          valid_lap: true,
          in_pit: false,
          track_temp: 33,
          ambient_temp: 25,
          top_speed: 301,
          tyre_wear_start_fl: 0.03,
          tyre_wear_end_fl: 0.05,
          tyre_wear_delta_fl: 0.02,
          tyre_temp_fl: 87,
          tyre_pressure_fl: 189,
        },
      ],
    };

    const report = buildRacePrepReport(review);

    expect(report.session.trackTemp).toBe(32);
    expect(report.session.ambientTemp).toBe(24);
    expect(report.session.topSpeed).toBe(301);
    expect(report.session.totalDistanceKm).toBe(14);
    expect(report.tyres.wear.fl.delta).toBeCloseTo(0.04);
    expect(report.tyres.temperature.fl.average).toBe(86);
    expect(report.tyres.pressure.fl.average).toBe(188);
  });

  it("falls back to aggregate lap tyre wear when per-wheel wear is missing", () => {
    const review: SessionReview = {
      session: { id: "old-saved", track_name: "Spa", session_type: "Practice", vehicle_model: "Porsche" },
      recommendations: [],
      pit_events: [],
      telemetry_samples: [],
      laps: [
        { lap_number: 1, lap_time: 91, fuel_used: 4, valid_lap: true, in_pit: false, tyre_wear_start: 0.10, tyre_wear_end: 0.12, tyre_wear_delta: 0.02 },
        { lap_number: 2, lap_time: 92, fuel_used: 4, valid_lap: true, in_pit: false, tyre_wear_start: 0.12, tyre_wear_end: 0.15, tyre_wear_delta: 0.03 },
      ],
    };

    const report = buildRacePrepReport(review);

    expect(report.tyres.wear.fl.start).toBe(0.10);
    expect(report.tyres.wear.fl.end).toBe(0.15);
    expect(report.tyres.wear.fl.delta).toBeCloseTo(0.05);
    expect(report.tyres.wear.rr.perLap).toBeCloseTo(0.025);
  });
});
