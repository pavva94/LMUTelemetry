import { useEffect, useRef, useState } from "react";
import { api } from "./api/client";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Layout, type PageKey, type ViewMode } from "./components/Layout";
import { LiveDashboard } from "./pages/LiveDashboard";
import { LiveLapAnalysis } from "./pages/LiveLapAnalysis";
import { LmuDuckdbReview } from "./pages/LmuDuckdbReview";
import { PitWindow } from "./pages/PitWindow";
import {
  CircleMap,
  OneLapTiming,
  RaceHistory,
  SettingsPage,
  XYPlotter,
} from "./pages/RaceEngineeringPages";
import { RacePrepReport } from "./pages/RacePrepReport";
import { StrategyPlanner } from "./pages/StrategyPlanner";
import { UserProfile } from "./pages/UserProfile";
import { useStrategySocket } from "./hooks/useStrategySocket";
import { useTelemetrySocket } from "./hooks/useTelemetrySocket";
import { useTeamTelemetrySocket } from "./hooks/useTeamTelemetrySocket";
import {
  loadTeamConfig,
  TeamRaceEngineer,
  TeamSessionHistory,
  TeamXYPlot,
  useTeamPublishingStatus,
} from "./pages/TeamRaceEngineer";
import type { TeamSessionConfig } from "./types/team";
import type { CompetitorState } from "./types/telemetry";

const CLOUD_ONLY = import.meta.env.VITE_CLOUD_ONLY === "true";
const teamPanelPages: PageKey[] = ["live", "circle-map", "one-lap", "race-history", "xy-plotter", "pit"];
const teamPages: PageKey[] = ["team-session", ...teamPanelPages];

