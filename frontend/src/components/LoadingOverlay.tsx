import { initialLanguage, translate } from "../i18n/core";

type LoadingOverlayProps = {
  show: boolean;
  title?: string;
  detail?: string;
  percentage?: number | null;
  error?: string | null;
};

export function LoadingOverlay({ show, title, detail, percentage, error }: LoadingOverlayProps) {
  if (!show) return null;
  const language = initialLanguage();
  const value = percentage == null ? null : Math.max(0, Math.min(100, Math.round(percentage)));
  const displayTitle = title || translate(language, "navigation.liveDashboard");
  const displayDetail = detail || translate(language, "common.waitingTelemetry");
  return (
    <div className="loading-overlay" role="status" aria-live="polite" aria-busy="true">
      <div className="loading-panel">
        {value == null && <span className="loading-spinner" aria-hidden="true" />}
        <strong>{displayTitle}</strong>
        <span>{displayDetail}</span>
        <div className={`loading-progress ${error ? "error" : ""}`} role="progressbar" aria-label={displayTitle} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value ?? undefined}>
          <span style={{ width: `${value ?? 18}%` }} />
        </div>
        {value != null && <b className="loading-percentage">{value}%</b>}
        {error && <span className="loading-error">{error}</span>}
      </div>
    </div>
  );
}
