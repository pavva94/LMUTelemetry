from __future__ import annotations

import argparse
import sys
from pathlib import Path


BACKEND = Path(__file__).resolve().parents[1]
ROOT = BACKEND.parent
sys.path.insert(0, str(BACKEND))

from app.reports.analyzers import SessionAnalysisPipeline  # noqa: E402
from app.reports.models import ReportConfiguration  # noqa: E402
from app.reports.pdf_renderer import PdfReportRenderer  # noqa: E402
from app.services.lmu_duckdb_repository import review_session  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate a performance-report PDF from an indexed LMU historical session.")
    parser.add_argument("session_id")
    parser.add_argument("--language", choices=("en", "it"), default="en")
    parser.add_argument("--detail", choices=("concise", "detailed"), default="detailed")
    parser.add_argument("--output", type=Path, default=ROOT / "output" / "pdf" / "lmu-session-performance-example.pdf")
    args = parser.parse_args()
    review = review_session(None, args.session_id, sample_limit=5000)
    analysis = SessionAnalysisPipeline().analyze(review)
    PdfReportRenderer().render(args.output, analysis, ReportConfiguration(language=args.language, detail_level=args.detail))
    print(args.output.resolve())


if __name__ == "__main__":
    main()
