import type { EnvironmentState, SessionState } from "../types/telemetry";
import { formatRaceTime } from "../lib/timeFormat";
import { useT } from "../i18n/I18nProvider";
import { StatusBadge } from "./StatusBadge";

function time(value?: number) {
  return formatRaceTime(value);
}

export function SessionWidget({ session, env, connected }: { session?: SessionState; env?: EnvironmentState; connected: boolean }) {
  const t = useT();
  return (
    <section className="card span-4">
      <div className="row"><h2>{t("telemetry.session")}</h2><StatusBadge value={connected} /></div>
      <div className="metric"><span className="label">{t("telemetry.track")}</span><span className="value">{session?.track_name || "--"}</span></div>
      <div className="row"><span className="subvalue">{session?.session_type || "--"} {t("telemetry.lap").toLowerCase()} {session?.current_lap ?? "--"}</span><StatusBadge value={session?.yellow_flag_state || session?.game_phase} /></div>
      <div className="row"><span className="subvalue">{t("telemetry.remaining")} {time(session?.time_remaining)}</span><span className="subvalue">{t("telemetry.track")} {env?.track_temp_c?.toFixed(1) ?? "--"} C</span></div>
    </section>
  );
}
