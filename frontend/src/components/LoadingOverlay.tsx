type LoadingOverlayProps = {
  show: boolean;
  title?: string;
  detail?: string;
};

export function LoadingOverlay({ show, title = "Loading telemetry", detail = "Large DuckDB sessions can take a moment to read." }: LoadingOverlayProps) {
  if (!show) return null;
  return (
    <div className="loading-overlay" role="status" aria-live="polite" aria-busy="true">
      <div className="loading-panel">
        <span className="loading-spinner" aria-hidden="true" />
        <strong>{title}</strong>
        <span>{detail}</span>
      </div>
    </div>
  );
}
