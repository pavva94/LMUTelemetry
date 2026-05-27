import { useState } from "react";
import { api } from "../api/client";
import type { StrategyState } from "../types/strategy";

export function StrategyPlanner({ strategy }: { strategy: StrategyState | null }) {
  const [form, setForm] = useState({
    race_duration_minutes: Number(strategy?.assumptions.race_duration_minutes || 120),
    pit_loss_seconds: Number(strategy?.assumptions.pit_loss_seconds || 28),
    fuel_safety_margin_liters: Number(strategy?.assumptions.fuel_safety_margin_liters || 2),
    max_tyre_wear: Number(strategy?.assumptions.max_tyre_wear || 0.75),
    normal_lap_time: Number(strategy?.assumptions.normal_lap_time || 214),
    pit_stationary_seconds: Number(strategy?.assumptions.pit_stationary_seconds || 12),
    safety_car_pit_loss_seconds: Number(strategy?.assumptions.safety_car_pit_loss_seconds || 16),
    fuel_safety_margin_laps: Number(strategy?.assumptions.fuel_safety_margin_laps || 1),
  });
  const update = (key: keyof typeof form, value: string) => setForm({ ...form, [key]: Number(value) });
  const plans = [
    { name: "One stop", stops: 1, time: form.race_duration_minutes * 60 + form.pit_loss_seconds, risk: strategy?.tyres.tyre_risk_level === "high" ? "high" : "medium" },
    { name: "Two stop", stops: 2, time: form.race_duration_minutes * 60 + form.pit_loss_seconds * 2, risk: "low" },
    { name: "Custom", stops: "--", time: form.race_duration_minutes * 60 + form.pit_loss_seconds, risk: "unknown" },
  ];
  return (
    <div className="page grid">
      <section className="card span-12">
        <h2>Assumptions</h2>
        <div className="input-grid">
          {Object.entries(form).slice(0, 5).map(([key, value]) => (
            <label key={key}><span className="label">{key.replace(/_/g, " ")}</span><input type="number" step="0.1" value={value} onChange={(event) => update(key as keyof typeof form, event.target.value)} /></label>
          ))}
        </div>
        <p><button className="primary" onClick={() => void api.updateAssumptions(form)}>Apply assumptions</button></p>
      </section>
      {plans.map((plan) => (
        <section className="card span-4" key={plan.name}>
          <h2>{plan.name}</h2>
          <div className="metric"><span className="label">Stops</span><span className="value">{plan.stops}</span></div>
          <div className="metric"><span className="label">Estimated total</span><span className="value">{Math.round(Number(plan.time))} s</span></div>
          <div className="subvalue">Risk {plan.risk}</div>
        </section>
      ))}
    </div>
  );
}
