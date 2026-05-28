from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import motec_routes, profile_routes, session_routes, strategy_routes, telemetry_routes, websocket_routes
from app.core.config import get_settings
from app.db.database import init_db
from app.services.telemetry_service import TelemetryService

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    service = TelemetryService(get_settings())
    app.state.telemetry_service = service
    await service.start()
    try:
        yield
    finally:
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
app.include_router(profile_routes.router)
