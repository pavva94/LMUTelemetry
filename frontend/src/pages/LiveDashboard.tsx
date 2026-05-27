import { CompetitorTable } from "../components/CompetitorTable";
import { FuelWidget } from "../components/FuelWidget";
import { RecommendationPanel } from "../components/RecommendationPanel";
import { SessionWidget } from "../components/SessionWidget";
import { TelemetryCard } from "../components/TelemetryCard";
import { TyreWidget } from "../components/TyreWidget";
import type { RecommendationPayload, StrategyState } from "../types/strategy";
import type { TelemetrySnapshot } from "../types/telemetry";

export function LiveDashboard({ telemetry, strategy, recommendation, connected }: { telemetry: TelemetrySnapshot | null; strategy: StrategyState | null; recommendation: RecommendationPayload | null; connected: boolean }) {
  return (
    <div className="page grid">
      <SessionWidget session={telemetry?.session} env={telemetry?.environment} connected={connected && Boolean(telemetry?.connected)} />
      <TelemetryCard player={telemetry?.player} />
      <FuelWidget fuel={strategy?.fuel} player={telemetry?.player} />
      <TyreWidget tyres={telemetry?.player?.tyre_state} strategy={strategy?.tyres} />
      <RecommendationPanel payload={recommendation} />
      <section className="card span-4">
        <h2>Gaps</h2>
        <div className="metric"><span className="label">Car ahead</span><span className="value">{telemetry?.player?.gap_car_ahead?.toFixed(1) ?? "--"} s</span></div>
        <div className="metric"><span className="label">Car behind</span><span className="value">{telemetry?.player?.gap_car_behind?.toFixed(1) ?? "--"} s</span></div>
      </section>
      <CompetitorTable competitors={(telemetry?.competitors || []).slice(0, 8)} />
    </div>
  );
}
