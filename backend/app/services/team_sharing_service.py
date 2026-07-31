from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import asdict, dataclass
from urllib.parse import urlparse

import httpx
import websockets
from fastapi.encoders import jsonable_encoder


logger = logging.getLogger(__name__)


@dataclass
class TeamSharingStatus:
    configured: bool = False
    publishing: bool = False
    connected: bool = False
    cloud_url: str | None = None
    session_code: str | None = None
    display_name: str | None = None
    sent_frames: int = 0
    last_error: str | None = None


class TeamSharingService:
    """Background cloud publisher independent from the visible frontend page."""

    def __init__(self, telemetry_service):
        self.telemetry_service = telemetry_service
        self.status = TeamSharingStatus()
        self._access_key: str | None = None
        self._task: asyncio.Task | None = None
        self._stop = asyncio.Event()

    @staticmethod
    def normalize_cloud_url(value: str) -> str:
        normalized = value.strip().rstrip("/")
        parsed = urlparse(normalized)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise ValueError("Cloud URL must be an http:// or https:// URL")
        if parsed.scheme == "http" and parsed.hostname not in {"127.0.0.1", "localhost"}:
            raise ValueError("Remote cloud connections must use HTTPS")
        return normalized

    def configure(self, cloud_url: str, session_code: str, access_key: str, display_name: str) -> dict:
        if self.status.publishing:
            raise RuntimeError("Stop publishing before changing the team session")
        self.status.cloud_url = self.normalize_cloud_url(cloud_url)
        self.status.session_code = session_code.strip().upper()
        self._access_key = access_key.strip()
        self.status.display_name = display_name.strip()
        if len(self.status.session_code) != 8:
            raise ValueError("Session code must contain eight characters")
        if len(self._access_key) < 20:
            raise ValueError("A valid session access key is required")
        if not self.status.display_name:
            raise ValueError("Display name is required")
        self.status.configured = True
        self.status.last_error = None
        return self.as_dict()

    async def start(self, force: bool = False) -> dict:
        if not self.status.configured:
            raise RuntimeError("Configure a team session first")
        if self._task and not self._task.done():
            return self.as_dict()
        self.status.publishing = True
        self.status.last_error = None
        self._stop = asyncio.Event()
        self._task = asyncio.create_task(self._run(force), name="team-telemetry-publisher")
        return self.as_dict()

    async def stop(self) -> dict:
        self.status.publishing = False
        self.status.connected = False
        self._stop.set()
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        return self.as_dict()

    async def shutdown(self) -> None:
        await self.stop()

    def as_dict(self) -> dict:
        return asdict(self.status)

    async def _ticket(self, force: bool) -> str:
        assert self.status.cloud_url and self.status.session_code and self._access_key and self.status.display_name
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.post(
                f"{self.status.cloud_url}/api/cloud/sessions/{self.status.session_code}/ticket",
                json={
                    "display_name": self.status.display_name,
                    "role": "publisher",
                    "access_key": self._access_key,
                    "force": force,
                },
            )
            response.raise_for_status()
            return str(response.json()["ticket"])

    def _websocket_url(self) -> str:
        assert self.status.cloud_url and self.status.session_code
        parsed = urlparse(self.status.cloud_url)
        scheme = "wss" if parsed.scheme == "https" else "ws"
        return f"{scheme}://{parsed.netloc}/ws/cloud/{self.status.session_code}"

    def _frame(self) -> str | None:
        snapshot = self.telemetry_service.latest_snapshot
        if snapshot is None:
            return None
        return json.dumps(
            {
                "kind": "snapshot",
                "payload": {
                    "telemetry": jsonable_encoder(snapshot, exclude_none=True),
                    "strategy": jsonable_encoder(self.telemetry_service.strategy_state, exclude_none=True),
                    "recommendation": jsonable_encoder(self.telemetry_service.recommendation_payload, exclude_none=True),
                },
            },
            separators=(",", ":"),
        )

    async def _run(self, force: bool) -> None:
        delay = 0.5
        while self.status.publishing and not self._stop.is_set():
            try:
                ticket = await self._ticket(force)
                async with websockets.connect(
                    self._websocket_url(),
                    subprotocols=["lmu.telemetry.v1", f"lmu-ticket.{ticket}"],
                    open_timeout=10,
                    ping_interval=5,
                    ping_timeout=15,
                    max_size=65_536,
                    compression="deflate",
                ) as socket:
                    self.status.connected = True
                    self.status.last_error = None
                    delay = 0.5
                    force = False
                    while self.status.publishing and not self._stop.is_set():
                        frame = self._frame()
                        if frame:
                            await socket.send(frame)
                            self.status.sent_frames += 1
                        await asyncio.sleep(0.2)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                self.status.connected = False
                self.status.last_error = str(exc)[:240]
                logger.warning("Team telemetry publisher disconnected: %s", exc)
                try:
                    await asyncio.wait_for(self._stop.wait(), timeout=delay)
                except asyncio.TimeoutError:
                    pass
                delay = min(10.0, delay * 2)
        self.status.connected = False

