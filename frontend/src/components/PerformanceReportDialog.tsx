import { useEffect, useMemo, useState } from "react";
import { Download, FileText, RefreshCw, Trash2, X } from "lucide-react";
import { api } from "../api/client";
import { useDuckdbJob } from "../hooks/useDuckdbJob";
import type { PerformanceReportConfiguration, PerformanceReportRecord, SavedSession } from "../types/session";

type Props = { session: SavedSession; onClose: () => void };

const detectedType = (value?: string | null) => {
  const type = (value || "Unknown").toLowerCase();
  if (type.includes("qual")) return "Qualifying";
  if (type.includes("race") || type.includes("gara")) return "Race";
  return "Practice";
};

const structures: Record<string, string[]> = {
  Practice: ["Learning and run phases", "Clean pace development", "Fuel and tyre evolution", "Consistency and repeatability", "Next-test priorities"],
  Qualifying: ["Qualifying Execution Assessment", "Preparation and push sequence", "Best, theoretical and realistic potential", "Tyre readiness and invalidations", "Peak-execution priorities"],
  Race: ["Race progression", "Stints and pit execution", "Position and traffic evidence", "Fuel, tyres and representative race pace", "Operational priorities"],
};

const initialConfiguration = (): PerformanceReportConfiguration => ({ language: "en", detail_level: "concise", include_charts: true, anonymize_driver: false, title: "", driver_name: "", team_name: "", notes: "" });

export function PerformanceReportDialog({ session, onClose }: Props) {
  const { run, progress } = useDuckdbJob();
  const [configuration, setConfiguration] = useState<PerformanceReportConfiguration>(initialConfiguration);
  const [reports, setReports] = useState<PerformanceReportRecord[]>([]);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const type = detectedType(session.session_type);

  const loadReports = () => api.performanceReports(session.id).then(setReports).catch((exc) => setError(exc instanceof Error ? exc.message : "Could not load generated reports"));
  useEffect(() => { loadReports(); }, [session.id]);
  const preview = useMemo(() => ["Cover and executive summary", "Data quality and methodology", "Session timeline", ...structures[type], "Prioritized actions"], [type]);

  const generate = async (next = configuration) => {
    setGenerating(true); setError("");
    try {
      await run<PerformanceReportRecord>(() => api.startPerformanceReportJob(session.id, next));
      await loadReports();
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Report generation failed");
    } finally { setGenerating(false); }
  };

  const remove = async (id: string) => {
    setError("");
    try { await api.deletePerformanceReport(id); await loadReports(); }
    catch (exc) { setError(exc instanceof Error ? exc.message : "Could not delete report"); }
  };

  const update = <K extends keyof PerformanceReportConfiguration>(key: K, value: PerformanceReportConfiguration[K]) => setConfiguration((current) => ({ ...current, [key]: value }));

  return (
    <div className="report-modal-backdrop" role="presentation">
      <section className="report-modal" role="dialog" aria-modal="true" aria-labelledby="performance-report-title">
        <header><div><span className="eyebrow"><FileText size={15} /> Offline deterministic analysis</span><h2 id="performance-report-title">Generate Performance Report</h2><p>Build a professional PDF from measured data in this historical session.</p></div><button className="icon-button" onClick={onClose} aria-label="Close"><X /></button></header>
        <div className="report-modal-grid">
          <div className="report-options">
            <div className="report-detected"><span>Detected session structure</span><strong>{type}</strong><small>{session.track_name || "Track unavailable"} · {session.vehicle_model || session.vehicle_name || "Car unavailable"}</small></div>
            <div className="form-grid two">
              <label><span>Report language</span><select value={configuration.language} onChange={(event) => update("language", event.target.value as "en" | "it")}><option value="en">English</option><option value="it">Italiano</option></select></label>
              <label><span>Detail level</span><select value={configuration.detail_level} onChange={(event) => update("detail_level", event.target.value as "concise" | "detailed")}><option value="concise">Concise · 5–8 pages</option><option value="detailed">Detailed · 10–18 pages</option></select></label>
              <label><span>Report title (optional)</span><input value={configuration.title || ""} onChange={(event) => update("title", event.target.value)} maxLength={160} /></label>
              <label><span>Driver name (optional)</span><input value={configuration.driver_name || ""} onChange={(event) => update("driver_name", event.target.value)} maxLength={120} disabled={configuration.anonymize_driver} /></label>
              <label><span>Team name (optional)</span><input value={configuration.team_name || ""} onChange={(event) => update("team_name", event.target.value)} maxLength={120} /></label>
            </div>
            <label><span>Notes (optional)</span><textarea value={configuration.notes || ""} onChange={(event) => update("notes", event.target.value)} maxLength={2000} rows={3} /></label>
            <div className="toggle-row"><label><input type="checkbox" checked={configuration.include_charts} onChange={(event) => update("include_charts", event.target.checked)} /> Include all charts supported by reliable data</label><label><input type="checkbox" checked={configuration.anonymize_driver} onChange={(event) => update("anonymize_driver", event.target.checked)} /> Anonymize driver name</label></div>
          </div>
          <aside className="report-preview"><h3>Structure preview</h3><ol>{preview.map((section) => <li key={section}>{section}</li>)}</ol><p>Unsupported metrics are marked unavailable with the reason; no values or events are invented.</p></aside>
        </div>
        {(generating || progress || error) && <div className={`report-progress ${error ? "error" : ""}`}><div><strong>{error ? "Generation failed" : progress?.phase || "Preparing report"}</strong><span>{error || progress?.message || "Starting background analysis"}</span></div>{!error && <><progress max={100} value={progress?.percentage || 0} /><b>{progress?.percentage || 0}%</b></>}</div>}
        <div className="report-modal-actions"><button onClick={onClose}>Close</button><button className="primary" onClick={() => generate()} disabled={generating}>{generating ? "Generating…" : "Generate report"}</button></div>
        <div className="report-history"><h3>Previously generated reports</h3>{reports.length ? <div className="table-wrap"><table><thead><tr><th>Generated</th><th>Type</th><th>Version</th><th>Language</th><th>Detail</th><th>Status</th><th>Actions</th></tr></thead><tbody>{reports.map((report) => <tr key={report.id}><td>{new Date(report.generated_at).toLocaleString()}</td><td>{report.report_type}</td><td>{report.report_version}</td><td>{report.language.toUpperCase()}</td><td>{report.detail_level}</td><td>{report.status}{report.error_stage ? ` · ${report.error_stage}` : ""}</td><td><div className="compact-actions">{report.download_available && <a className="button-link" href={api.performanceReportDownloadUrl(report.id)}><Download size={14} /> Download</a>}<button onClick={() => generate(report.configuration)} disabled={generating}><RefreshCw size={14} /> Regenerate</button><button onClick={() => remove(report.id)}><Trash2 size={14} /> Delete</button></div></td></tr>)}</tbody></table></div> : <p className="muted">No generated reports for this session yet.</p>}</div>
      </section>
    </div>
  );
}
