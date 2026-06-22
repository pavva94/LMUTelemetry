param(
    [switch]$SkipDependencyInstall,
    [switch]$SkipFrontendTests,
    [switch]$SkipFrontendBuild,
    [switch]$SkipSmokeTest,
    [ValidatePattern('^\d+\.\d+\.\d+([-.][0-9A-Za-z.-]+)?$')]
    [string]$AppVersion = "0.1.0"
)

$ErrorActionPreference = "Stop"
$buildScript = Join-Path $PSScriptRoot "build_windows_installer.ps1"

& $buildScript `
    -SkipDependencyInstall:$SkipDependencyInstall `
    -SkipFrontendTests:$SkipFrontendTests `
    -SkipFrontendBuild:$SkipFrontendBuild `
    -SkipSmokeTest:$SkipSmokeTest `
    -SkipInstaller `
    -AppVersion $AppVersion
