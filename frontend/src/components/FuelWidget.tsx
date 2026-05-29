import type { FuelState } from "../types/strategy";
import type { PlayerState } from "../types/telemetry";
import { StatusBadge } from "./StatusBadge";

const n = (value?: number, digits = 1) => value == null ? "--" : value.toFixed(digits);
const pct = (value?: number) => value == null ? "--" : `${Math.round(value * 100)}%`;
const percent = (value?: number) => value == null ? "--" : `${Math.round(value)}%`;

export function FuelWidget({ fuel, player }: { fuel?: FuelState; player?: PlayerState }) {
  return (
    <section className="card span-4">
      <div className="row"><h2>Fuel</h2><StatusBadge value={fuel?.confidence || "low"} /></div>
      <div className="metric"><span className="label">Tank</span><span className="value">{n(player?.fuel_liters)} L</span></div>
      <div className="row"><span className="subvalue">Capacity {n(player?.fuel_capacity_liters)} L</span><span className="subvalue">VE {pct(player?.hybrid_state?.virtual_energy_fraction)}</span></div>
      <div className="row"><span className="subvalue">Battery {percent(player?.hybrid_state?.battery_percent)}</span><span className="subvalue">Regen {n(player?.hybrid_state?.regen_kw)} kW</span></div>
      <div className="row"><span className="subvalue">Per lap {n(fuel?.fuel_per_lap_liters, 2)} L</span><span className="subvalue">Range {n(fuel?.fuel_laps_remaining)} laps</span></div>
      <div className="metric"><span className="label">Delta to finish</span><span className="value">{n(fuel?.fuel_delta_to_finish)} L</span></div>
    </section>
  );
}
