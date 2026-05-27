import type { TyreStrategyState } from "../types/strategy";
import type { TyreState } from "../types/telemetry";
import { StatusBadge } from "./StatusBadge";

const pct = (value?: number) => value == null ? "--" : `${Math.round(value * 100)}%`;
const n = (value?: number, digits = 1) => value == null ? "--" : value.toFixed(digits);

export function TyreWidget({ tyres, strategy }: { tyres?: TyreState; strategy?: TyreStrategyState }) {
  return (
    <section className="card span-4">
      <div className="row"><h2>Tyres</h2><StatusBadge value={strategy?.tyre_risk_level} /></div>
      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <span>FL {pct(tyres?.wear_fl)}</span><span>FR {pct(tyres?.wear_fr)}</span>
        <span>RL {pct(tyres?.wear_rl)}</span><span>RR {pct(tyres?.wear_rr)}</span>
      </div>
      <div className="metric"><span className="label">Average wear</span><span className="value">{pct(strategy?.average_wear)}</span></div>
      <div className="row"><span className="subvalue">Life {n(strategy?.estimated_remaining_tyre_life_laps)} laps</span><span className="subvalue">Temp {n(tyres?.average_temp_c)} C</span></div>
    </section>
  );
}
