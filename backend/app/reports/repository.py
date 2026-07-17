from __future__ import annotations

import json
from pathlib import Path

from sqlalchemy import delete, select

from app.core.paths import app_data_dir
from app.db.database import SessionLocal
from app.db.models import SessionPerformanceReportModel


def report_root() -> Path:
    root = app_data_dir() / "performance-reports"
    root.mkdir(parents=True, exist_ok=True)
    return root


def public(model: SessionPerformanceReportModel) -> dict:
    try:
        config = json.loads(model.configuration_json or "{}")
    except Exception:
        config = {}
    return {
        "id": model.id, "session_id": model.session_id, "generated_at": model.generated_at,
        "report_type": model.report_type, "report_version": model.report_version,
        "language": model.language, "detail_level": model.detail_level,
        "methodology_version": model.methodology_version, "configuration": config,
        "checksum": model.checksum, "status": model.status, "error_stage": model.error_stage,
        "error_details": model.error_details, "download_available": bool(model.generated_file_path and Path(model.generated_file_path).is_file()),
    }


class ReportRepository:
    def add(self, model: SessionPerformanceReportModel) -> dict:
        with SessionLocal() as db:
            db.add(model); db.commit(); db.refresh(model)
            return public(model)

    def update(self, report_id: str, **values) -> dict:
        with SessionLocal() as db:
            model = db.get(SessionPerformanceReportModel, report_id)
            if model is None:
                raise KeyError(report_id)
            for key, value in values.items():
                setattr(model, key, value)
            db.commit(); db.refresh(model)
            return public(model)

    def list(self, session_id: str) -> list[dict]:
        with SessionLocal() as db:
            rows = db.scalars(select(SessionPerformanceReportModel).where(SessionPerformanceReportModel.session_id == session_id).order_by(SessionPerformanceReportModel.generated_at.desc())).all()
            return [public(row) for row in rows]

    def cached_analysis(self, session_id: str, report_version: str, methodology_version: str) -> dict | None:
        with SessionLocal() as db:
            model = db.scalars(
                select(SessionPerformanceReportModel)
                .where(
                    SessionPerformanceReportModel.session_id == session_id,
                    SessionPerformanceReportModel.report_version == report_version,
                    SessionPerformanceReportModel.methodology_version == methodology_version,
                    SessionPerformanceReportModel.status == "complete",
                    SessionPerformanceReportModel.analysis_json.is_not(None),
                )
                .order_by(SessionPerformanceReportModel.generated_at.desc())
            ).first()
            if model is None or not model.analysis_json:
                return None
            try:
                return json.loads(model.analysis_json)
            except Exception:
                return None

    def path(self, report_id: str) -> Path:
        with SessionLocal() as db:
            model = db.get(SessionPerformanceReportModel, report_id)
            if model is None or not model.generated_file_path:
                raise KeyError(report_id)
            path = Path(model.generated_file_path).resolve()
        root = report_root().resolve()
        if root not in path.parents or not path.is_file():
            raise FileNotFoundError(report_id)
        return path

    def delete(self, report_id: str) -> None:
        path: Path | None = None
        with SessionLocal() as db:
            model = db.get(SessionPerformanceReportModel, report_id)
            if model is None:
                raise KeyError(report_id)
            if model.generated_file_path:
                candidate = Path(model.generated_file_path).resolve()
                if report_root().resolve() in candidate.parents:
                    path = candidate
            db.execute(delete(SessionPerformanceReportModel).where(SessionPerformanceReportModel.id == report_id)); db.commit()
        if path and path.exists():
            path.unlink()
