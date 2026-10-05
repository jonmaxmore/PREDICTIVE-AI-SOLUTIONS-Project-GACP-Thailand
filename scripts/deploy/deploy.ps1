param(
    [string]$IP = "gacpth.com",
    [string]$User = "root",
    [string]$AppDir = "/opt/gacp-platform",
    [switch]$AllowDirtyWorktree
)

$scriptPath = Join-Path $PSScriptRoot "scripts/deploy/deploy-do.ps1"

if (-not (Test-Path -LiteralPath $scriptPath)) {
    throw "Canonical deploy script not found: $scriptPath"
}

& $scriptPath -IP $IP -User $User -AppDir $AppDir -AllowDirtyWorktree:$AllowDirtyWorktree
