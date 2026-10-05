#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Setup script for smoke testing
    เตรียมระบบสำหรับการทดสอบ
.DESCRIPTION
    - Seeds Provider Users
    - Verifies API endpoints
    - Runs pre-flight checks
#>

param(
    [string]$ApiUrl = "http://localhost/api"
)

$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "   SMOKE TEST SETUP" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 1. Check Docker is running
Write-Host "1. Checking Docker..." -ForegroundColor Yellow
try {
    $dockerInfo = docker info 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "Docker is not running"
    }
    Write-Host "   ✅ Docker is running" -ForegroundColor Green
} catch {
    Write-Host "   ❌ Docker is not running. Please start Docker Desktop." -ForegroundColor Red
    exit 1
}

# 2. Check containers are running
Write-Host "`n2. Checking containers..." -ForegroundColor Yellow
$requiredContainers = @("gacp-backend", "gacp-nginx", "gacp-postgres")
$missing = @()

foreach ($container in $requiredContainers) {
    $running = docker ps --format "{{.Names}}" | Select-String $container
    if (-not $running) {
        $missing += $container
    }
}

if ($missing.Count -gt 0) {
    Write-Host "   ❌ Missing containers: $($missing -join ', ')" -ForegroundColor Red
    Write-Host "   Starting containers..." -ForegroundColor Yellow
    docker-compose -f docker-compose.local-prod.yml up -d
    Start-Sleep -Seconds 10
} else {
    Write-Host "   ✅ All containers running" -ForegroundColor Green
}

# 3. Wait for API to be ready
Write-Host "`n3. Waiting for API..." -ForegroundColor Yellow
$maxRetries = 30
$retry = 0
$apiReady = $false

while ($retry -lt $maxRetries -and -not $apiReady) {
    try {
        $response = Invoke-RestMethod -Uri "$ApiUrl/health" -Method GET -TimeoutSec 5 -ErrorAction Stop
        if ($response.success -eq $true) {
            $apiReady = $true
            Write-Host "   ✅ API is ready (Version: $($response.version))" -ForegroundColor Green
        }
    } catch {
        $retry++
        Write-Host "   ⏳ Waiting... ($retry/$maxRetries)" -ForegroundColor Gray
        Start-Sleep -Seconds 2
    }
}

if (-not $apiReady) {
    Write-Host "   ❌ API failed to start within timeout" -ForegroundColor Red
    exit 1
}

# 4. Seed Provider Users
Write-Host "`n4. Seeding Provider Users..." -ForegroundColor Yellow
try {
    $seedOutput = docker exec gacp-backend node scripts/seed-provider-users.js 2>&1
    Write-Host "   $seedOutput" -ForegroundColor Gray
    Write-Host "   ✅ Provider Users ready" -ForegroundColor Green
} catch {
    Write-Host "   ⚠️  provider seeding had issues (may already exist)" -ForegroundColor Yellow
    Write-Host "   $_" -ForegroundColor Gray
}

# 5. Run pre-flight check
Write-Host "`n5. Running pre-flight check..." -ForegroundColor Yellow
& "$PSScriptRoot\pre-flight-check.ps1" -ApiUrl $ApiUrl

if ($LASTEXITCODE -ne 0) {
    Write-Host "`n❌ Pre-flight check failed. Please fix issues before running tests." -ForegroundColor Red
    exit 1
}

# Success
Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "   SETUP COMPLETE!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Ready to run smoke tests:" -ForegroundColor White
Write-Host "   .\tests\smoke\journey-a-happy-path.ps1" -ForegroundColor Yellow
Write-Host ""
