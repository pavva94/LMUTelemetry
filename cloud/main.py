from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import json
import os
import secrets
import string
from contextlib import asynccontextmanager, suppress
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Header, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, create_engine, select
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def database_url() -> str:
    value = os.getenv("DATABASE_URL", "sqlite:///./cloud-lmu-telemetry.sqlite3")
    if value.startswith("postgres://"):
        value = "postgresql+psycopg://" + value.removeprefix("postgres://")
    elif value.startswith("postgresql://"):
        value = "postgresql+psycopg://" + value.removeprefix("postgresql://")
    return value


class Base(DeclarativeBase):
    pass


class TeamSession(Base):
    __tablename__ = "team_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(12), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(160))
    team_name: Mapped[str] = mapped_column(String(120))
    track_name: Mapped[str | None] = mapped_column(String(160), nullable=True)
    status: Mapped[str] = mapped_column(String(24), default="live")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class TeamLap(Base):
    __tablename__ = "team_laps"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("team_sessions.id"), index=True)
    driver_name: Mapped[str] = mapped_column(String(80), index=True)
    lap_number: Mapped[int] = mapped_column(Integer)
    lap_time: Mapped[float | None] = mapped_column(Float, nullable=True)
    fuel_used: Mapped[float | None] = mapped_column(Float, nullable=True)
    max_speed: Mapped[float | None] = mapped_column(Float, nullable=True)
    sample_count: Mapped[int] = mapped_column(Integer)
    completed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


engine = create_engine(database_url(), pool_pre_ping=True)
ticket_secret = os.getenv("TOKEN_SECRET", "development-only-change-me").encode("utf-8")


def issue_ticket(claims: dict[str, Any]) -> str:
    body = dict(claims)
    body["issued_at"] = int(utc_now().timestamp())
    encoded = base64.urlsafe_b64encode(json.dumps(body, separators=(",", ":")).encode()).rstrip(b"=")
    signature = hmac.new(ticket_secret, encoded, hashlib.sha256).digest()
    return f"{encoded.decode()}.{base64.urlsafe_b64encode(signature).rstrip(b'=').decode()}"


def load_ticket(token: str) -> dict[str, Any]:
    try:
        encoded_text, signature_text = token.split(".", 1)
        encoded = encoded_text.encode()
        signature = base64.urlsafe_b64decode(signature_text + "=" * (-len(signature_text) % 4))
        expected = hmac.new(ticket_secret, encoded, hashlib.sha256).digest()
        if not hmac.compare_digest(signature, expected):
            raise ValueError("Invalid signature")
        decoded = base64.urlsafe_b64decode(encoded_text + "=" * (-len(encoded_text) % 4))
        claims = json.loads(decoded)
        if int(utc_now().timestamp()) - int(claims["issued_at"]) > 60:
            raise TimeoutError("Ticket expired")
        return claims
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        raise ValueError("Invalid ticket") from exc


