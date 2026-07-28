from __future__ import annotations

from pathlib import Path

import desktop_launcher


def test_configure_pythonnet_runtime_uses_packaged_config(monkeypatch, tmp_path: Path) -> None:
    runtime_config = tmp_path / "pythonnet.runtime.config"
    runtime_config.write_text("<configuration />", encoding="utf-8")

    monkeypatch.setattr(desktop_launcher.sys, "platform", "win32")
    monkeypatch.setattr(desktop_launcher.sys, "frozen", True, raising=False)
    monkeypatch.setattr(desktop_launcher.sys, "_MEIPASS", str(tmp_path), raising=False)
    monkeypatch.delenv("PYTHONNET_RUNTIME", raising=False)
    monkeypatch.delenv("PYTHONNET_NETFX_CONFIG_FILE", raising=False)

    desktop_launcher._configure_pythonnet_runtime()

    assert desktop_launcher.os.environ["PYTHONNET_RUNTIME"] == "netfx"
    assert desktop_launcher.os.environ["PYTHONNET_NETFX_CONFIG_FILE"] == str(runtime_config)


def test_configure_pythonnet_runtime_preserves_explicit_settings(monkeypatch, tmp_path: Path) -> None:
    (tmp_path / "pythonnet.runtime.config").write_text("<configuration />", encoding="utf-8")

    monkeypatch.setattr(desktop_launcher.sys, "platform", "win32")
    monkeypatch.setattr(desktop_launcher.sys, "frozen", True, raising=False)
    monkeypatch.setattr(desktop_launcher.sys, "_MEIPASS", str(tmp_path), raising=False)
    monkeypatch.setenv("PYTHONNET_RUNTIME", "coreclr")
    monkeypatch.setenv("PYTHONNET_NETFX_CONFIG_FILE", "custom.config")

    desktop_launcher._configure_pythonnet_runtime()

    assert desktop_launcher.os.environ["PYTHONNET_RUNTIME"] == "coreclr"
    assert desktop_launcher.os.environ["PYTHONNET_NETFX_CONFIG_FILE"] == "custom.config"


def test_unblock_bundled_desktop_runtime_targets_only_managed_ui_dlls(
    monkeypatch, tmp_path: Path
) -> None:
    python_runtime = tmp_path / "pythonnet" / "runtime" / "Python.Runtime.dll"
    webview_runtime = tmp_path / "webview" / "lib" / "Microsoft.Web.WebView2.Core.dll"
    unrelated = tmp_path / "other" / "unrelated.dll"
    for path in (python_runtime, webview_runtime, unrelated):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"")

    removed: list[str] = []
    monkeypatch.setattr(desktop_launcher.sys, "platform", "win32")
    monkeypatch.setattr(desktop_launcher.sys, "frozen", True, raising=False)
    monkeypatch.setattr(desktop_launcher.sys, "_MEIPASS", str(tmp_path), raising=False)
    monkeypatch.setattr(desktop_launcher.os, "remove", removed.append)

    desktop_launcher._unblock_bundled_desktop_runtime()

    assert sorted(removed) == sorted(
        [
            f"{python_runtime}:Zone.Identifier",
            f"{webview_runtime}:Zone.Identifier",
        ]
    )
