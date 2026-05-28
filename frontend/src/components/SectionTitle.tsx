import type { ReactNode } from "react";
import { Info } from "lucide-react";

export function SectionTitle({ title, help }: { title: ReactNode; help?: string }) {
  return (
    <div className="section-title">
      <h2>{title}</h2>
      {help && (
        <span className="info-tooltip">
          <button type="button" aria-label={`${String(title)} help`}>
            <Info size={14} />
          </button>
          <span className="info-tooltip-panel" role="tooltip">{help}</span>
        </span>
      )}
    </div>
  );
}