class SessionCreate(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    team_name: str = Field(min_length=2, max_length=120)
    track_name: str | None = Field(default=None, max_length=160)


class TicketRequest(BaseModel):
    display_name: str = Field(min_length=1, max_length=80)
    role: str = Field(pattern="^(viewer|publisher)$")
    force: bool = False


class Viewer:
    def __init__(self, websocket: WebSocket):
        self.websocket = websocket
        self.queue: asyncio.Queue[str | None] = asyncio.Queue(maxsize=2)
        self.writer = asyncio.create_task(self._write())

    async def _write(self) -> None:
        while True:
            payload = await self.queue.get()
            if payload is None:
                return
            await self.websocket.send_text(payload)

    def offer(self, payload: str) -> None:
        if self.queue.full():
            with suppress(asyncio.QueueEmpty):
                self.queue.get_nowait()
        with suppress(asyncio.QueueFull):
            self.queue.put_nowait(payload)

    async def close(self) -> None:
        with suppress(asyncio.QueueFull):
            self.queue.put_nowait(None)
        self.writer.cancel()
        with suppress(asyncio.CancelledError, Exception):
            await self.writer


class CloudRoom:
    def __init__(self, code: str):
        self.code = code
        self.viewers: dict[WebSocket, Viewer] = {}
        self.publisher: WebSocket | None = None
        self.publisher_name: str | None = None
        self.latest: str | None = None
        self.sequence = 0
        self.lock = asyncio.Lock()
        self.lap_number: int | None = None
        self.lap_driver: str | None = None
        self.lap_fuel_start: float | None = None
        self.lap_fuel_end: float | None = None
        self.lap_max_speed: float | None = None
        self.lap_samples = 0

    async def add_viewer(self, websocket: WebSocket) -> None:
        viewer = Viewer(websocket)
        self.viewers[websocket] = viewer
        if self.latest:
            viewer.offer(self.latest)
        await self.presence()

    async def remove_viewer(self, websocket: WebSocket) -> None:
        viewer = self.viewers.pop(websocket, None)
        if viewer:
            await viewer.close()
        await self.presence()

    async def claim(self, websocket: WebSocket, name: str, force: bool) -> None:
        async with self.lock:
            if self.publisher is not None and self.publisher is not websocket:
                if not force:
                    raise HTTPException(status_code=409, detail="Another driver is already publishing")
                with suppress(Exception):
                    await self.publisher.close(code=4002, reason="Publisher takeover")
            self.publisher = websocket
            self.publisher_name = name
            if self.lap_driver != name:
                self._reset_lap()
        await self.presence()

    async def release(self, websocket: WebSocket) -> None:
        async with self.lock:
            if self.publisher is websocket:
                self.publisher = None
                self.publisher_name = None
        await self.presence()

    async def publish(self, raw: str) -> None:
        self.sequence += 1
        parsed = json.loads(raw)
        outbound = json.dumps(
            {
                "protocol_version": 1,
                "sequence": self.sequence,
                "sent_at": utc_now().isoformat(),
                "kind": parsed.get("kind", "snapshot"),
                "source_name": self.publisher_name,
                "payload": parsed.get("payload", parsed),
            },
            separators=(",", ":"),
        )
        self.latest = outbound
        await self._track_lap(parsed)
        for viewer in list(self.viewers.values()):
            viewer.offer(outbound)

    def _reset_lap(self, lap_number: int | None = None) -> None:
        self.lap_number = lap_number
        self.lap_driver = self.publisher_name
        self.lap_fuel_start = None
        self.lap_fuel_end = None
        self.lap_max_speed = None
        self.lap_samples = 0

    async def _track_lap(self, parsed: dict[str, Any]) -> None:
        telemetry = (parsed.get("payload") or {}).get("telemetry") or {}
        player = telemetry.get("player") or {}
        lap_value = player.get("lap_number")
        if not isinstance(lap_value, int):
            return
        if self.lap_number is None:
            self._reset_lap(lap_value)
        elif lap_value != self.lap_number:
            completed_lap = self.lap_number
            completed_driver = self.lap_driver or self.publisher_name or "Driver"
            official_lap_time = player.get("last_lap_time")
            if self.lap_samples >= 2:
                await asyncio.to_thread(
                    persist_lap,
                    self.code,
                    completed_driver,
                    completed_lap,
                    float(official_lap_time) if isinstance(official_lap_time, (int, float)) and official_lap_time > 0 else None,
                    max(0.0, self.lap_fuel_start - self.lap_fuel_end) if self.lap_fuel_start is not None and self.lap_fuel_end is not None else None,
                    self.lap_max_speed,
                    self.lap_samples,
                )
            self._reset_lap(lap_value)
        fuel = player.get("fuel_liters")
        speed = player.get("speed_kph")
        if isinstance(fuel, (int, float)):
            if self.lap_fuel_start is None:
                self.lap_fuel_start = float(fuel)
            self.lap_fuel_end = float(fuel)
        if isinstance(speed, (int, float)):
            self.lap_max_speed = max(self.lap_max_speed or 0.0, float(speed))
        self.lap_samples += 1

    async def presence(self) -> None:
        payload = json.dumps(
            {
                "protocol_version": 1,
                "kind": "presence",
                "sent_at": utc_now().isoformat(),
                "payload": {
                    "active_driver": self.publisher_name,
                    "viewer_count": len(self.viewers),
                    "publishing": self.publisher is not None,
                },
            },
            separators=(",", ":"),
        )
        for viewer in list(self.viewers.values()):
            viewer.offer(payload)


rooms: dict[str, CloudRoom] = {}


def room_for(code: str) -> CloudRoom:
    return rooms.setdefault(code, CloudRoom(code))


def persist_lap(
    code: str,
    driver_name: str,
    lap_number: int,
    lap_time: float | None,
    fuel_used: float | None,
    max_speed: float | None,
    sample_count: int,
) -> None:
    with Session(engine) as db:
        team_session = db.scalar(select(TeamSession).where(TeamSession.code == code))
        if team_session is None:
            return
        existing = db.scalar(
            select(TeamLap).where(
                TeamLap.session_id == team_session.id,
                TeamLap.driver_name == driver_name,
                TeamLap.lap_number == lap_number,
            )
        )
        if existing:
            existing.lap_time = lap_time
            existing.fuel_used = fuel_used
            existing.max_speed = max_speed
            existing.sample_count = sample_count
        else:
            db.add(
                TeamLap(
                    session_id=team_session.id,
                    driver_name=driver_name,
                    lap_number=lap_number,
                    lap_time=lap_time,
                    fuel_used=fuel_used,
                    max_speed=max_speed,
                    sample_count=sample_count,
                )
            )
        db.commit()


def require_admin(x_team_admin_key: str | None) -> None:
    expected = os.getenv("TEAM_ADMIN_KEY", "")
    if not expected:
        if os.getenv("RAILWAY_ENVIRONMENT"):
            raise HTTPException(status_code=503, detail="TEAM_ADMIN_KEY is not configured")
        return
    if not x_team_admin_key or not secrets.compare_digest(expected, x_team_admin_key):
        raise HTTPException(status_code=401, detail="Invalid team administration key")


def make_code() -> str:
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    while True:
        code = "".join(secrets.choice(alphabet) for _ in range(8))
        with Session(engine) as db:
            if db.scalar(select(TeamSession).where(TeamSession.code == code)) is None:
                return code


def session_payload(row: TeamSession) -> dict[str, Any]:
    room = rooms.get(row.code)
    return {
        "code": row.code,
        "name": row.name,
        "team_name": row.team_name,
        "track_name": row.track_name,
        "status": row.status,
        "created_at": row.created_at,
        "ended_at": row.ended_at,
        "active_driver": room.publisher_name if room else None,
        "viewer_count": len(room.viewers) if room else 0,
    }


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(engine)
    yield
    for room in rooms.values():
        for viewer in list(room.viewers.values()):
            await viewer.close()


app = FastAPI(title="LMU Telemetry Cloud", version="0.2.0", lifespan=lifespan)
origins = [value.strip() for value in os.getenv("CORS_ORIGINS", "*").split(",") if value.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=origins != ["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/cloud/health")
def health() -> dict[str, Any]:
    return {"ok": True, "service": "lmu-telemetry-cloud", "rooms": len(rooms)}


@app.post("/api/cloud/sessions")
def create_team_session(body: SessionCreate, x_team_admin_key: str | None = Header(default=None)):
    require_admin(x_team_admin_key)
    with Session(engine) as db:
        row = TeamSession(
            code=make_code(),
            name=body.name.strip(),
            team_name=body.team_name.strip(),
            track_name=body.track_name.strip() if body.track_name else None,
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        return session_payload(row)


@app.get("/api/cloud/sessions/{code}")
def get_team_session(code: str):
    with Session(engine) as db:
        row = db.scalar(select(TeamSession).where(TeamSession.code == code.upper()))
        if row is None:
            raise HTTPException(status_code=404, detail="Team session not found")
        return session_payload(row)


@app.get("/api/cloud/sessions/{code}/laps")
def get_team_laps(code: str):
    with Session(engine) as db:
        row = db.scalar(select(TeamSession).where(TeamSession.code == code.upper()))
        if row is None:
            raise HTTPException(status_code=404, detail="Team session not found")
        laps = db.scalars(
            select(TeamLap)
            .where(TeamLap.session_id == row.id)
            .order_by(TeamLap.completed_at, TeamLap.id)
        ).all()
        return [
            {
                "driver_name": lap.driver_name,
                "lap_number": lap.lap_number,
                "lap_time": lap.lap_time,
                "fuel_used": lap.fuel_used,
                "max_speed": lap.max_speed,
                "sample_count": lap.sample_count,
                "completed_at": lap.completed_at,
            }
            for lap in laps
        ]


@app.post("/api/cloud/sessions/{code}/ticket")
def create_ticket(code: str, body: TicketRequest):
    normalized = code.upper()
    with Session(engine) as db:
        row = db.scalar(select(TeamSession).where(TeamSession.code == normalized))
        if row is None or row.status != "live":
            raise HTTPException(status_code=404, detail="Live team session not found")
    token = issue_ticket(
        {
            "code": normalized,
            "role": body.role,
            "display_name": body.display_name.strip(),
            "force": body.force,
            "nonce": secrets.token_urlsafe(8),
        }
    )
    return {"ticket": token, "expires_in": 60}


@app.post("/api/cloud/sessions/{code}/end")
def end_team_session(code: str, x_team_admin_key: str | None = Header(default=None)):
    require_admin(x_team_admin_key)
    with Session(engine) as db:
        row = db.scalar(select(TeamSession).where(TeamSession.code == code.upper()))
        if row is None:
            raise HTTPException(status_code=404, detail="Team session not found")
        row.status = "completed"
        row.ended_at = utc_now()
        db.commit()
        db.refresh(row)
        return session_payload(row)


@app.websocket("/ws/cloud/{code}")
async def cloud_socket(websocket: WebSocket, code: str, ticket: str):
    try:
        claims = load_ticket(ticket)
    except TimeoutError:
        await websocket.close(code=4001, reason="Ticket expired")
        return
    except ValueError:
        await websocket.close(code=4001, reason="Invalid ticket")
        return
    normalized = code.upper()
    if claims.get("code") != normalized:
        await websocket.close(code=4001, reason="Ticket/session mismatch")
        return
    role = claims.get("role")
    room = room_for(normalized)
    await websocket.accept()
    if role == "publisher":
        try:
            await room.claim(websocket, str(claims.get("display_name") or "Driver"), bool(claims.get("force")))
            while True:
                raw = await websocket.receive_text()
                if len(raw.encode("utf-8")) > 32_768:
                    await websocket.close(code=4009, reason="Frame too large")
                    return
                await room.publish(raw)
        except (WebSocketDisconnect, RuntimeError):
            pass
        finally:
            await room.release(websocket)
        return
    await room.add_viewer(websocket)
    try:
        while True:
            await websocket.receive_text()
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        await room.remove_viewer(websocket)


def mount_frontend() -> None:
    dist = Path(os.getenv("FRONTEND_DIST", "/app/frontend/dist"))
    index = dist / "index.html"
    if not index.exists():
        return
    assets = dist / "assets"
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
        return FileResponse(candidate if candidate.is_file() else index)


mount_frontend()
