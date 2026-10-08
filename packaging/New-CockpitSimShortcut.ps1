<#
.SYNOPSIS
  Creates a "CockpitSim" shortcut on the Desktop that launches the whole app.

.DESCRIPTION
  The launcher (CockpitSim.Launcher.exe) already starts everything on its own
  (backend, telemetry bridge, InfluxDB preflight, dashboard), so a single
  desktop shortcut pointing at it is the one-click entry point -- the .cmd
  starters are no longer needed day-to-day.

  Run once per PC. Re-run any time the bundle moves to fix the target.

  ASCII-only, no secrets (see packaging/README.md rules).

.PARAMETER LauncherExe
  Path to CockpitSim.Launcher.exe. Defaults to the launcher next to this
  script's parent bundle folder (...\CockpitSimApp\launcher\...).

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File .\New-CockpitSimShortcut.ps1
#>
[CmdletBinding()]
param(
    [string]$LauncherExe = (Join-Path $PSScriptRoot "launcher\CockpitSim.Launcher.exe")
)

$ErrorActionPreference = "Stop"

# Resolve and sanity-check the target.
$target = (Resolve-Path -LiteralPath $LauncherExe -ErrorAction SilentlyContinue)
if (-not $target) {
    Write-Error "Launcher not found: $LauncherExe`nPass -LauncherExe <path to CockpitSim.Launcher.exe>."
    exit 1
}
$targetPath = $target.Path
$workingDir = Split-Path $targetPath -Parent

$desktop = [Environment]::GetFolderPath("Desktop")
$shortcutPath = Join-Path $desktop "CockpitSim.lnk"

# WScript.Shell COM is the simplest dependency-free way to write a .lnk.
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $targetPath
$shortcut.WorkingDirectory = $workingDir
$shortcut.IconLocation = "$targetPath,0"   # icon embedded in the exe
$shortcut.Description = "CockpitSim - helicopter training simulator"
$shortcut.Save()

Write-Output "Created shortcut: $shortcutPath"
Write-Output "  Target: $targetPath"
Write-Output "Double-click 'CockpitSim' on the desktop to launch the app."
