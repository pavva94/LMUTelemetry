from __future__ import annotations

import hashlib
import json
import traceback
import uuid
from datetime import datetime, timezone
from typing import Callable

from app.db.models import SessionPerformanceReportModel
from app.reports.analyzers import SessionAnalysisPipeline
from app.reports.models import ReportAnalysis, ReportConfiguration
from app.reports.pdf_renderer import PdfReportRenderer
from app.reports.repository import ReportRepository, report_root
from app.services import lmu_duckdb_repository


Progress = Callable[[str, str, int, int, int], None]
REPORT_VERSION = "1.0"


class SessionDataLoader:
    def load(self, session_id: str) -> dict:
        return lmu_duckdb_repository.review_session(None, session_id, sample_limit=5000)


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

    def generate(self, report_id: str, session_id: str, config: ReportConfiguration, progress: Progress) -> dict:
        stage = self.STAGES[0]
        self.repository.update(report_id, status="running")
        try:
            progress(stage, "Opening the indexed historical session", 0, 6, 5)
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
            progress(stage, "Preparing only charts supported by available evidence", 4, 6, 74)
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
