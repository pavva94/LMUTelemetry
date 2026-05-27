import { CompetitorTable } from "../components/CompetitorTable";
import type { CompetitorState } from "../types/telemetry";

export function Competitors({ competitors }: { competitors: CompetitorState[] }) {
  return <div className="page grid"><CompetitorTable competitors={competitors} /></div>;
}
