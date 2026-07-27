from __future__ import annotations

import argparse
import os
import sqlite3
import tempfile
from contextlib import closing
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SOURCE = ROOT / "data" / "sessions" / "lmu_strategy.sqlite3"
DEFAULT_OUTPUT = ROOT / "data" / "seed" / "lmu_strategy.sqlite3"

# These rows are either large raw streams, machine-specific state, or transient
# jobs. The remaining tables are compact derived data used by session lists and
# the profile overview.
TABLES_TO_EMPTY = (
    "telemetry_samples",
    "recommendations",
    "assumptions",
    "pit_events",
    "session_performance_reports",
    "lmu_duckdb_sync_runs",
)

# Large sampled traces are useful for local review, but are not needed for the
# instant session/profile bootstrap and can easily make the seed too large for
# Git hosting.
COLUMNS_TO_CLEAR = (
    ("session_aggregates", "sample_trace_json"),
)


def build_seed_cache(source: Path, output: Path) -> dict[str, int]:
    source = source.resolve()
    output = output.resolve()
    if not source.is_file():
        raise FileNotFoundError(f"Source database not found: {source}")
    if source == output:
        raise ValueError("The seed output must be different from the live database.")

    output.parent.mkdir(parents=True, exist_ok=True)
    handle, temporary_name = tempfile.mkstemp(
        prefix=f".{output.stem}-",
        suffix=output.suffix,
        dir=output.parent,
    )
    os.close(handle)
    temporary = Path(temporary_name)

    try:
        with closing(sqlite3.connect(f"file:{source.as_posix()}?mode=ro", uri=True)) as source_db:
            with closing(sqlite3.connect(temporary)) as seed_db:
                source_db.backup(seed_db)

        with closing(sqlite3.connect(temporary)) as seed_db:
            existing_tables = {
                row[0]
                for row in seed_db.execute(
                    "SELECT name FROM sqlite_master WHERE type = 'table'"
                )
            }
            for table in TABLES_TO_EMPTY:
                if table in existing_tables:
                    seed_db.execute(f'DELETE FROM "{table}"')
            for table, column in COLUMNS_TO_CLEAR:
                if table in existing_tables:
                    existing_columns = {
                        row[1] for row in seed_db.execute(f'PRAGMA table_info("{table}")')
                    }
                    if column in existing_columns:
                        seed_db.execute(f'UPDATE "{table}" SET "{column}" = NULL')
            if "app_settings" in existing_tables:
                seed_db.execute(
                    "DELETE FROM app_settings WHERE key = ?",
                    ("lmu_duckdb_folder",),
                )
            seed_db.commit()
            seed_db.execute("VACUUM")
            seed_db.execute("PRAGMA optimize")

            counts = {
                table: int(seed_db.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0])
                for table in sorted(existing_tables)
                if not table.startswith("sqlite_")
            }

        os.replace(temporary, output)
        return counts
    finally:
        temporary.unlink(missing_ok=True)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Build the compact, deployable SQLite cache from the live database."
    )
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    counts = build_seed_cache(args.source, args.output)
    size_mib = args.output.stat().st_size / (1024 * 1024)
    print(f"Built {args.output} ({size_mib:.2f} MiB)")
    for table, count in counts.items():
        print(f"{table}: {count}")


if __name__ == "__main__":
    main()
