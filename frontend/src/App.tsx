import { useEffect, useState } from "react";
import { api } from "./api/client";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Layout, type PageKey } from "./components/Layout";
import { LiveDashboard } from "./pages/LiveDashboard";
import { MotecWorkspace } from "./pages/MotecWorkspace";
import { PitWindow } from "./pages/PitWindow";
import {
  CircleMap,
  LapCompare,
  OneLapTiming,
  RaceHistory,
  RaceInfo,
  SettingsPage,
  StintData,
  XYPlotter,
} from "./pages/RaceEngineeringPages";
import { SessionReview } from "./pages/SessionReview";
import { StrategyPlanner } from "./pages/StrategyPlanner";
import { UserProfile } from "./pages/UserProfile";
import { useStrategySocket } from "./hooks/useStrategySocket";
import { useTelemetrySocket } from "./hooks/useTelemetrySocket";
import type { CompetitorState } from "./types/telemetry";

export default function App() {
  const [page, setPage] = useState<PageKey>("live");
  const { data: telemetry, connected: telemetryConnected } = useTelemetrySocket();
  const { strategy, recommendation, connected: strategyConnected } = useStrategySocket();
  const [competitors, setCompetitors] = useState<CompetitorState[]>([]);
  useEffect(() => {
    const id = window.setInterval(() => void api.competitors().then(setCompetitors).catch(() => {}), 2000);
    return () => window.clearInterval(id);
  }, []);
  const currentCompetitors = telemetry?.competitors?.length ? telemetry.competitors : competitors;
  return (
    <Layout page={page} setPage={setPage} connected={telemetryConnected || strategyConnected}>
      <ErrorBoundary key={page}>
        {page === "live" && <LiveDashboard telemetry={telemetry} strategy={strategy} recommendation={recommendation} connected={telemetryConnected} />}
        {page === "motec" && <MotecWorkspace />}
        {page === "profile" && <UserProfile />}
        {page === "race-info" && <RaceInfo telemetry={telemetry} strategy={strategy} competitors={currentCompetitors} />}
        {page === "circle-map" && <CircleMap telemetry={telemetry} strategy={strategy} competitors={currentCompetitors} />}
        {page === "lap-compare" && <LapCompare telemetry={telemetry} strategy={strategy} competitors={currentCompetitors} />}
        {page === "one-lap" && <OneLapTiming telemetry={telemetry} strategy={strategy} competitors={currentCompetitors} />}
        {page === "race-history" && <RaceHistory telemetry={telemetry} strategy={strategy} competitors={currentCompetitors} />}
        {page === "xy-plotter" && <XYPlotter telemetry={telemetry} strategy={strategy} competitors={currentCompetitors} />}
        {page === "stint-data" && <StintData telemetry={telemetry} strategy={strategy} competitors={currentCompetitors} />}
        {page === "settings" && <SettingsPage telemetry={telemetry} strategy={strategy} competitors={currentCompetitors} />}
        {page === "planner" && <StrategyPlanner strategy={strategy} telemetry={telemetry} />}
        {page === "pit" && <PitWindow strategy={strategy} />}
        {page === "review" && <SessionReview />}
      </ErrorBoundary>
    </Layout>
  );
}
