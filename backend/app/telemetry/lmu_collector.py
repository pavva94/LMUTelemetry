from __future__ import annotations

import logging
import time

from app.core.utils import utc_now
from app.schemas.telemetry import TelemetrySnapshot
from app.telemetry.normalizer import normalize_lmu_snapshot

logger = logging.getLogger(__name__)


class LMUTelemetryCollector:
    def __init__(self, poll_hz: int = 10):
        self.poll_hz = poll_hz
        self.latest: TelemetrySnapshot | None = None
        self.running = False
        self._mmap = None
        self._last_connect_attempt = 0.0
        self._connected = False

    def start(self) -> None:
        self.running = True
        self._connect()

    def stop(self) -> None:
        self.running = False
        try:
            if self._mmap and hasattr(self._mmap, "close"):
                self._mmap.close()
        finally:
            self._mmap = None
            self._connected = False

    def is_connected(self) -> bool:
        return self._connected

    def get_latest_snapshot(self) -> TelemetrySnapshot | None:
        return self.latest

    def poll_once(self) -> TelemetrySnapshot | None:
        if not self._mmap:
            self._connect()
        if not self._mmap:
            self.latest = TelemetrySnapshot(
                timestamp=utc_now(),
                connected=False,
                message="Le Mans Ultimate shared memory not available",
            )
            return self.latest
        try:
            raw = self._read_copy()
            self.latest = normalize_lmu_snapshot(raw)
            self._connected = self.latest.connected
            return self.latest
        except Exception as exc:
            logger.warning("LMU shared memory poll failed: %s", exc)
            self._connected = False
            self._mmap = None
            self.latest = TelemetrySnapshot(
                timestamp=utc_now(),
                connected=False,
                message="Le Mans Ultimate shared memory not available",
            )
            return self.latest

    def _connect(self) -> None:
        now = time.monotonic()
        if now - self._last_connect_attempt < 2.0:
            return
        self._last_connect_attempt = now
        try:
            from pyLMUSharedMemory.lmu_data import LMUConstants
            from pyLMUSharedMemory.lmu_mmap import MMapControl

            try:
                self._mmap = MMapControl(LMUConstants.LMU_SHARED_MEMORY_FILE, copy_access=True)
            except TypeError:
                self._mmap = MMapControl(LMUConstants.LMU_SHARED_MEMORY_FILE)
            if hasattr(self._mmap, "start"):
                self._mmap.start()
            self._connected = True
        except Exception as exc:
            logger.info("LMU shared memory unavailable: %s", exc)
            self._mmap = None
            self._connected = False

    def _read_copy(self):
        if hasattr(self._mmap, "read"):
            return self._mmap.read()
        if hasattr(self._mmap, "get_data"):
            return self._mmap.get_data()
        if hasattr(self._mmap, "mMap"):
            return self._mmap.mMap
        return self._mmap
