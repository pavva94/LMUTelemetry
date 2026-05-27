import type { CompetitorState } from "../types/telemetry";
import { StatusBadge } from "./StatusBadge";

const n = (value?: number, digits = 1) => value == null ? "--" : value.toFixed(digits);

export function CompetitorTable({ competitors }: { competitors: CompetitorState[] }) {
  return (
    <section className="card span-12">
      <h2>Competitors</h2>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Pos</th><th>Driver</th><th>Car</th><th>Class</th><th>Last</th><th>Best</th><th>Gap</th><th>Stops</th><th>Pits</th><th>Strategy</th><th>Threat</th></tr></thead>
          <tbody>
            {competitors.map((c) => (
              <tr key={c.vehicle_id}>
                <td>{c.position}</td><td>{c.driver_name || (c.is_player ? "Player" : "--")}</td><td>{c.vehicle_name || "--"}</td><td>{c.vehicle_class || "--"}</td>
                <td>{n(c.last_lap_time)}</td><td>{n(c.best_lap_time)}</td><td>{n(c.time_behind_next)}</td><td>{c.pitstops ?? "--"}</td>
                <td>{c.in_pits ? "Yes" : "No"}</td><td>{c.estimated_strategy_group || "UNKNOWN"} estimated</td><td><StatusBadge value={c.threat_level} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
