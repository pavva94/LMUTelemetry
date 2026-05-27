import type { PlayerState } from "../types/telemetry";

const n = (value?: number, digits = 0) => value == null ? "--" : value.toFixed(digits);

export function TelemetryCard({ player }: { player?: PlayerState }) {
  return (
    <section className="card span-4">
      <h2>Car</h2>
      <div className="metric"><span className="label">Speed</span><span className="value">{n(player?.speed_kph)} km/h</span></div>
      <div className="row"><span className="subvalue">Gear {player?.gear ?? "--"}</span><span className="subvalue">{n(player?.rpm)} rpm</span></div>
      <div className="metric"><span className="label">Throttle</span><div className="bar"><span style={{ width: `${(player?.throttle ?? 0) * 100}%` }} /></div></div>
      <div className="metric"><span className="label">Brake</span><div className="bar"><span style={{ width: `${(player?.brake ?? 0) * 100}%` }} /></div></div>
    </section>
  );
}
