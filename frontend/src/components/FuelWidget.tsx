import type { FuelState } from "../types/strategy";
import type { PlayerState } from "../types/telemetry";
import { StatusBadge } from "./StatusBadge";

const n = (value?: number, digits = 1) => value == null ? "--" : value.toFixed(digits);

export function FuelWidget({ fuel, player }: { fuel?: FuelState; player?: PlayerState }) {
  return (
    <section className="card span-4">
      <div className="row"><h2>Fuel</h2><StatusBadge value={fuel?.confidence || "low"} /></div>
      <div className="metric"><span className="label">Tank</span><span className="value">{n(player?.fuel_liters)} L</span></div>
      <div className="row"><span className="subvalue">Per lap {n(fuel?.fuel_per_lap_liters, 2)} L</span><span className="subvalue">Range {n(fuel?.fuel_laps_remaining)} laps</span></div>
      <div className="metric"><span className="label">Delta to finish</span><span className="value">{n(fuel?.fuel_delta_to_finish)} L</span></div>
    </section>
  );
}
