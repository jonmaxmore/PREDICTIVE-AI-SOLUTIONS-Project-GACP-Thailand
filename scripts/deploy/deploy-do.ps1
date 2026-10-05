<#
.SYNOPSIS
Deploy GACP Platform to the production host using the local workspace as the release source.

.DESCRIPTION
This script packages the current workspace, uploads it to the target host, writes
release metadata, and restarts the canonical production compose stack.

.PARAMETER IP
The target host (default: gacpth.com)
#>

param (
    [string]$IP = "gacpth.com",
    [string]$User = "root",
    [string]$AppDir = "/opt/gacp-platform",
    [switch]$AllowDirtyWorktree
)

$ErrorActionPreference = "Stop"

Write-Host "Starting deployment to $IP" -ForegroundColor Cyan

node scripts/check-production-topology.js
node scripts/check-infra-contracts.js

$releaseSha = (git rev-parse HEAD).Trim()
$dirtyEntries = @(git status --short)

if (-not $AllowDirtyWorktree -and $dirtyEntries.Count -gt 0) {
    Write-Host "Refusing deployment from a dirty worktree. Use -AllowDirtyWorktree only when you intentionally want a non-commit release." -ForegroundColor Red
    $dirtyEntries | Select-Object -First 50 | ForEach-Object { Write-Host $_ -ForegroundColor Yellow }
    throw "Dirty worktree detected"
}

Write-Host "Archiving release $releaseSha" -ForegroundColor Yellow
tar.exe -cf deploy.tar --exclude="node_modules" --exclude=".next" --exclude=".git" --exclude="deploy.tar" .

Write-Host "Uploading package to $IP" -ForegroundColor Yellow
scp.exe deploy.tar ${User}@${IP}:${AppDir}/deploy.tar

$remoteCommand = @"
set -e
cd $AppDir
mkdir -p deploy
tar -xf deploy.tar
rm deploy.tar
printf '%s' '$releaseSha' > deploy/release-sha.txt
printf '{"releaseSha":"%s","deployedAtUtc":"%s"}\n' '$releaseSha' "\$(date -u +%Y-%m-%dT%H:%M:%SZ)" > deploy/release.json
docker compose -f docker-compose.production.yml --env-file .env.production config > /dev/null
docker compose -f docker-compose.production.yml --env-file .env.production build backend frontend
docker compose -f docker-compose.production.yml --env-file .env.production up -d --no-deps backend frontend
docker compose -f docker-compose.production.yml --env-file .env.production up -d nginx
docker compose -f docker-compose.production.yml --env-file .env.production ps
"@

Write-Host "Restarting production services" -ForegroundColor Yellow
ssh.exe ${User}@${IP} $remoteCommand

Write-Host "Deployment complete. Release SHA: $releaseSha" -ForegroundColor Green
Remove-Item deploy.tar -ErrorAction SilentlyContinue
