import { useEffect, useMemo, useState } from "react";
import { Cloud, Copy, Crown, LogIn, LogOut, Power, Radio, RadioTower, Square, Upload, UserPlus, Users } from "lucide-react";
import type { TeamParticipant, TeamPresence, TeamPublishingStatus, TeamSessionConfig, TeamSessionInfo } from "../types/team";
import type { TelemetrySnapshot } from "../types/telemetry";

const storageKey = "lmu-team-session";
const leaderStoragePrefix = "lmu-team-session-leader:";
export const DEFAULT_TEAM_CLOUD_URL = "https://lmutelemetry-production.up.railway.app";

function leaderStorageKey(code: string) {
  return `${leaderStoragePrefix}${code}`;
}

function formatLapTime(value?: number | null) {
  if (!value || value <= 0) return "--";
  const minutes = Math.floor(value / 60);
  return `${minutes}:${(value - minutes * 60).toFixed(3).padStart(6, "0")}`;
}

export function loadTeamConfig(): TeamSessionConfig | null {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) || "null") as TeamSessionConfig | null;
    return parsed?.cloudUrl && parsed?.sessionCode && parsed?.accessKey && parsed?.displayName ? parsed : null;
  } catch {
    return null;
  }
}

async function responseJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let detail = "";
    try {
      const parsed = await response.json() as { detail?: string };
      detail = parsed.detail || "";
    } catch {
      detail = await response.text();
    }
    throw new Error(detail || `Request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

export function useTeamPublishingStatus(enabled = true) {
  const [status, setStatus] = useState<TeamPublishingStatus | null>(null);
  const refresh = async () => {
    try {
      setStatus(await responseJson<TeamPublishingStatus>(await fetch("/api/team-sharing/status")));
    } catch {
      setStatus(null);
    }
  };
  useEffect(() => {
    if (!enabled) return;
    void refresh();
    const id = window.setInterval(() => void refresh(), 1000);
    return () => window.clearInterval(id);
  }, [enabled]);
  return { status, refresh };
}

export function TeamRaceEngineer({
  config,
  setConfig,
  presence,
  remoteConnected,
  remoteError,
  publishingStatus,
  refreshPublishingStatus,
}: {
  config: TeamSessionConfig | null;
  setConfig: (value: TeamSessionConfig | null) => void;
  presence: TeamPresence;
  remoteConnected: boolean;
  remoteError: string | null;
  publishingStatus: TeamPublishingStatus | null;
  refreshPublishingStatus: () => Promise<void>;
}) {
  const [entryMode, setEntryMode] = useState<"join" | "create">("join");
  const [cloudUrl, setCloudUrl] = useState(
    config?.cloudUrl || (window.location.protocol === "https:" ? window.location.origin : DEFAULT_TEAM_CLOUD_URL),
  );
  const [sessionCode, setSessionCode] = useState(config?.sessionCode || "");
  const [accessKey, setAccessKey] = useState(config?.accessKey || "");
  const [displayName, setDisplayName] = useState(config?.displayName || "");
  const [statusText, setStatusText] = useState("");
  const [creating, setCreating] = useState(false);
  const [adminKey, setAdminKey] = useState("");
  const [teamName, setTeamName] = useState("");
  const [sessionName, setSessionName] = useState("");
  const [leaderName, setLeaderName] = useState("");
  const [sessionInfo, setSessionInfo] = useState<TeamSessionInfo | null>(null);
  const [participants, setParticipants] = useState<TeamParticipant[]>([]);
  const desktopAvailable = publishingStatus !== null;
  const cloudHasData = Boolean(presence.sequence && presence.last_snapshot_at);
  const leaderAdminKey = config ? window.sessionStorage.getItem(leaderStorageKey(config.sessionCode)) : null;
  const isLeader = Boolean(config && leaderAdminKey);

  useEffect(() => {
    if (!config) {
      setSessionInfo(null);
      setParticipants([]);
      return;
    }
    let cancelled = false;
    const refresh = async () => {
      try {
        const headers = { "X-Session-Access-Key": config.accessKey };
        const [infoResponse, participantsResponse] = await Promise.all([
          fetch(`${config.cloudUrl}/api/cloud/sessions/${config.sessionCode}`, { headers }),
          fetch(`${config.cloudUrl}/api/cloud/sessions/${config.sessionCode}/participants`, { headers }),
        ]);
        if (!infoResponse.ok) throw new Error((await infoResponse.text()) || "Could not refresh the team session.");
        if (!participantsResponse.ok) throw new Error((await participantsResponse.text()) || "Could not refresh participants.");
        if (!cancelled) {
          setSessionInfo(await infoResponse.json() as TeamSessionInfo);
          setParticipants(await participantsResponse.json() as TeamParticipant[]);
        }
      } catch (reason) {
        if (!cancelled) setStatusText(reason instanceof Error ? reason.message : "Could not refresh the team session.");
      }
    };
    void refresh();
    const id = window.setInterval(() => void refresh(), 3000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [config?.accessKey, config?.cloudUrl, config?.sessionCode]);

  const join = async () => {
    const next = {
      cloudUrl: cloudUrl.trim().replace(/\/+$/, ""),
      sessionCode: sessionCode.trim().toUpperCase(),
      accessKey: accessKey.trim(),
      displayName: displayName.trim(),
    };
    if (!next.cloudUrl || next.sessionCode.length !== 8 || next.accessKey.length < 20 || !next.displayName) {
      setStatusText("Cloud URL, session code, access key, and your name are required.");
      return;
    }
    try {
      await responseJson(await fetch(`${next.cloudUrl}/api/cloud/sessions/${next.sessionCode}`, {
        headers: { "X-Session-Access-Key": next.accessKey },
      }));
      const memberConfig: TeamSessionConfig = { ...next, role: "member" };
      window.localStorage.setItem(storageKey, JSON.stringify(memberConfig));
      setConfig(memberConfig);
    } catch (reason) {
      setStatusText(reason instanceof Error ? reason.message : "Could not join the session.");
    }
  };

  const publish = async (force: boolean) => {
    if (!config) return;
    try {
      await responseJson(await fetch("/api/team-sharing/configure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cloud_url: config.cloudUrl,
          session_code: config.sessionCode,
          access_key: config.accessKey,
          display_name: config.displayName,
        }),
      }));
      await responseJson(await fetch("/api/team-sharing/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force }),
      }));
      setStatusText("Publishing runs in the background. You may change pages or switch modes.");
      await refreshPublishingStatus();
    } catch (reason) {
      setStatusText(reason instanceof Error ? reason.message : "Could not start publishing.");
    }
  };

  const stopPublishing = async () => {
    await fetch("/api/team-sharing/stop", { method: "POST" });
    setStatusText("Publishing stopped. Local telemetry recording continues.");
    await refreshPublishingStatus();
  };

  const createSession = async () => {
    setCreating(true);
    try {
      const base = cloudUrl.trim().replace(/\/+$/, "");
      const created = await responseJson<TeamSessionInfo & { access_key: string }>(await fetch(`${base}/api/cloud/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Team-Admin-Key": adminKey },
        body: JSON.stringify({ name: sessionName, team_name: teamName, leader_name: leaderName }),
      }));
      const leaderConfig: TeamSessionConfig = {
        cloudUrl: base,
        sessionCode: created.code,
        accessKey: created.access_key,
        displayName: leaderName.trim(),
        role: "leader",
      };
      window.localStorage.setItem(storageKey, JSON.stringify(leaderConfig));
      window.sessionStorage.setItem(leaderStorageKey(created.code), adminKey);
      setConfig(leaderConfig);
    } catch (reason) {
      setStatusText(reason instanceof Error ? reason.message : "Could not create the session.");
    } finally {
      setCreating(false);
    }
  };

  const leaveSession = async () => {
    if (publishingStatus?.publishing) await fetch("/api/team-sharing/stop", { method: "POST" }).catch(() => undefined);
    if (config) window.sessionStorage.removeItem(leaderStorageKey(config.sessionCode));
    window.localStorage.removeItem(storageKey);
    setSessionCode("");
    setAccessKey("");
    setConfig(null);
  };

  const endSession = async () => {
    if (!config || !leaderAdminKey) return;
    try {
      await responseJson(await fetch(`${config.cloudUrl}/api/cloud/sessions/${config.sessionCode}/end`, {
        method: "POST",
        headers: { "X-Team-Admin-Key": leaderAdminKey },
      }));
      await leaveSession();
    } catch (reason) {
      setStatusText(reason instanceof Error ? reason.message : "Could not stop the team session.");
    }
  };

  const copyInvite = async () => {
    if (!config) return;
    await navigator.clipboard.writeText(`Railway URL: ${config.cloudUrl}\nSession code: ${config.sessionCode}\nAccess key: ${config.accessKey}`);
    setStatusText("Secure invitation copied.");
  };

  if (!config) {
    return (
      <section className="team-engineer-hero team-entry" aria-label="Join or create a team session">
        <div className="team-engineer-heading">
          <div><span>Team mode</span><h2>Team Session</h2><p>Join an existing race room or create a new one as team leader.</p></div>
          <div className="team-signal"><RadioTower size={22} /><strong>Not in a session</strong><small>Choose how you want to enter</small></div>
        </div>
        <div className="team-entry-switch" role="tablist" aria-label="Team session action">
          <button type="button" className={entryMode === "join" ? "active" : ""} onClick={() => setEntryMode("join")}><LogIn size={17} /> Join a session</button>
          <button type="button" className={entryMode === "create" ? "active" : ""} onClick={() => setEntryMode("create")}><UserPlus size={17} /> Create a session</button>
        </div>
        {entryMode === "join" ? (
          <div className="team-entry-form team-entry-form-join">
            <label>Railway URL<input value={cloudUrl} onChange={(event) => setCloudUrl(event.target.value)} placeholder="https://your-service.up.railway.app" /></label>
            <label>Session code<input value={sessionCode} maxLength={8} onChange={(event) => setSessionCode(event.target.value.toUpperCase())} placeholder="8 characters" /></label>
            <label>Session access key<input type="password" value={accessKey} onChange={(event) => setAccessKey(event.target.value)} placeholder="Private team invitation key" /></label>
            <label>Your name<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Displayed to the team" /></label>
            <button type="button" className="team-primary-action" onClick={() => void join()}><LogIn size={17} /> Join session</button>
          </div>
        ) : (
          <div className="team-entry-form team-entry-form-create">
            <label>Railway URL<input value={cloudUrl} onChange={(event) => setCloudUrl(event.target.value)} placeholder="https://your-service.up.railway.app" /></label>
            <label>Team name<input value={teamName} onChange={(event) => setTeamName(event.target.value)} /></label>
            <label>Session name<input value={sessionName} onChange={(event) => setSessionName(event.target.value)} /></label>
            <label>Team leader name<input value={leaderName} onChange={(event) => setLeaderName(event.target.value)} /></label>
            <label>Railway admin key<input type="password" value={adminKey} onChange={(event) => setAdminKey(event.target.value)} /></label>
            <button type="button" className="team-primary-action" disabled={creating || !cloudUrl || !teamName || !sessionName || !leaderName || !adminKey} onClick={() => void createSession()}>{creating ? "Creating…" : "Create session"}</button>
          </div>
        )}
        {statusText && <p className="team-status-message">{statusText}</p>}
      </section>
    );
  }

  return (
    <section className="team-engineer-hero" aria-label="Active team session">
      <div className="team-engineer-heading">
        <div>
          <span>{isLeader ? "Team leader" : "Team member"}</span>
          <h2>{sessionInfo?.name || `Session ${config.sessionCode}`}</h2>
          <p>{sessionInfo?.team_name || "Team session"} · Code {config.sessionCode} · Signed in as {config.displayName}</p>
        </div>
        <div className={`team-signal ${remoteConnected ? "connected" : ""}`}>
          <RadioTower size={22} />
          <strong>{remoteConnected ? cloudHasData ? "Cloud telemetry live" : "Cloud connected · waiting for data" : "Waiting for cloud"}</strong>
          <small>{remoteError || (cloudHasData ? `Frame ${presence.sequence} · ${new Date(presence.last_snapshot_at!).toLocaleTimeString()}` : `Session ${config.sessionCode}`)}</small>
        </div>
      </div>

      <div className="team-connection-rail" aria-live="polite">
        <span><Cloud size={16} /><small>Cloud</small><strong>{remoteConnected ? "Connected" : "Offline"}</strong></span>
        <span><Radio size={16} /><small>Active driver</small><strong>{presence.active_driver || "Waiting"}</strong></span>
        <span><Users size={16} /><small>Viewers</small><strong>{presence.viewer_count ?? 0}</strong></span>
        <span><Upload size={16} /><small>This PC</small><strong>{publishingStatus?.publishing ? publishingStatus.connected ? `Publishing · ${publishingStatus.acknowledged_frames ?? 0} confirmed` : publishingStatus.socket_connected ? "Connected · awaiting cloud ack" : "Reconnecting" : desktopAvailable ? "Viewer / idle" : "Browser viewer"}</strong></span>
      </div>

      <div className="team-session-actions">
        <button type="button" onClick={() => void copyInvite()}><Copy size={15} /> Copy secure invite</button>
        {isLeader
          ? <button type="button" className="danger" onClick={() => void endSession()}><Power size={15} /> Stop session</button>
          : <button type="button" className="danger" onClick={() => void leaveSession()}><LogOut size={15} /> Exit session</button>}
      </div>

      <div className="team-participants">
        <div className="team-participants-heading"><div><span>Session roster</span><h3>Participants</h3></div><small>{participants.filter((participant) => participant.online).length} online · {participants.length} joined</small></div>
        <div className="table-wrap"><table><thead><tr><th>Participant</th><th>Role</th><th>Status</th><th>Laps</th><th>Fastest lap</th><th>Last lap</th></tr></thead><tbody>
          {participants.map((participant) => <tr key={participant.display_name}>
            <td><span className="team-participant-name">{participant.role === "leader" && <Crown size={13} />}{participant.display_name}</span></td>
            <td>{participant.active_role === "driver" ? "Driver" : participant.role === "leader" ? "Team leader" : "Viewer"}</td>
            <td><span className={`team-presence-pill ${participant.online ? "online" : ""}`}><i />{participant.online ? "Online" : "Offline"}</span></td>
            <td>{participant.lap_count}</td><td>{formatLapTime(participant.fastest_lap)}</td><td>{participant.last_lap ?? "--"}</td>
          </tr>)}
          {!participants.length && <tr><td colSpan={6}>Waiting for the participant list…</td></tr>}
        </tbody></table></div>
      </div>

      {desktopAvailable && (
        <div className="team-publisher-actions">
          {!publishingStatus?.publishing ? (
            <>
              <button type="button" onClick={() => void publish(false)}><Upload size={16} /> Start publishing</button>
              <button type="button" onClick={() => void publish(true)}>Take over active driver</button>
            </>
          ) : <button type="button" className="danger" onClick={() => void stopPublishing()}><Square size={15} /> Stop publishing</button>}
          <small>Local collection and recording are unaffected by these controls.</small>
        </div>
      )}

      {statusText && <p className="team-status-message">{statusText}</p>}
      {publishingStatus?.publishing && publishingStatus.last_error && <p className="team-status-message">Publisher error: {publishingStatus.last_error}</p>}
    </section>
  );
}

