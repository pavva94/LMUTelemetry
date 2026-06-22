param(
    [switch]$SkipDependencyInstall,
    [switch]$SkipFrontendBuild,
    [switch]$SkipSmokeTest,
    [switch]$SkipInstaller,
    [ValidatePattern('^\d+\.\d+\.\d+([-.][0-9A-Za-z.-]+)?$')]
    [string]$AppVersion = "0.1.0"
)

$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $true
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$VenvPython = Join-Path $RepoRoot "backend\.venv\Scripts\python.exe"
$Python = if (Test-Path $VenvPython) { $VenvPython } else { "python" }
$FrontendIndex = Join-Path $RepoRoot "frontend\dist\index.html"
$AppExe = Join-Path $RepoRoot "dist\LMUTelemetry\LMUTelemetry.exe"

function Invoke-Step {
    param(
        [string]$Name,
        [scriptblock]$Command
    )
    Write-Host ""
    Write-Host "==> $Name" -ForegroundColor Cyan
    & $Command
}

function Assert-NativeSuccess {
    param([string]$Name)
    if ($LASTEXITCODE -ne 0) {
        throw "$Name failed with exit code $LASTEXITCODE."
    }
}

function Assert-FileExists {
    param(
        [string]$Path,
        [string]$Description
    )
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "$Description was not found at $Path."
    }
}

function Assert-PackagedAppNotRunning {
    $running = Get-Process -Name "LMUTelemetry" -ErrorAction SilentlyContinue | Where-Object {
        try { $_.Path -eq $AppExe } catch { $false }
    }
    if ($running) {
        $ids = ($running.Id -join ", ")
        throw "Close the previously built LMU Telemetry app before rebuilding (process ID: $ids)."
    }
}

function Find-InnoSetup {
    $candidates = @(
        "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
        "${env:ProgramFiles}\Inno Setup 6\ISCC.exe"
    )
    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path $candidate)) {
            return $candidate
        }
    }
    $command = Get-Command "ISCC.exe" -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Source
    }
    return $null
}

Push-Location $RepoRoot
try {
    Assert-FileExists (Join-Path $RepoRoot "backend\desktop_launcher.py") "Desktop launcher"
    Assert-FileExists (Join-Path $RepoRoot "backend\pyLMUSharedMemory\__init__.py") "Bundled pyLMUSharedMemory package"
    Assert-FileExists (Join-Path $RepoRoot "config\default_strategy.yaml") "Default strategy configuration"

    if (-not $SkipDependencyInstall) {
        Invoke-Step "Install frontend dependencies" {
            Push-Location "frontend"
            try {
                npm.cmd ci
                Assert-NativeSuccess "npm ci"
            }
            finally {
                Pop-Location
            }
        }

        Invoke-Step "Install backend packaging dependencies" {
            & $Python -m pip install -r "backend\requirements.txt"
            Assert-NativeSuccess "pip install"
        }
    }

    if (-not $SkipFrontendBuild) {
        Invoke-Step "Build frontend" {
            Push-Location "frontend"
            try {
                npm.cmd run build
                Assert-NativeSuccess "npm run build"
            }
            finally {
                Pop-Location
            }
        }
    }
    Assert-FileExists $FrontendIndex "Compiled frontend entry point"
    Assert-PackagedAppNotRunning

    Invoke-Step "Build Windows app bundle" {
        & $Python -m PyInstaller --clean --noconfirm "packaging\lmu_telemetry.spec"
        Assert-NativeSuccess "PyInstaller"
    }
    Assert-FileExists $AppExe "Packaged application executable"

    if (-not $SkipSmokeTest) {
        Invoke-Step "Smoke test packaged application" {
            $SmokeData = Join-Path $RepoRoot "build\smoke-test-data"
            $PreviousDataDir = $env:LMU_TELEMETRY_DATA_DIR
            $PreviousLogDir = $env:LMU_TELEMETRY_LOG_DIR
            try {
                $env:LMU_TELEMETRY_DATA_DIR = $SmokeData
                $env:LMU_TELEMETRY_LOG_DIR = Join-Path $SmokeData "logs"
                & $AppExe --smoke-test
                Assert-NativeSuccess "Packaged application smoke test"
            }
            finally {
                $env:LMU_TELEMETRY_DATA_DIR = $PreviousDataDir
                $env:LMU_TELEMETRY_LOG_DIR = $PreviousLogDir
            }
        }
    }

    if (-not $SkipInstaller) {
        Invoke-Step "Build installer" {
            $iscc = Find-InnoSetup
            if (-not $iscc) {
                throw "Inno Setup 6 was not found. Install it from https://jrsoftware.org/isinfo.php or rerun with -SkipInstaller."
            }
            & $iscc "/DMyAppVersion=$AppVersion" "packaging\installer.iss"
            Assert-NativeSuccess "Inno Setup"
        }
    }

    Write-Host ""
    Write-Host "Release artifacts are in:" -ForegroundColor Green
    Write-Host "  $AppExe"
    if (-not $SkipInstaller) {
        Write-Host "  $RepoRoot\release\LMUTelemetry-Setup-$AppVersion.exe"
    }
}
finally {
    Pop-Location
}
