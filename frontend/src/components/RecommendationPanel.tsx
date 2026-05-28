import type { RecommendationPayload } from "../types/strategy";
import { SectionTitle } from "./SectionTitle";
import { StatusBadge } from "./StatusBadge";

export function RecommendationPanel({ payload }: { payload?: RecommendationPayload | null }) {
  const rec = payload?.current;
  return (
    <section className="card span-8">
      <div className="row"><SectionTitle title="Recommendation" help="Summarizes the current strategy call from fuel, tyre, stint, and pit-window state. Treat high-priority messages as prompts to prepare or change plan." /><StatusBadge value={rec?.priority || "low"} /></div>
      <div className="metric"><span className="label">{rec?.type || "hold_strategy"}</span><span className="value">{rec?.title || "Hold strategy"}</span></div>
      <p className="subvalue">{rec?.message || "Waiting for strategy state."}</p>
      <p className="subvalue">{payload?.ai_explanation || rec?.explanation}</p>
      <div className="row" style={{ flexWrap: "wrap", justifyContent: "flex-start" }}>
        {(rec?.reason_codes || []).map((code) => <StatusBadge key={code} value={code} />)}
      </div>
    </section>
  );
}