export default function App() {
  const initialTeamConfig = useRef<TeamSessionConfig | null>(loadTeamConfig()).current;
  const teamConfigRef = useRef<TeamSessionConfig | null>(initialTeamConfig);
  const viewModeFromHash = (): ViewMode => CLOUD_ONLY || window.location.hash.replace(/^#\/?/, "").startsWith("team/") ? "team" : "local";
  const pageFromHash = (config: TeamSessionConfig | null = teamConfigRef.current): PageKey => {
    const value = window.location.hash.replace(/^#\/?/, "").replace(/^team\//, "");
    const aliasedValue = value === "race-simulation" ? "planner" : value === "lap-compare" ? "race-history" : value;
    const page = ["team-session", "live", "profile", "circle-map", "one-lap", "race-history", "xy-plotter", "settings", "planner", "race-prep", "lap-analysis", "pit", "review"].includes(aliasedValue) ? aliasedValue as PageKey : "live";
    if (viewModeFromHash() === "team") {
      if (!config) return "team-session";
      return teamPages.includes(page) ? page : "live";
    }
    return page === "team-session" ? "live" : page;
  };
  const [page, setPage] = useState<PageKey>(() => pageFromHash(initialTeamConfig));
  const [viewMode, setViewModeState] = useState<ViewMode>(viewModeFromHash);
  const viewModeRef = useRef<ViewMode>(viewMode);
  const [teamConfig, setTeamConfigState] = useState<TeamSessionConfig | null>(initialTeamConfig);
  useEffect(() => {
    const sync = () => {
      setPage(pageFromHash());
      const nextMode = viewModeFromHash();
      viewModeRef.current = nextMode;
      setViewModeState(nextMode);
    };
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  const navigate = (next: PageKey) => {
    const target = viewModeRef.current === "team" ? next === "team-session" ? next : teamItemsPage(next) : next;
    window.location.hash = viewModeRef.current === "team" ? `team/${target}` : target;
    setPage(target);
  };
  const setViewMode = (next: ViewMode) => {
    if (CLOUD_ONLY) return;
    viewModeRef.current = next;
    setViewModeState(next);
    window.location.hash = next === "team" ? `team/${teamItemsPage(page)}` : page;
  };
  const setTeamConfig = (next: TeamSessionConfig | null) => {
    teamConfigRef.current = next;
    setTeamConfigState(next);
    if (!next) {
      window.localStorage.removeItem("lmu-team-session");
      navigate("team-session");
    } else if (page === "team-session") {
      navigate("live");
    }
  };
  const { data: telemetry, connected: telemetryConnected } = useTelemetrySocket(!CLOUD_ONLY);
  const { strategy, recommendation } = useStrategySocket(!CLOUD_ONLY);
  const team = useTeamTelemetrySocket(teamConfig);
  const { status: publishingStatus, refresh: refreshPublishingStatus } = useTeamPublishingStatus(!CLOUD_ONLY);
  const [competitors, setCompetitors] = useState<CompetitorState[]>([]);
  useEffect(() => {
    if (CLOUD_ONLY) return;
    const id = window.setInterval(() => void api.competitors().then(setCompetitors).catch(() => {}), 2000);
    return () => window.clearInterval(id);
  }, []);
  const activeTelemetry = viewMode === "team" ? team.telemetry : telemetry;
  const activeStrategy = viewMode === "team" ? team.strategy : strategy;
  const activeRecommendation = viewMode === "team" ? team.recommendation : recommendation;
  const activeConnected = viewMode === "team" ? team.connected : telemetryConnected;
  const currentCompetitors = activeTelemetry?.competitors?.length ? activeTelemetry.competitors : viewMode === "local" ? competitors : [];
  return (
    <Layout
      page={page}
      setPage={navigate}
      viewMode={viewMode}
      setViewMode={setViewMode}
      publishing={publishingStatus?.publishing}
      teamOnly={CLOUD_ONLY}
      teamReady={teamConfig !== null}
      teamSummary={teamConfig ? {
        connected: team.connected,
        viewerCount: team.presence.viewer_count ?? 0,
        activeDriver: team.presence.active_driver,
        sessionCode: teamConfig.sessionCode,
      } : undefined}
    >
      <ErrorBoundary>
        {publishingStatus?.publishing && viewMode === "local" && <div className="team-publishing-banner"><span /> {publishingStatus.connected ? `Cloud-confirmed publishing to team session ${publishingStatus.session_code}.` : `Connecting publisher to team session ${publishingStatus.session_code}…`} Changing pages does not interrupt sharing.</div>}
        {viewMode === "team" && page === "team-session" && <TeamRaceEngineer config={teamConfig} setConfig={setTeamConfig} presence={team.presence} remoteConnected={team.connected} remoteError={team.error} publishingStatus={publishingStatus} refreshPublishingStatus={refreshPublishingStatus} />}
        <div style={{ display: page === "live" ? "contents" : "none" }} aria-hidden={page !== "live"}>
          <LiveDashboard telemetry={activeTelemetry} strategy={activeStrategy} recommendation={activeRecommendation} connected={activeConnected} competitors={currentCompetitors} />
        </div>
        {viewMode === "local" && page === "profile" && <UserProfile />}
        {page === "circle-map" && <CircleMap telemetry={activeTelemetry} strategy={activeStrategy} competitors={currentCompetitors} />}
        {page === "one-lap" && <OneLapTiming telemetry={activeTelemetry} strategy={activeStrategy} competitors={currentCompetitors} />}
        {page === "race-history" && (viewMode === "team" ? <TeamSessionHistory trace={team.trace} config={teamConfig} /> : <RaceHistory telemetry={telemetry} strategy={strategy} competitors={currentCompetitors} />)}
        {page === "xy-plotter" && (viewMode === "team" ? <TeamXYPlot trace={team.trace} /> : <XYPlotter telemetry={telemetry} strategy={strategy} competitors={currentCompetitors} />)}
        {viewMode === "local" && page === "settings" && <SettingsPage telemetry={telemetry} strategy={strategy} competitors={currentCompetitors} />}
        {viewMode === "local" && page === "planner" && <StrategyPlanner strategy={strategy} telemetry={telemetry} />}
        {page === "race-prep" && <RacePrepReport strategy={strategy} />}
        {viewMode === "local" && page === "lap-analysis" && <LiveLapAnalysis />}
        {page === "pit" && <PitWindow strategy={activeStrategy} telemetry={activeTelemetry} />}
        {viewMode === "local" && page === "review" && <LmuDuckdbReview />}
      </ErrorBoundary>
    </Layout>
  );
}

function teamItemsPage(page: PageKey): PageKey {
  return teamPanelPages.includes(page) ? page : "live";
}