type CloudLap = { driver_name: string; lap_number: number; lap_time?: number | null; fuel_used?: number | null; max_speed?: number | null; sample_count: number };

export function TeamSessionHistory({ trace, config }: { trace: TelemetrySnapshot[]; config: TeamSessionConfig | null }) {
  const [cloudLaps, setCloudLaps] = useState<CloudLap[]>([]);
  useEffect(() => {
    if (!config) {
      setCloudLaps([]);
      return;
    }
    let cancelled = false;
    const refresh = async () => {
      try {
        const response = await fetch(`${config.cloudUrl}/api/cloud/sessions/${config.sessionCode}/laps`, {
          headers: { "X-Session-Access-Key": config.accessKey },
        });
        if (response.ok && !cancelled) setCloudLaps(await response.json() as CloudLap[]);
      } catch {
        // Live browser history remains available while the cloud endpoint reconnects.
      }
    };
    void refresh();
    const id = window.setInterval(() => void refresh(), 3000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [config?.accessKey, config?.cloudUrl, config?.sessionCode]);
  const liveLaps = useMemo(() => {
    const grouped = new Map<number, TelemetrySnapshot[]>();
    trace.forEach((snapshot) => {
      const lap = snapshot.player?.lap_number;
      if (lap != null) grouped.set(lap, [...(grouped.get(lap) || []), snapshot]);
    });
    return [...grouped.entries()].map(([lap, samples]) => ({
      lap,
      samples: samples.length,
      lastTime: samples[samples.length - 1]?.player?.last_lap_time,
      fuelStart: samples[0]?.player?.fuel_liters,
      fuelEnd: samples[samples.length - 1]?.player?.fuel_liters,
      maxSpeed: Math.max(...samples.map((sample) => sample.player?.speed_kph || 0)),
    }));
  }, [trace]);
  return <div className="page grid"><section className="card span-12"><h2>Team Session History</h2><p className="subvalue">{cloudLaps.length ? "Completed laps are persisted by Railway and remain available after refresh or driver handover." : "Live browser history is shown until the first completed lap is persisted."}</p>{cloudLaps.length ? <div className="table-wrap"><table><thead><tr><th>Driver</th><th>Lap</th><th>Lap time</th><th>Fuel used</th><th>Top speed</th><th>Samples</th></tr></thead><tbody>{cloudLaps.map((lap, index) => <tr key={`${lap.driver_name}-${lap.lap_number}-${index}`}><td>{lap.driver_name}</td><td>{lap.lap_number}</td><td>{lap.lap_time ? `${lap.lap_time.toFixed(3)} s` : "--"}</td><td>{lap.fuel_used != null ? `${lap.fuel_used.toFixed(2)} L` : "--"}</td><td>{lap.max_speed ? `${lap.max_speed.toFixed(0)} km/h` : "--"}</td><td>{lap.sample_count}</td></tr>)}</tbody></table></div> : liveLaps.length ? <div className="table-wrap"><table><thead><tr><th>Lap</th><th>Samples</th><th>Last lap</th><th>Fuel used</th><th>Top speed</th></tr></thead><tbody>{liveLaps.map((lap) => <tr key={lap.lap}><td>{lap.lap}</td><td>{lap.samples}</td><td>{lap.lastTime ? `${lap.lastTime.toFixed(3)} s` : "--"}</td><td>{lap.fuelStart != null && lap.fuelEnd != null ? `${Math.max(0, lap.fuelStart - lap.fuelEnd).toFixed(2)} L` : "--"}</td><td>{lap.maxSpeed ? `${lap.maxSpeed.toFixed(0)} km/h` : "--"}</td></tr>)}</tbody></table></div> : <p>No remote lap samples received yet.</p>}</section></div>;
}

export function TeamXYPlot({ trace }: { trace: TelemetrySnapshot[] }) {
  const points = trace.slice(-700).map((snapshot) => ({
    x: Number(snapshot.player?.g_force_lat || 0),
    y: Number(snapshot.player?.g_force_long || 0),
  })).filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  const extent = Math.max(1.5, ...points.flatMap((point) => [Math.abs(point.x), Math.abs(point.y)]));
  const project = (value: number) => 200 + (value / extent) * 175;
  return <div className="page grid"><section className="card span-12 team-xy-card"><h2>Live Team XY · Friction Circle</h2><p className="subvalue">Current relayed lateral G versus longitudinal G. The plot remains live while the selected driver publishes.</p><svg viewBox="0 0 400 400" role="img" aria-label="Live friction-circle scatter plot"><line x1="200" y1="20" x2="200" y2="380" /><line x1="20" y1="200" x2="380" y2="200" /><circle cx="200" cy="200" r="175" className="team-xy-boundary" />{points.map((point, index) => <circle key={index} cx={project(point.x)} cy={project(-point.y)} r="2.2" className="team-xy-point" />)}</svg></section></div>;
}
