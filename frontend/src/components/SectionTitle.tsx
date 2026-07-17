import type { ReactNode } from "react";
import { Info } from "lucide-react";
import { useT } from "../i18n/I18nProvider";

export function SectionTitle({ title, help }: { title: ReactNode; help?: string }) {
  const t = useT();
  return (
    <div className="section-title">
      <h2>{title}</h2>
      {help && (
        <span className="info-tooltip">
          <button type="button" aria-label={t("tooltips.helpFor", { title: String(title) })}>
            <Info size={14} />
          </button>
          <span className="info-tooltip-panel" role="tooltip">{help}</span>
        </span>
      )}
    </div>
  );
}
