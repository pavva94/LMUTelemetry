from __future__ import annotations

from datetime import datetime, timezone
from math import isfinite
from typing import Iterable


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def safe_float(value: object, default: float | None = None) -> float | None:
    try:
        number = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return default
    return number if isfinite(number) else default


def average(values: Iterable[float | None]) -> float | None:
    clean = [float(v) for v in values if v is not None and isfinite(float(v))]
    if not clean:
        return None
    return sum(clean) / len(clean)


def decode_c_string(value: bytes | bytearray | str | object) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, (bytes, bytearray)):
        return bytes(value).split(b"\x00", 1)[0].decode("utf-8", errors="ignore")
    return str(value or "")
