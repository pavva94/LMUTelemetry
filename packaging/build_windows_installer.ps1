param(
    [switch]$SkipDependencyInstall,
    [switch]$SkipInstaller
)

$ErrorActionPreference = "Stop"
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$VenvPython = Join-Path $RepoRoot "backend\.venv\Scripts\python.exe"
$Python = if (Test-Path $VenvPython) { $VenvPython } else { "python" }

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

    Invoke-Step "Build Windows app bundle" {
        & $Python -m PyInstaller --clean --noconfirm "packaging\lmu_telemetry.spec"
        Assert-NativeSuccess "PyInstaller"
    }

    if (-not $SkipInstaller) {
        Invoke-Step "Build installer" {
            $iscc = Find-InnoSetup
            if (-not $iscc) {
                throw "Inno Setup 6 was not found. Install it from https://jrsoftware.org/isinfo.php or rerun with -SkipInstaller."
            }
            & $iscc "packaging\installer.iss"
            Assert-NativeSuccess "Inno Setup"
        }
    }

    Write-Host ""
    Write-Host "Release artifacts are in:" -ForegroundColor Green
    Write-Host "  $RepoRoot\dist\LMUTelemetry"
    if (-not $SkipInstaller) {
        Write-Host "  $RepoRoot\release"
    }
}
finally {
    Pop-Location
}
