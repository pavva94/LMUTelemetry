import { useEffect, useState } from "react";
import { api } from "./api/client";
import { Layout, type PageKey } from "./components/Layout";
import { Competitors } from "./pages/Competitors";
import { LiveDashboard } from "./pages/LiveDashboard";
import { PitWindow } from "./pages/PitWindow";
import { SessionReview } from "./pages/SessionReview";
import { StrategyPlanner } from "./pages/StrategyPlanner";
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
      {page === "live" && <LiveDashboard telemetry={telemetry} strategy={strategy} recommendation={recommendation} connected={telemetryConnected} />}
      {page === "planner" && <StrategyPlanner strategy={strategy} />}
      {page === "pit" && <PitWindow strategy={strategy} />}
      {page === "competitors" && <Competitors competitors={currentCompetitors} />}
      {page === "review" && <SessionReview />}
    </Layout>
  );
}
