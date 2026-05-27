import { PitWindowChart } from "../components/PitWindowChart";
import { StatusBadge } from "../components/StatusBadge";
import type { StrategyState } from "../types/strategy";
import { formatRaceGap } from "../lib/timeFormat";

export function PitWindow({ strategy }: { strategy: StrategyState | null }) {
  const pit = strategy?.pit_window;
  const lap = strategy?.stint.current_stint_lap || 1;
  const rows = Array.from({ length: 8 }, (_, i) => {
    const candidate = lap + i;
    const latest = pit?.latest_safe_pit_lap ?? candidate + 2;
    return { lap: candidate, can: candidate <= latest, fuel: candidate > latest ? "high" : "low", tyre: strategy?.tyres.tyre_risk_level || "unknown", rejoin: (pit?.projected_rejoin_position || 8) + i, traffic: pit?.traffic_risk_after_stop || "unknown", delta: i * 1.7 };
  });
  return (
    <div className="page grid">
      <section className="card span-5">
        <h2>Pit Window</h2>
        <div className="metric"><span className="label">Earliest</span><span className="value">Lap {pit?.earliest_viable_pit_lap ?? "--"}</span></div>
        <div className="metric"><span className="label">Latest safe</span><span className="value">Lap {pit?.latest_safe_pit_lap ?? "--"}</span></div>
        <div className="metric"><span className="label">Optimal</span><span className="value">Lap {pit?.optimal_pit_lap ?? "--"}</span></div>
        <div className="row"><StatusBadge value={pit?.traffic_risk_after_stop} /><span className="subvalue">Rejoin P{pit?.projected_rejoin_position ?? "--"}</span></div>
      </section>
      <PitWindowChart strategy={strategy} />
      <section className="card span-12">
        <h2>Possible Pit Laps</h2>
        <div className="table-wrap"><table><thead><tr><th>Lap</th><th>Can Pit?</th><th>Fuel Risk</th><th>Tyre Risk</th><th>Projected Rejoin</th><th>Traffic</th><th>Delta</th></tr></thead><tbody>
          {rows.map((row) => <tr key={row.lap}><td>{row.lap}</td><td>{row.can ? "Yes" : "No"}</td><td>{row.fuel}</td><td>{row.tyre}</td><td>P{row.rejoin}</td><td>{row.traffic}</td><td>{formatRaceGap(row.delta)}</td></tr>)}
        </tbody></table></div>
      </section>
    </div>
  );
}
