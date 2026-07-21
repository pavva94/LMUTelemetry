# -*- mode: python ; coding: utf-8 -*-

from pathlib import Path

from PyInstaller.utils.hooks import collect_submodules


ROOT = Path(SPECPATH).parent
BACKEND = ROOT / "backend"
ICON = ROOT / "packaging" / "assets" / "app-icon.ico"
VERSION_INFO = ROOT / "build" / "windows-version-info.txt"


def collect_tree(source, destination, excluded_parts):
    source = Path(source)
    rows = []
    for path in source.rglob("*"):
        if not path.is_file():
            continue
        relative = path.relative_to(source)
        if any(part in excluded_parts for part in relative.parts):
            continue
        if path.suffix == ".pyc":
            continue
        rows.append((str(path), str(Path(destination) / relative.parent)))
    return rows


datas = [
    (str(ROOT / "frontend" / "dist"), "frontend/dist"),
    (str(ROOT / "config" / "default_strategy.yaml"), "config"),
    (str(ROOT / "packaging" / "assets" / "pythonnet.runtime.config"), "."),
] + collect_tree(BACKEND / "pyLMUSharedMemory", "pyLMUSharedMemory", {".git", "tests", "__pycache__"})

hiddenimports = [
    "app.main",
    "pyLMUSharedMemory",
    "pyLMUSharedMemory.lmu_data",
    "pyLMUSharedMemory.lmu_mmap",
    *collect_submodules("numpy._core"),
    *collect_submodules("webview"),
]

a = Analysis(
    [str(BACKEND / "desktop_launcher.py")],
    pathex=[str(BACKEND)],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="LMUTelemetry",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=str(ICON),
    version=str(VERSION_INFO),
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name="LMUTelemetry",
)
