from __future__ import annotations

import asyncio
import logging
from contextlib import suppress
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.api import lmu_duckdb_routes, motec_routes, profile_routes, session_routes, strategy_routes, telemetry_routes, websocket_routes
from app.core.config import get_settings
from app.core.paths import frontend_dist_dir, log_dir
from app.db.database import init_db
from app.services import lmu_duckdb_repository
from app.services.telemetry_service import TelemetryService


def _configure_logging() -> None:
    handlers: list[logging.Handler] = [logging.StreamHandler()]
    try:
        logs = log_dir()
        logs.mkdir(parents=True, exist_ok=True)
        handlers.append(logging.FileHandler(logs / "backend.log", encoding="utf-8"))
    except OSError:
        pass
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s", handlers=handlers, force=True)


_configure_logging()
logger = logging.getLogger(__name__)


def _sync_lmu_duckdb_on_startup() -> None:
    try:
        result = lmu_duckdb_repository.sync_folder()
    except FileNotFoundError:
        logger.info("Skipping LMU DuckDB startup sync: no telemetry folder configured.")
    except NotADirectoryError as exc:
        logger.warning("Skipping LMU DuckDB startup sync: %s", exc)
    except RuntimeError as exc:
        logger.warning("Skipping LMU DuckDB startup sync: %s", exc)
    except Exception as exc:
        logger.exception("LMU DuckDB startup sync failed: %s", exc)
    else:
        logger.info(
            "LMU DuckDB startup sync complete: processed=%s skipped=%s inactive=%s failed=%s",
            result.get("processed", 0),
            result.get("skipped", 0),
            result.get("inactive", 0),
            result.get("failed", 0),
        )


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    duckdb_sync_task = asyncio.create_task(asyncio.to_thread(_sync_lmu_duckdb_on_startup))
    app.state.duckdb_sync_task = duckdb_sync_task
    service = TelemetryService(get_settings())
    app.state.telemetry_service = service
    await service.start()
    try:
        yield
    finally:
        if not duckdb_sync_task.done():
            duckdb_sync_task.cancel()
            with suppress(asyncio.CancelledError):
                await duckdb_sync_task
        await service.stop()


app = FastAPI(title="LMU Race Strategy Assistant", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+):517\d",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(telemetry_routes.router)
app.include_router(strategy_routes.router)
app.include_router(session_routes.router)
app.include_router(websocket_routes.router)
app.include_router(motec_routes.router)
app.include_router(lmu_duckdb_routes.router)
app.include_router(profile_routes.router)


def _mount_packaged_frontend() -> None:
    dist = frontend_dist_dir()
    index = dist / "index.html"
    assets = dist / "assets"
    if not index.exists():
        logger.info("Frontend dist not found at %s; API-only backend mode is active.", dist)
        return
    if assets.exists():
        app.mount("/assets", StaticFiles(directory=assets), name="assets")

    @app.get("/", include_in_schema=False)
    async def frontend_index():
        return FileResponse(index)

    @app.get("/{full_path:path}", include_in_schema=False)
    async def frontend_spa(full_path: str):
        if full_path.startswith(("api/", "ws/")):
            raise HTTPException(status_code=404, detail="Not found")
        candidate = dist / full_path
        if candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(index)


_mount_packaged_frontend()
