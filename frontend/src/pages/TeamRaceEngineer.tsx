import { useEffect, useMemo, useState } from "react";
import { Cloud, Copy, LogIn, Radio, RadioTower, Square, Upload, Users } from "lucide-react";
import type { TeamPresence, TeamPublishingStatus, TeamSessionConfig } from "../types/team";
import type { TelemetrySnapshot } from "../types/telemetry";

const storageKey = "lmu-team-session";

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

export function useTeamPublishingStatus() {
  const [status, setStatus] = useState<TeamPublishingStatus | null>(null);
  const refresh = async () => {
    try {
      setStatus(await responseJson<TeamPublishingStatus>(await fetch("/api/team-sharing/status")));
    } catch {
      setStatus(null);
    }
  };
  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), 1000);
    return () => window.clearInterval(id);
  }, []);
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
  const [cloudUrl, setCloudUrl] = useState(config?.cloudUrl || (window.location.protocol === "https:" ? window.location.origin : ""));
  const [sessionCode, setSessionCode] = useState(config?.sessionCode || "");
  const [accessKey, setAccessKey] = useState(config?.accessKey || "");
  const [displayName, setDisplayName] = useState(config?.displayName || "");
  const [statusText, setStatusText] = useState("");
  const [creating, setCreating] = useState(false);
  const [adminKey, setAdminKey] = useState("");
  const [teamName, setTeamName] = useState("");
  const [sessionName, setSessionName] = useState("");
  const desktopAvailable = publishingStatus !== null;

  const join = async () => {
    const next = {
      cloudUrl: cloudUrl.trim().replace(/\/+$/, ""),
      sessionCode: sessionCode.trim().toUpperCase(),
      accessKey: accessKey.trim(),
      displayName: displayName.trim(),
    };
    if (!next.cloudUrl || next.sessionCode.length !== 8 || next.accessKey.length < 20 || !next.displayName) {
      setStatusText("Cloud URL, session code, access key, and display name are required.");
      return;
    }
    try {
      await responseJson(await fetch(`${next.cloudUrl}/api/cloud/sessions/${next.sessionCode}`, {
        headers: { "X-Session-Access-Key": next.accessKey },
      }));
      window.localStorage.setItem(storageKey, JSON.stringify(next));
      setConfig(next);
      setStatusText("Joined. Team telemetry will appear as soon as a driver publishes.");
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

  const stop = async () => {
    await fetch("/api/team-sharing/stop", { method: "POST" });
    setStatusText("Publishing stopped. Local telemetry recording continues.");
    await refreshPublishingStatus();
  };

  const createSession = async () => {
    setCreating(true);
    try {
      const created = await responseJson<{ code: string; access_key: string }>(await fetch(`${cloudUrl.replace(/\/+$/, "")}/api/cloud/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Team-Admin-Key": adminKey },
        body: JSON.stringify({ name: sessionName, team_name: teamName }),
      }));
      setSessionCode(created.code);
      setAccessKey(created.access_key);
      setStatusText(`Session ${created.code} created. Copy and share both credentials—the access key is shown only now.`);
    } catch (reason) {
      setStatusText(reason instanceof Error ? reason.message : "Could not create the session.");
    } finally {
      setCreating(false);
    }
  };

  return (
    <section className="team-engineer-hero" aria-label="Team Race Engineer connection">
      <div className="team-engineer-heading">
        <div>
          <span>Team mode</span>
          <h2>Race Engineer</h2>
          <p>Join the portal session to watch the active driver. Publishing is independent from the page you are viewing.</p>
        </div>
        <div className={`team-signal ${remoteConnected ? "connected" : ""}`}>
          <RadioTower size={22} />
          <strong>{remoteConnected ? "Cloud link live" : "Waiting for cloud"}</strong>
          <small>{remoteError || (config ? `Session ${config.sessionCode}` : "Enter the team session code")}</small>
        </div>
      </div>

      <div className="team-join-grid">
        <label>Railway URL<input value={cloudUrl} onChange={(event) => setCloudUrl(event.target.value)} placeholder="https://your-service.up.railway.app" /></label>
        <label>Session code<input value={sessionCode} maxLength={8} onChange={(event) => setSessionCode(event.target.value.toUpperCase())} placeholder="8 characters" /></label>
        <label>Session access key<input type="password" value={accessKey} onChange={(event) => setAccessKey(event.target.value)} placeholder="Private team invitation key" /></label>
        <label>Your driver name<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Displayed to the team" /></label>
        <button type="button" className="team-primary-action" onClick={() => void join()}><LogIn size={17} /> Join session</button>
      </div>

      <div className="team-connection-rail" aria-live="polite">
        <span><Cloud size={16} /><small>Cloud</small><strong>{remoteConnected ? "Connected" : "Offline"}</strong></span>
        <span><Radio size={16} /><small>Active driver</small><strong>{presence.active_driver || "Waiting"}</strong></span>
        <span><Users size={16} /><small>Viewers</small><strong>{presence.viewer_count ?? 0}</strong></span>
        <span><Upload size={16} /><small>This PC</small><strong>{publishingStatus?.publishing ? publishingStatus.connected ? "Publishing" : "Reconnecting" : desktopAvailable ? "Viewer / idle" : "Browser viewer"}</strong></span>
      </div>

      {desktopAvailable && config && (
        <div className="team-publisher-actions">
          {!publishingStatus?.publishing ? (
            <>
              <button type="button" onClick={() => void publish(false)}><Upload size={16} /> Start publishing</button>
              <button type="button" onClick={() => void publish(true)}>Take over active driver</button>
            </>
          ) : <button type="button" className="danger" onClick={() => void stop()}><Square size={15} /> Stop publishing</button>}
          <small>Local collection and recording are unaffected by these controls.</small>
        </div>
      )}

      <details className="team-create-session">
        <summary>Create a session as team lead</summary>
        <div className="team-create-grid">
          <label>Team name<input value={teamName} onChange={(event) => setTeamName(event.target.value)} /></label>
          <label>Session name<input value={sessionName} onChange={(event) => setSessionName(event.target.value)} /></label>
          <label>Railway admin key<input type="password" value={adminKey} onChange={(event) => setAdminKey(event.target.value)} /></label>
          <button type="button" disabled={creating || !cloudUrl || !teamName || !sessionName || !adminKey} onClick={() => void createSession()}>{creating ? "Creating…" : "Create secure session"}</button>
          {sessionCode.length === 8 && accessKey.length >= 20 && <button type="button" onClick={() => void navigator.clipboard.writeText(`Session code: ${sessionCode}\nAccess key: ${accessKey}`)}><Copy size={15} /> Copy secure invite</button>}
        </div>
      </details>
      {statusText && <p className="team-status-message">{statusText}</p>}
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
