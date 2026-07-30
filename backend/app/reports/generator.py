from __future__ import annotations

import hashlib
import json
import traceback
import uuid
from datetime import datetime, timezone
from typing import Callable

from app.analysis.xy_plot import build_xy_plot
from app.db.models import SessionPerformanceReportModel
from app.reports.analyzers import SessionAnalysisPipeline
from app.reports.models import ReportAnalysis, ReportConfiguration
from app.reports.pdf_renderer import PdfReportRenderer
from app.reports.repository import ReportRepository, report_root
from app.services import lmu_duckdb_repository


Progress = Callable[[str, str, int, int, int], None]
REPORT_VERSION = "1.1"

XY_PLOT_CATALOG = (
    ("gg", "G-G Diagram", "Diagramma G-G"),
    ("speed_binned_gg", "Speed-Binned G-G Diagram", "Diagramma G-G per velocità"),
    ("brake_deceleration", "Brake Pressure vs Deceleration", "Pressione freno vs decelerazione"),
    ("throttle_acceptance", "Throttle Acceptance", "Accettazione acceleratore"),
    ("steering_work_lap_time", "Steering Work vs Lap Time", "Lavoro sterzo vs tempo sul giro"),
    ("gear_chart", "Gear Chart", "Diagramma marce"),
    ("curvature_consistency", "Curvature Consistency", "Coerenza curvatura"),
    ("tyre_temperature_grip", "Tyre Temperature vs Grip", "Temperatura pneumatici vs aderenza"),
    ("ride_height_speed", "Ride Height vs Speed", "Altezza da terra vs velocità"),
    ("front_rear_ride_height", "Front Ride Height vs Rear Ride Height", "Altezza anteriore vs posteriore"),
    ("sideslip_curvature", "Vehicle Sideslip vs Curvature", "Deriva veicolo vs curvatura"),
    ("sideslip_phase", "Sideslip Phase Plane", "Piano di fase della deriva"),
    ("engine_power", "Calculated Engine Power vs RPM", "Potenza motore calcolata vs RPM"),
)


class SessionDataLoader:
    def load(self, session_id: str, sample_limit: int = 10000) -> dict:
        return lmu_duckdb_repository.review_session(None, session_id, sample_limit=sample_limit)


class SessionReportGenerator:
    STAGES = (
        "Loading session data", "Validating telemetry", "Detecting laps and stints",
        "Calculating performance metrics", "Building charts", "Generating PDF",
    )

    def __init__(self, repository: ReportRepository | None = None) -> None:
        self.repository = repository or ReportRepository()

    def create_record(self, session_id: str, config: ReportConfiguration) -> dict:
        report_id = uuid.uuid4().hex
        now = datetime.now(timezone.utc).isoformat()
        model = SessionPerformanceReportModel(
            id=report_id, session_id=session_id, generated_at=now, report_type="pending",
            report_version=REPORT_VERSION, language=config.language, detail_level=config.detail_level,
            methodology_version=SessionAnalysisPipeline.METHODOLOGY_VERSION,
            configuration_json=json.dumps(config.public(), ensure_ascii=False), status="queued",
        )
        return self.repository.add(model)

    @staticmethod
    def _build_xy_plots(review: dict, language: str) -> list[dict]:
        rows = review.get("telemetry_samples") or []
        laps = review.get("laps") or []
        plots: list[dict] = []
        for plot_id, english_title, italian_title in XY_PLOT_CATALOG:
            result = build_xy_plot(
                rows,
                laps,
                plot_id=plot_id,
                filters={"valid_only": True},
                color_by="speed",
                include_trend=False,
                include_envelope=False,
                max_points=2500,
            )
            if not result.get("available") or not result.get("points"):
                continue
            result["title"] = italian_title if language == "it" else english_title
            plots.append(result)
        return plots

    def generate(self, report_id: str, session_id: str, config: ReportConfiguration, progress: Progress) -> dict:
        stage = self.STAGES[0]
        self.repository.update(report_id, status="running")
        try:
            progress(stage, "Opening the indexed historical session", 0, 6, 5)
            review: dict | None = None
            cached = self.repository.cached_analysis(session_id, REPORT_VERSION, SessionAnalysisPipeline.METHODOLOGY_VERSION)
            if cached:
                analysis = ReportAnalysis.from_public(cached)
                stage = self.STAGES[1]; progress(stage, "Reusing the validated analysis cache", 1, 6, 22)
                stage = self.STAGES[2]; progress(stage, "Reusing cached lap and stint classification", 2, 6, 40)
                stage = self.STAGES[3]; progress(stage, "Reusing version-compatible performance metrics", 3, 6, 60)
            else:
                review = SessionDataLoader().load(session_id)
                if not review.get("session"):
                    raise ValueError("The selected historical session could not be loaded.")
                stage = self.STAGES[1]
                progress(stage, "Auditing laps, samples, channels and anomalies", 1, 6, 18)
                stage = self.STAGES[2]
                progress(stage, "Classifying representative laps and stint boundaries", 2, 6, 34)
                stage = self.STAGES[3]
                progress(stage, "Running robust pace, fuel, tyre, pit and position analysis", 3, 6, 56)
                analysis = SessionAnalysisPipeline().analyze(review)
            stage = self.STAGES[4]
            progress(stage, "Preparing every chart supported by available evidence", 4, 6, 74)
            if review is None:
                review = SessionDataLoader().load(session_id)
            analysis.xy_plots = self._build_xy_plots(review, config.language)
            best_lap_number = analysis.lap.get("best_lap_number")
            if best_lap_number is not None:
                try:
                    trace = lmu_duckdb_repository.trajectory_session(session_id, lap_a=str(best_lap_number), max_points=1800)
                    analysis.comparison["best_lap_trace"] = {
                        "lap": best_lap_number,
                        "points": trace.get("points") or [],
                        "warnings": trace.get("warnings") or [],
                    }
                except Exception:
                    analysis.comparison["best_lap_trace"] = {"lap": best_lap_number, "points": [], "warnings": ["Best-lap input trace unavailable."]}
            output = report_root() / session_id / f"{report_id}.pdf"
            stage = self.STAGES[5]
            progress(stage, "Rendering the vector PDF and report metadata", 5, 6, 88)
            PdfReportRenderer().render(output, analysis, config)
            checksum = hashlib.sha256(output.read_bytes()).hexdigest()
            return self.repository.update(
                report_id, status="complete", report_type=analysis.session_type,
                analysis_json=json.dumps(analysis.public(), ensure_ascii=False), generated_file_path=str(output), checksum=checksum,
                error_stage=None, error_details=None,
            )
        except Exception as exc:
            details = "".join(traceback.format_exception_only(type(exc), exc)).strip()
            self.repository.update(report_id, status="failed", error_stage=stage, error_details=details)
            raise RuntimeError(f"{stage}: {details}") from exc
