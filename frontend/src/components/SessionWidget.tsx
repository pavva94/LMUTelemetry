import type { EnvironmentState, SessionState } from "../types/telemetry";
import { formatRaceTime } from "../lib/timeFormat";
import { StatusBadge } from "./StatusBadge";

function time(value?: number) {
  return formatRaceTime(value);
}

export function SessionWidget({ session, env, connected }: { session?: SessionState; env?: EnvironmentState; connected: boolean }) {
  return (
    <section className="card span-4">
      <div className="row"><h2>Session</h2><StatusBadge value={connected} /></div>
      <div className="metric"><span className="label">Track</span><span className="value">{session?.track_name || "--"}</span></div>
      <div className="row"><span className="subvalue">{session?.session_type || "--"} lap {session?.current_lap ?? "--"}</span><StatusBadge value={session?.yellow_flag_state || session?.game_phase} /></div>
      <div className="row"><span className="subvalue">Remaining {time(session?.time_remaining)}</span><span className="subvalue">Track {env?.track_temp_c?.toFixed(1) ?? "--"} C</span></div>
    </section>
  );
}
