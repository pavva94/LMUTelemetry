import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { SectionTitle } from "./SectionTitle";
import type { StrategyState } from "../types/strategy";

export function PitWindowChart({ strategy }: { strategy?: StrategyState | null }) {
  const lap = strategy?.stint.current_stint_lap || 1;
  const latest = strategy?.pit_window.latest_safe_pit_lap || lap + 5;
  const data = Array.from({ length: 8 }, (_, i) => {
    const pitLap = lap + i;
    return { lap: pitLap, risk: pitLap > latest ? 9 : Math.max(1, i + (strategy?.pit_window.traffic_risk_after_stop === "high" ? 3 : 0)) };
  });
  return (
    <section className="card span-7">
      <SectionTitle title="Pit Lap Risk" help="Ranks upcoming pit laps by combined strategy risk. A rising curve means waiting longer is becoming less attractive." />
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={data}>
          <CartesianGrid stroke="#27313a" />
          <XAxis dataKey="lap" stroke="#8896a3" />
          <YAxis stroke="#8896a3" />
          <Tooltip contentStyle={{ background: "#141a20", border: "1px solid #27313a" }} />
          <Line type="monotone" dataKey="risk" stroke="#e6b450" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </section>
  );
}
