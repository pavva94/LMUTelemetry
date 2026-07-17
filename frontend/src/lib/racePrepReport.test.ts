import { describe, expect, it } from "vitest";
import { buildRacePrepReport } from "./racePrepReport";
import type { SessionReview } from "../types/session";

describe("race prep report", () => {
  it("reports radiator temperatures and per-wheel grass contact when channels exist", () => {
    const report = buildRacePrepReport({
      session: null,
      recommendations: [],
      pit_events: [],
      laps: [],
      telemetry_samples: [
        { game_time: 1, engine_oil_temp: 101, engine_water_temp: 89, surface_type_fl: 2, surface_type_fr: 0, surface_type_rl: 2, surface_type_rr: 0 },
        { game_time: 2, engine_oil_temp: 103, engine_water_temp: 91, surface_type_fl: 0, surface_type_fr: 2, surface_type_rl: 0, surface_type_rr: 0 },
      ],
    });

    expect(report.powertrain.oilTemp.average).toBe(102);
    expect(report.powertrain.waterTemp.max).toBe(91);
    expect(report.surface.grassSamples).toEqual({ fl: 1, fr: 1, rl: 1, rr: 0 });
    expect(report.surface.totalGrassSamples).toBe(3);
  });

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

  it("normalizes DuckDB tyre wear remaining percent into used wear", () => {
    const review: SessionReview = {
      session: { id: "duck", track_name: "Monza", session_type: "Practice", vehicle_model: "Ferrari" },
      recommendations: [],
      pit_events: [],
      telemetry_samples: [
        { game_time: 1, tyre_wear_fl: 99.8, tyre_wear_fr: 99.7, tyre_wear_rl: 99.6, tyre_wear_rr: 99.5, tyre_pressure_fl: 170, tyre_temp_fl: 80 },
        { game_time: 2, tyre_wear_fl: 99.1, tyre_wear_fr: 99.0, tyre_wear_rl: 98.9, tyre_wear_rr: 98.8, tyre_pressure_fl: 171, tyre_temp_fl: 81 },
      ],
      laps: [
        { lap_number: 1, lap_time: 91, fuel_used: 4, valid_lap: true, in_pit: false },
        { lap_number: 2, lap_time: 92, fuel_used: 4, valid_lap: true, in_pit: false },
      ],
    };

    const report = buildRacePrepReport(review);

    expect(report.tyres.wear.fl.start).toBeCloseTo(0.002);
    expect(report.tyres.wear.fl.end).toBeCloseTo(0.009);
    expect(report.tyres.wear.fl.delta).toBeCloseTo(0.007);
    expect(report.tyres.mostWorn).toBe("fl");
  });

  it("builds chart datasets and coverage from telemetry samples", () => {
    const review: SessionReview = {
      session: { id: "live", track_name: "Le Mans", session_type: "Race", vehicle_model: "Hypercar" },
      recommendations: [{ timestamp: 95, recommendation_type: "fuel", message: "Save fuel" }],
      pit_events: [{ timestamp: 180, type: "pit", message: "Entered pits" }],
      telemetry_samples: [
        { game_time: 10, speed_kph: 220, rpm: 7200, throttle: 0.8, brake: 0.0, steering: 0.1, fuel_liters: 70, g_force_lat: 0.4, g_force_long: 0.2, tyre_wear_fl: 0.1, tyre_temp_fl: 82, tyre_pressure_fl: 180, brake_temp_fl: 400, brake_temp_fr: 410, brake_temp_rl: 380, brake_temp_rr: 390, ride_height_fl: 34, track_temp: 31, ambient_temp: 24 },
        { game_time: 20, speed_kph: 250, rpm: 7600, throttle: 1.0, brake: 0.0, steering: 0.0, fuel_liters: 67, g_force_lat: 0.1, g_force_long: 0.3, tyre_wear_fl: 0.12, tyre_temp_fl: 84, tyre_pressure_fl: 181, brake_temp_fl: 420, brake_temp_fr: 430, brake_temp_rl: 390, brake_temp_rr: 395, ride_height_fl: 32, track_temp: 32, ambient_temp: 24 },
      ],
      laps: [
        { lap_number: 1, lap_time: 90, fuel_used: 3.0, valid_lap: true, in_pit: false, top_speed: 300, tyre_wear_delta_fl: 0.01 },
        { lap_number: 2, lap_time: 91, fuel_used: 3.1, valid_lap: true, in_pit: false, top_speed: 305, tyre_wear_delta_fl: 0.02 },
      ],
    };

    const report = buildRacePrepReport(review);

    expect(report.coverage.sampleCount).toBe(2);
    expect(report.coverage.channelGroups).toContain("Driver inputs");
    expect(report.coverage.channelGroups).toContain("G-force");
    expect(report.charts.samples[0].speed_kph).toBe(220);
    expect(report.charts.samples[0].tyre_wear_fl).toBe(0.1);
    expect(report.charts.laps[1].delta).toBe(1);
    expect(report.charts.events).toHaveLength(2);
  });

  it("builds lap chart fallbacks when raw samples are absent", () => {
    const review: SessionReview = {
      session: { id: "saved", track_name: "Spa", session_type: "Practice", vehicle_model: "GT3" },
      recommendations: [],
      pit_events: [],
      telemetry_samples: [],
      laps: [
        { lap_number: 1, lap_time: 92, fuel_used: 4.1, valid_lap: true, in_pit: false, top_speed: 290, tyre_wear_end_fl: 0.11, tyre_temp_fl: 85, tyre_pressure_fl: 187, brake_temp_fl: 460, ride_height_fl: 30, track_temp: 30, ambient_temp: 22 },
        { lap_number: 2, lap_time: 91, fuel_used: 4.0, valid_lap: true, in_pit: false, top_speed: 293, tyre_wear_end_fl: 0.13, tyre_temp_fl: 87, tyre_pressure_fl: 188, brake_temp_fl: 470, ride_height_fl: 29, track_temp: 31, ambient_temp: 22 },
      ],
    };

    const report = buildRacePrepReport(review);

    expect(report.charts.samples).toHaveLength(0);
    expect(report.charts.laps[0].tyre_wear_fl).toBe(0.11);
    expect(report.charts.laps[1].track_temp).toBe(31);
    expect(report.coverage.channelGroups).toContain("Platform");
  });

  it("groups stint chart rows around pit laps", () => {
    const review: SessionReview = {
      session: null,
      recommendations: [],
      pit_events: [],
      telemetry_samples: [],
      laps: [
        { lap_number: 1, lap_time: 90, fuel_used: 3, valid_lap: true, in_pit: false, top_speed: 300, tyre_wear_delta: 0.01 },
        { lap_number: 2, lap_time: 91, fuel_used: 3.2, valid_lap: true, in_pit: false, top_speed: 301, tyre_wear_delta: 0.02 },
        { lap_number: 3, lap_time: 120, fuel_used: 0, valid_lap: false, in_pit: true },
        { lap_number: 4, lap_time: 92, fuel_used: 3.3, valid_lap: true, in_pit: false, top_speed: 302, tyre_wear_delta: 0.03 },
      ],
    };

    const report = buildRacePrepReport(review);

    expect(report.charts.stints).toHaveLength(2);
    expect(report.charts.stints[0].lap_count).toBe(2);
    expect(report.charts.stints[1].start_lap).toBe(4);
  });

  it("reports engineering findings for variability, imbalance, and missing channels", () => {
    const review: SessionReview = {
      session: null,
      recommendations: [],
      pit_events: [],
      telemetry_samples: [
        { game_time: 1, brake_temp_fl: 500, brake_temp_fr: 360, brake_temp_rl: 350, brake_temp_rr: 345, tyre_wear_fl: 0.01, tyre_wear_fr: 0.01, tyre_wear_rl: 0.05, tyre_wear_rr: 0.06, tyre_temp_fl: 80, tyre_temp_rl: 90, tyre_pressure_fl: 180 },
        { game_time: 2, brake_temp_fl: 520, brake_temp_fr: 365, brake_temp_rl: 355, brake_temp_rr: 350, tyre_wear_fl: 0.02, tyre_wear_fr: 0.02, tyre_wear_rl: 0.10, tyre_wear_rr: 0.11, tyre_temp_fl: 82, tyre_temp_rl: 92, tyre_pressure_fl: 181 },
      ],
      laps: [
        { lap_number: 1, lap_time: 90, fuel_used: 3.0, valid_lap: true, in_pit: false },
        { lap_number: 2, lap_time: 92, fuel_used: 3.6, valid_lap: true, in_pit: false },
        { lap_number: 3, lap_time: 93, fuel_used: 3.7, valid_lap: true, in_pit: false },
        { lap_number: 4, lap_time: 94, fuel_used: 3.8, valid_lap: true, in_pit: false },
      ],
    };

    const report = buildRacePrepReport(review);
    const titles = report.engineeringFindings.map((finding) => finding.title);

    expect(titles).toContain("Fuel variability");
    expect(report.engineeringFindings.find((finding) => finding.title === "Fuel variability")?.severity).toBe("warning");
    expect(report.engineeringFindings.find((finding) => finding.title === "Tyre wear balance")?.severity).toBe("warning");
    expect(report.engineeringFindings.find((finding) => finding.title === "Brake temperature spread")?.severity).toBe("warning");
    expect(report.engineeringFindings.find((finding) => finding.title === "Platform data coverage")?.severity).toBe("warning");
  });

  it("adds race strategy review when the session is a race", () => {
    const review: SessionReview = {
      session: { id: "race", track_name: "Spa", session_type: "Race", vehicle_model: "Hypercar" },
      recommendations: [],
      pit_events: [{ timestamp: 1800, type: "pit", message: "Pit stop" }],
      telemetry_samples: [
        { game_time: 1, fuel_liters: 100, fuel_capacity_liters: 100 },
        { game_time: 2, fuel_liters: 96, fuel_capacity_liters: 100 },
      ],
      laps: [
        { lap_number: 1, lap_time: 90, fuel_used: 4, valid_lap: true, in_pit: false },
        { lap_number: 2, lap_time: 91, fuel_used: 4, valid_lap: true, in_pit: false },
      ],
    };

    const report = buildRacePrepReport(review, { raceLaps: 50 });
    const strategy = report.engineeringFindings.find((finding) => finding.title === "Race strategy review");

    expect(strategy?.evidence).toContain("1 pit events");
    expect(strategy?.detail).toContain("Observed stop count");
  });

  it("reports pit stops made with inferred fuel and tyre changes", () => {
    const review: SessionReview = {
      session: { id: "race", track_name: "Spa", session_type: "Race", vehicle_model: "Hypercar" },
      recommendations: [],
      pit_events: [{ lap_number: 3, timestamp: 270, type: "pit", message: "Box this lap" }],
      telemetry_samples: [],
      laps: [
        { lap_number: 1, lap_time: 90, fuel_start: 80, fuel_end: 76, fuel_used: 4, valid_lap: true, in_pit: false, tyre_wear_end_fl: 0.10, tyre_wear_end_fr: 0.10, tyre_wear_end_rl: 0.12, tyre_wear_end_rr: 0.12 },
        { lap_number: 2, lap_time: 91, fuel_start: 76, fuel_end: 72, fuel_used: 4, valid_lap: true, in_pit: false, tyre_wear_end_fl: 0.14, tyre_wear_end_fr: 0.14, tyre_wear_end_rl: 0.16, tyre_wear_end_rr: 0.16 },
        { lap_number: 3, lap_time: 130, fuel_added: 30, valid_lap: false, in_pit: true },
        { lap_number: 4, lap_time: 92, fuel_start: 102, fuel_end: 98, fuel_used: 4, valid_lap: true, in_pit: false, tyre_wear_start_fl: 0.02, tyre_wear_start_fr: 0.02, tyre_wear_start_rl: 0.03, tyre_wear_start_rr: 0.03 },
      ],
    };

    const report = buildRacePrepReport(review, { raceLaps: 50 });

    expect(report.charts.pitStops).toHaveLength(1);
    expect(report.charts.pitStops[0].lap).toBe(3);
    expect(report.charts.pitStops[0].fuel_added).toBe(30);
    expect(report.charts.pitStops[0].tyres_changed).toBe("FL, FR, RL, RR");
  });
});
