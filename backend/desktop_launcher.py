from __future__ import annotations

import argparse
import ctypes
import json
import os
import socket
import sys
import threading
import time
import traceback
from pathlib import Path
from urllib.error import URLError
from urllib.request import urlopen

import uvicorn

from app.core.paths import app_data_dir, config_path, frontend_dist_dir, log_dir


APP_NAME = "LMU Telemetry"


def _message_box(title: str, message: str) -> None:
    try:
        ctypes.windll.user32.MessageBoxW(None, message, title, 0x10)
    except Exception:
        print(f"{title}: {message}", file=sys.stderr)


def _write_launcher_error(exc: BaseException) -> None:
    try:
        logs = log_dir()
        logs.mkdir(parents=True, exist_ok=True)
        with (logs / "launcher-error.log").open("a", encoding="utf-8") as handle:
            handle.write(f"\n{time.strftime('%Y-%m-%d %H:%M:%S')} {APP_NAME} startup failure\n")
            handle.write("".join(traceback.format_exception(exc)))
    except Exception:
        pass


def _find_port(preferred: int | None = None) -> int:
    if preferred is not None:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.bind(("127.0.0.1", preferred))
        return preferred

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def _wait_for_backend(url: str, timeout_seconds: float = 20.0) -> None:
    deadline = time.monotonic() + timeout_seconds
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        try:
            with urlopen(f"{url}/api/health", timeout=1.0) as response:
                if response.status < 500:
                    return
        except (OSError, URLError) as exc:
            last_error = exc
        time.sleep(0.25)
    raise RuntimeError(f"Backend did not become ready at {url}. Last error: {last_error}")


def _prepare_environment(use_mock: bool) -> None:
    os.environ.setdefault("USE_MOCK_TELEMETRY", "true" if use_mock else "false")
    data_dir = app_data_dir()
    logs = log_dir()
    for path in (data_dir / "sessions", data_dir / "motec", logs):
        path.mkdir(parents=True, exist_ok=True)


def _run_server(port: int) -> tuple[uvicorn.Server, threading.Thread]:
    config = uvicorn.Config(
        "app.main:app",
        host="127.0.0.1",
        port=port,
        log_level="info",
        log_config=None,
        reload=False,
        access_log=False,
    )
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, name="lmu-telemetry-backend", daemon=True)
    thread.start()
    return server, thread


def _stop_server(server: uvicorn.Server, thread: threading.Thread) -> None:
    server.should_exit = True
    thread.join(timeout=10.0)
    if thread.is_alive():
        server.force_exit = True
        thread.join(timeout=5.0)
    if thread.is_alive():
        raise RuntimeError("The packaged backend did not shut down cleanly.")


def _run_packaged_smoke_test(base_url: str) -> None:
    from pyLMUSharedMemory import lmu_data

    import duckdb

    required_resources = (
        config_path(),
        frontend_dist_dir() / "index.html",
    )
    missing = [str(path) for path in required_resources if not path.is_file()]
    if missing:
        raise RuntimeError(f"Packaged resources are missing: {', '.join(missing)}")
    if not hasattr(lmu_data, "LMUConstants") or not hasattr(duckdb, "connect"):
        raise RuntimeError("Packaged telemetry dependencies could not be loaded.")

    with urlopen(f"{base_url}/api/health", timeout=5.0) as response:
        health = json.load(response)
    if not health.get("ok") or not health.get("mock"):
        raise RuntimeError(f"Packaged health check returned unexpected data: {health}")

    with urlopen(f"{base_url}/", timeout=5.0) as response:
        index = response.read(512).lower()
    if response.status != 200 or b"<!doctype html" not in index:
        raise RuntimeError("Packaged frontend did not return its index page.")


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=f"Launch {APP_NAME}.")
    parser.add_argument("--mock", action="store_true", help="Use built-in demo telemetry instead of LMU shared memory.")
    parser.add_argument("--port", type=int, default=None, help="Bind the local backend to this port.")
    parser.add_argument("--smoke-test", action="store_true", help=argparse.SUPPRESS)
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    try:
        if args.smoke_test:
            os.environ["LMU_TELEMETRY_SKIP_DUCKDB_SYNC"] = "true"
        _prepare_environment(use_mock=args.mock or args.smoke_test)
        port = _find_port(args.port)
        base_url = f"http://127.0.0.1:{port}"
        server, server_thread = _run_server(port)
        _wait_for_backend(base_url)
        if args.smoke_test:
            _run_packaged_smoke_test(base_url)
            _stop_server(server, server_thread)
            return 0
    except Exception as exc:
        if "server" in locals() and "server_thread" in locals():
            _stop_server(server, server_thread)
        _write_launcher_error(exc)
        _message_box(APP_NAME, f"{APP_NAME} could not start.\n\n{exc}")
        return 1

    try:
        import webview
    except Exception as exc:
        _stop_server(server, server_thread)
        _write_launcher_error(exc)
        _message_box(APP_NAME, f"{APP_NAME} could not open its desktop window.\n\nMissing WebView runtime or pywebview dependency:\n{exc}")
        return 1

    window = webview.create_window(APP_NAME, base_url, width=1440, height=920, min_size=(1120, 720))

    def _on_closed() -> None:
        server.should_exit = True

    window.events.closed += _on_closed
    try:
        webview.start(private_mode=False)
    finally:
        _stop_server(server, server_thread)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
