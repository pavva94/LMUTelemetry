param(
    [switch]$SkipDependencyInstall,
    [switch]$SkipFrontendTests,
    [switch]$SkipFrontendBuild,
    [switch]$SkipSmokeTest,
    [ValidatePattern('^\d+\.\d+\.\d+([-.][0-9A-Za-z.-]+)?$')]
    [string]$AppVersion = "0.1.0"
)

$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $true
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$VenvPython = Join-Path $RepoRoot "backend\.venv\Scripts\python.exe"
$Python = if (Test-Path $VenvPython) { $VenvPython } else { "python" }
$DistRoot = Join-Path $RepoRoot "dist"
$FrontendIndex = Join-Path $RepoRoot "frontend\dist\index.html"
$AppBundle = Join-Path $DistRoot "LMUTelemetry"
$AppExe = Join-Path $AppBundle "LMUTelemetry.exe"
$InstallerExe = Join-Path $DistRoot "LMUTelemetry-Setup-$AppVersion.exe"
$PortableZip = Join-Path $DistRoot "LMUTelemetry-Windows-Portable-$AppVersion.zip"
$ChecksumFile = Join-Path $DistRoot "SHA256SUMS-$AppVersion.txt"
$VersionInfoFile = Join-Path $RepoRoot "build\windows-version-info.txt"
$PackagedFrontendIndex = Join-Path $AppBundle "_internal\frontend\dist\index.html"
$PackagedConfig = Join-Path $AppBundle "_internal\config\default_strategy.yaml"
$PackagedTelemetryModule = Join-Path $AppBundle "_internal\pyLMUSharedMemory\lmu_data.py"

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

function New-PortableArchive {
    if (Test-Path -LiteralPath $PortableZip) {
        Remove-Item -LiteralPath $PortableZip -Force
    }
    Compress-Archive -LiteralPath $AppBundle -DestinationPath $PortableZip -CompressionLevel Optimal -Force
}

function Get-WindowsFileVersion {
    $coreVersion = ($AppVersion -split '[-+]')[0]
    $parts = @($coreVersion.Split('.') | ForEach-Object { [int]$_ })
    while ($parts.Count -lt 4) {
        $parts += 0
    }
    return ($parts[0..3] -join '.')
}

function Write-PyInstallerVersionInfo {
    $fileVersion = Get-WindowsFileVersion
    $fileVersionTuple = $fileVersion.Replace('.', ', ')
    $content = @"
VSVersionInfo(
  ffi=FixedFileInfo(
    filevers=($fileVersionTuple),
    prodvers=($fileVersionTuple),
    mask=0x3f,
    flags=0x0,
    OS=0x40004,
    fileType=0x1,
    subtype=0x0,
    date=(0, 0)
  ),
  kids=[
    StringFileInfo([
      StringTable('040904B0', [
        StringStruct('CompanyName', 'LMU Telemetry'),
        StringStruct('FileDescription', 'LMU Telemetry'),
        StringStruct('FileVersion', '$AppVersion'),
        StringStruct('InternalName', 'LMUTelemetry'),
        StringStruct('OriginalFilename', 'LMUTelemetry.exe'),
        StringStruct('ProductName', 'LMU Telemetry'),
        StringStruct('ProductVersion', '$AppVersion')
      ])
    ]),
    VarFileInfo([VarStruct('Translation', [1033, 1200])])
  ]
)
"@
    $versionInfoDirectory = Split-Path -Parent $VersionInfoFile
    New-Item -ItemType Directory -Path $versionInfoDirectory -Force | Out-Null
    Set-Content -LiteralPath $VersionInfoFile -Value $content -Encoding ascii
}

function Write-ArtifactChecksums {
    $rows = @($InstallerExe, $PortableZip) | ForEach-Object {
        $hash = Get-FileHash -LiteralPath $_ -Algorithm SHA256
        "$($hash.Hash.ToLowerInvariant())  $(Split-Path -Leaf $_)"
    }
    $rows | Set-Content -LiteralPath $ChecksumFile -Encoding ascii
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
        if (-not $SkipFrontendTests) {
            Invoke-Step "Test frontend" {
                Push-Location "frontend"
                try {
                    npm.cmd run test:run
                    Assert-NativeSuccess "npm run test:run"
                }
                finally {
                    Pop-Location
                }
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
    }
    Assert-FileExists $FrontendIndex "Compiled frontend entry point"
    Assert-PackagedAppNotRunning

    Invoke-Step "Write Windows version metadata" {
        Write-PyInstallerVersionInfo
    }

    Invoke-Step "Build Windows app bundle" {
        & $Python -m PyInstaller --clean --noconfirm "packaging\lmu_telemetry.spec"
        Assert-NativeSuccess "PyInstaller"
    }
    Assert-FileExists $AppExe "Packaged application executable"
    Assert-FileExists $PackagedFrontendIndex "Packaged frontend entry point"
    Assert-FileExists $PackagedConfig "Packaged default strategy configuration"
    Assert-FileExists $PackagedTelemetryModule "Packaged LMU shared-memory telemetry module"

    if (-not $SkipSmokeTest) {
        Invoke-Step "Smoke test packaged application" {
            $SmokeRoot = Join-Path $RepoRoot "build"
            $SmokeData = Join-Path $SmokeRoot ("smoke-test-{0}" -f [Guid]::NewGuid().ToString("N"))
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
                if ($SmokeData.StartsWith($SmokeRoot, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $SmokeData)) {
                    Remove-Item -LiteralPath $SmokeData -Recurse -Force
                }
            }
        }
    }

    Invoke-Step "Build installer" {
        $iscc = Find-InnoSetup
        if (-not $iscc) {
            throw "Inno Setup 6 was not found. Install it from https://jrsoftware.org/isinfo.php."
        }
        $fileVersion = Get-WindowsFileVersion
        & $iscc "/DMyAppVersion=$AppVersion" "/DMyAppFileVersion=$fileVersion" "packaging\installer.iss"
        Assert-NativeSuccess "Inno Setup"
    }
    Assert-FileExists $InstallerExe "Installer executable"

    Invoke-Step "Build portable archive" {
        New-PortableArchive
    }
    Assert-FileExists $PortableZip "Portable archive"

    Invoke-Step "Write artifact checksums" {
        Write-ArtifactChecksums
    }
    Assert-FileExists $ChecksumFile "Checksum file"

    Write-Host ""
    Write-Host "Release artifacts are in:" -ForegroundColor Green
    foreach ($artifact in @($AppExe, $InstallerExe, $PortableZip, $ChecksumFile)) {
        $artifactInfo = Get-Item -LiteralPath $artifact
        Write-Host ("  {0} ({1:N2} MB)" -f $artifactInfo.FullName, ($artifactInfo.Length / 1MB))
    }
}
finally {
    Pop-Location
}
