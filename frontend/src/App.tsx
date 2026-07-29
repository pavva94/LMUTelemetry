import { useEffect, useState } from "react";
import { api } from "./api/client";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Layout, type PageKey } from "./components/Layout";
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
import type { CompetitorState } from "./types/telemetry";

export default function App() {
  const pageFromHash = (): PageKey => {
    const value = window.location.hash.replace(/^#\/?/, "");
    if (value === "race-simulation") return "planner";
    if (value === "lap-compare") return "race-history";
    return ["live", "profile", "circle-map", "one-lap", "race-history", "xy-plotter", "settings", "planner", "race-prep", "lap-analysis", "pit", "review"].includes(value) ? value as PageKey : "live";
  };
  const [page, setPage] = useState<PageKey>(pageFromHash);
  useEffect(() => {
    const sync = () => setPage(pageFromHash());
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  const navigate = (next: PageKey) => {
    window.location.hash = next;
    setPage(next);
  };
  const { data: telemetry, connected: telemetryConnected } = useTelemetrySocket();
  const { strategy, recommendation } = useStrategySocket();
  const [competitors, setCompetitors] = useState<CompetitorState[]>([]);
  useEffect(() => {
    const id = window.setInterval(() => void api.competitors().then(setCompetitors).catch(() => {}), 2000);
    return () => window.clearInterval(id);
  }, []);
  const currentCompetitors = telemetry?.competitors?.length ? telemetry.competitors : competitors;
  return (
    <Layout page={page} setPage={navigate}>
      <ErrorBoundary>
        <div style={{ display: page === "live" ? "contents" : "none" }} aria-hidden={page !== "live"}>
          <LiveDashboard telemetry={telemetry} strategy={strategy} recommendation={recommendation} connected={telemetryConnected} competitors={currentCompetitors} />
        </div>
        {page === "profile" && <UserProfile />}
        {page === "circle-map" && <CircleMap telemetry={telemetry} strategy={strategy} competitors={currentCompetitors} />}
        {page === "one-lap" && <OneLapTiming telemetry={telemetry} strategy={strategy} competitors={currentCompetitors} />}
        {page === "race-history" && <RaceHistory telemetry={telemetry} strategy={strategy} competitors={currentCompetitors} />}
        {page === "xy-plotter" && <XYPlotter telemetry={telemetry} strategy={strategy} competitors={currentCompetitors} />}
        {page === "settings" && <SettingsPage telemetry={telemetry} strategy={strategy} competitors={currentCompetitors} />}
        {page === "planner" && <StrategyPlanner strategy={strategy} telemetry={telemetry} />}
        {page === "race-prep" && <RacePrepReport strategy={strategy} />}
        {page === "lap-analysis" && <LiveLapAnalysis />}
        {page === "pit" && <PitWindow strategy={strategy} telemetry={telemetry} />}
        {page === "review" && <LmuDuckdbReview />}
      </ErrorBoundary>
    </Layout>
  );
}
