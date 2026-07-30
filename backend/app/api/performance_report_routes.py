from __future__ import annotations

from fastapi import APIRouter, HTTPException, Response
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from app.reports.generator import SessionReportGenerator
from app.reports.models import ReportConfiguration
from app.reports.repository import ReportRepository
from app.services.duckdb_jobs import duckdb_jobs


router = APIRouter(prefix="/api/performance-reports", tags=["performance-reports"])
repository = ReportRepository()
generator = SessionReportGenerator(repository)


class GenerateRequest(BaseModel):
    language: str = Field(default="en", pattern="^(en|it)$")
    # Accepted when regenerating legacy reports; generation below normalizes
    # every request to the single comprehensive format.
    detail_level: str = Field(default="detailed", pattern="^(concise|detailed)$")
    include_charts: bool = True
    anonymize_driver: bool = False
    title: str | None = Field(default=None, max_length=160)
    driver_name: str | None = Field(default=None, max_length=120)
    team_name: str | None = Field(default=None, max_length=120)
    notes: str | None = Field(default=None, max_length=2000)

    def configuration(self) -> ReportConfiguration:
        values = self.model_dump()
        values["detail_level"] = "detailed"
        values["include_charts"] = True
        return ReportConfiguration(**values)


@router.post("/sessions/{session_id}/jobs", status_code=202)
def start_generation(session_id: str, payload: GenerateRequest):
    config = payload.configuration()
    record = generator.create_record(session_id, config)
    return duckdb_jobs.start(lambda progress: generator.generate(record["id"], session_id, config, progress))


@router.get("/sessions/{session_id}")
def list_reports(session_id: str):
    return repository.list(session_id)


@router.get("/{report_id}/download")
def download_report(report_id: str):
    try:
        path = repository.path(report_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="report not found") from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=410, detail="generated report file is unavailable") from exc
    return FileResponse(path, media_type="application/pdf", filename=f"lmu-performance-report-{report_id[:8]}.pdf")


@router.delete("/{report_id}", status_code=204)
def delete_report(report_id: str):
    try:
        repository.delete(report_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="report not found") from exc
    return Response(status_code=204)
