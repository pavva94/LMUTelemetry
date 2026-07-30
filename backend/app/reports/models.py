from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Literal


Confidence = Literal["high", "medium", "low", "unavailable"]


@dataclass
class ReportConfiguration:
    language: Literal["en", "it"] = "en"
    # Persisted for compatibility with existing report records. New reports
    # always use the complete renderer.
    detail_level: Literal["concise", "detailed"] = "detailed"
    include_charts: bool = True
    anonymize_driver: bool = False
    title: str | None = None
    driver_name: str | None = None
    team_name: str | None = None
    notes: str | None = None

    def public(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class Finding:
    key: str
    value: float | str | None
    unit: str | None
    confidence: Confidence
    evidence: str
    inference: bool = True


@dataclass
class Recommendation:
    priority: int
    title: str
    evidence: str
    action: str
    expected_benefit: str
    confidence: Confidence
    validation: str


@dataclass
class ReportAnalysis:
    session: dict[str, Any]
    session_type: str
    structure: str
    audit: dict[str, Any]
    lap: dict[str, Any]
    stints: list[dict[str, Any]]
    fuel: dict[str, Any]
    tyre: dict[str, Any]
    pits: dict[str, Any]
    traffic: dict[str, Any]
    race_progress: dict[str, Any]
    qualifying: dict[str, Any]
    practice: dict[str, Any]
    comparison: dict[str, Any]
    corners: dict[str, Any]
    overview: dict[str, Any]
    systems: dict[str, Any]
    lap_table: list[dict[str, Any]]
    events: list[dict[str, Any]]
    channels: list[dict[str, Any]]
    findings: list[Finding] = field(default_factory=list)
    recommendations: list[Recommendation] = field(default_factory=list)
    methodology: dict[str, Any] = field(default_factory=dict)
    xy_plots: list[dict[str, Any]] = field(default_factory=list)

    def public(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_public(cls, payload: dict[str, Any]) -> "ReportAnalysis":
        data = dict(payload)
        data["findings"] = [Finding(**row) for row in data.get("findings") or []]
        data["recommendations"] = [Recommendation(**row) for row in data.get("recommendations") or []]
        return cls(**data)
