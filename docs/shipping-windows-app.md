
# Shipping Plan: Windows Desktop App

## Goal

Ship LMU Telemetry as a Windows desktop application that:

- starts the telemetry backend when the app starts
- keeps collecting telemetry while the UI window is closed or hidden
- lets the user reopen the UI later and review the current or latest saved session
- stores user data outside the installed app directory
- can be downloaded from a website as a normal installer

## Recommended Shape

Use a small desktop shell around the existing local-first app:

1. Package the Python backend with PyInstaller.
2. Build the React frontend with Vite.
3. Serve the built frontend from the FastAPI backend.
4. Wrap the backend in a Windows tray/window app.
5. Ship an installer with auto-update support.

The app should behave like this:

- Launch app.
- Backend starts in the background.
- Tray icon appears.
- UI opens in a desktop window or browser at the local backend URL.
- If the user closes the UI window, the backend keeps running.
- If the user exits from the tray menu, the backend finalizes/stops cleanly.

## Why This Fits The Current App

The backend already starts telemetry collection inside the FastAPI lifespan. Logging happens in `TelemetryService._loop()` and `SessionLogger.log()`, not because a frontend page is open. That means packaging can preserve the current behavior as long as the backend process stays alive.

The frontend already calls same-origin API paths such as `/api/health` and `/ws/telemetry`. In production, the cleanest setup is to make FastAPI serve the built frontend so both UI and API live on the same local origin.

## Desktop Shell Options

### Option A: Electron

Best short-term choice.

Pros:

- mature Windows packaging and installer ecosystem
- easy tray icon, background process, window lifecycle
- can spawn the packaged Python backend
- easy auto-update with GitHub Releases or a website feed

Cons:

- larger download size
- ships Chromium

### Option B: Tauri

Best long-term lightweight choice.

Pros:

- smaller app
- native WebView
- tray/background behavior is supported

Cons:

- Rust toolchain and packaging complexity
- spawning/managing a Python backend is a little more work

### Option C: Python-Only Tray App

Possible, but less ideal.

Pros:

- one language for backend and launcher

Cons:

- weaker installer/update story
- less polished desktop UI lifecycle

Recommendation: start with Electron for the first public Windows build, then revisit Tauri only if app size becomes a real problem.

## Required Code Changes

### 1. Production Static Frontend Serving

Add FastAPI static serving for the Vite `dist` folder:

- `/api/*` remains backend API
- `/ws/*` remains websocket API
- `/assets/*` serves built frontend assets
- all other routes return `index.html`

This lets the packaged app run from one local URL, for example:

```text
http://127.0.0.1:8000/
```

### 2. Runtime Data Directory

Move shipped/user data out of the repo-relative `data` folder.

Use a Windows app data path such as:

```text
%LOCALAPPDATA%\LMUTelemetry\data\sessions\lmu_strategy.sqlite3
%LOCALAPPDATA%\LMUTelemetry\data\motec\
```

Keep an environment override for development:

```text
LMU_TELEMETRY_DATA_DIR=C:\path\to\data
```

This matters because `Program Files` is not a safe place to write SQLite databases or imports.

### 3. Production Mock Default

For public builds, real telemetry should be the default:

```text
USE_MOCK_TELEMETRY=false
```

Mock mode can stay available through a settings toggle, debug flag, or development config.

### 4. Backend Port Management

The app should try a default local port, then fall back if it is already used.

Suggested default:

```text
127.0.0.1:8947
```

The desktop shell should:

- choose a port
- start the backend with that port
- wait for `/api/health`
- open the UI at the chosen local URL

### 5. Clean Shutdown And Session Finalization

The backend already finalizes the active session when `TelemetryService.stop()` runs. The launcher should send a clean shutdown signal rather than killing the process.

Add a local-only shutdown endpoint or use process signaling from the desktop shell. A local-only endpoint is easier:

```text
POST /api/app/shutdown
```

Only allow it from `127.0.0.1`.

### 6. Frontend Window Lifecycle

The desktop app should not equate closing the window with exiting the app.

Expected behavior:

- close window: hide window, backend continues
- tray click: reopen window
- tray menu Exit: stop backend and quit

### 7. Packaging `pyLMUSharedMemory`

The current repo includes `backend/pyLMUSharedMemory`, which is good for packaging. The PyInstaller spec must include it so the real LMU collector works without users installing Python or cloning anything.

## Build Pipeline

### Local Build Steps

1. Build frontend:

```cmd
cd frontend
npm run build
```

2. Package backend:

```cmd
cd backend
pyinstaller packaging\lmu_backend.spec
```

3. Package desktop shell:

```cmd
cd desktop
npm run dist
```

Output should be a Windows installer, for example:

```text
LMUTelemetry-Setup-0.1.0.exe
```

### Proposed Repo Additions

```text
desktop/
  package.json
  electron/
    main.ts
    preload.ts
    tray.ts
backend/
  packaging/
    lmu_backend.spec
scripts/
  build-windows.ps1
```

## Installer And Website

For the website download flow:

1. Build a signed Windows installer.
2. Upload it to GitHub Releases, S3/R2, or another download host.
3. Website has a clear Download for Windows button.
4. Website also links release notes and basic setup instructions.

Minimum website sections:

- product name and screenshot/video
- Windows download button
- requirements: Windows, Le Mans Ultimate, shared memory enabled
- quick start: install, launch app, start LMU, drive, review session
- troubleshooting: firewall, antivirus false positives, no telemetry detected

## Versioning And Updates

Use semantic versions:

```text
0.1.0
0.1.1
0.2.0
```

For early users, a manual update flow is enough:

- app checks latest version metadata
- shows "Update available"
- user downloads the new installer

Later, Electron auto-updater can install updates automatically from GitHub Releases or a provider feed.

## Signing

For a public Windows app, plan for code signing before wide distribution. Unsigned installers are more likely to trigger SmartScreen and antivirus warnings.

Early private testing can use unsigned builds, but the public website should eventually distribute signed installers.

## First Milestone

Build a local packaged prototype:

- FastAPI serves the production frontend
- data writes to `%LOCALAPPDATA%`
- backend packaged with PyInstaller
- Electron launches backend and opens UI
- closing the UI keeps logging active
- tray Exit stops the backend cleanly

## Second Milestone

Make it installer-ready:

- installer creates Start Menu shortcut
- app has icon/name/version
- local logs are written to app data
- basic update metadata exists
- one-command Windows build script

## Third Milestone

Make it website-ready:

- release artifacts are generated consistently
- download page exists
- quick-start docs exist
- troubleshooting docs exist
- signed installer path is decided

## Open Questions

- Should closing the main window hide to tray by default, or ask the first time?
- Should the UI open in an app window, the user's browser, or support both?
- Should the app start automatically with Windows?
- Should session logging start only when LMU is detected, or immediately when the app launches?
- Do we want one public installer, or separate beta/stable channels?
