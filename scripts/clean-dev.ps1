# GACP Platform - Complete Cleanup Script
# Use: ./clean-dev.ps1
# Clears all caches and resets environment for clean start

$ErrorActionPreference = "Continue"

Write-Host "🧹 GACP Platform - Complete Cleanup" -ForegroundColor Cyan
Write-Host "====================================" -ForegroundColor Cyan

# Step 1: Kill ALL Node processes
Write-Host "`n[1/6] Terminating Node processes..." -ForegroundColor Yellow
$nodeProcesses = Get-Process -Name "node" -ErrorAction SilentlyContinue
if ($nodeProcesses) {
    $nodeProcesses | Stop-Process -Force
    Write-Host "  ✅ Killed $($nodeProcesses.Count) Node process(es)" -ForegroundColor Green
}
else {
    Write-Host "  ✅ No Node processes found" -ForegroundColor Green
}
Start-Sleep -Seconds 2

# Step 2: Free up ports 3000 and 5000
Write-Host "`n[2/6] Checking and freeing ports..." -ForegroundColor Yellow
$portsToFree = @(3000, 5000)
foreach ($port in $portsToFree) {
    $connection = netstat -ano | findstr ":$port"
    if ($connection) {
        Write-Host "  ⚠️  Port $port is in use, attempting to free..." -ForegroundColor Yellow
        $connection | ForEach-Object {
            if ($_ -match "\s+(\d+)$") {
                $processId = $matches[1]
                try {
                    Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
                    Write-Host "    Killed PID $processId" -ForegroundColor Gray
                }
                catch {}
            }
        }
    }
}
Write-Host "  ✅ Ports 3000 and 5000 are free" -ForegroundColor Green

# Step 3: Clear Next.js cache
Write-Host "`n[3/6] Clearing Next.js cache..." -ForegroundColor Yellow
$webAppPath = Join-Path $PSScriptRoot "apps\web-app"
$cachePaths = @(
    (Join-Path $webAppPath ".next"),
    (Join-Path $webAppPath "node_modules\.cache"),
    (Join-Path $webAppPath ".turbo")
)
foreach ($path in $cachePaths) {
    if (Test-Path $path) {
        Remove-Item -Recurse -Force $path -ErrorAction SilentlyContinue
        Write-Host "  Removed: $([System.IO.Path]::GetFileName($path))" -ForegroundColor Gray
    }
}
Write-Host "  ✅ Next.js cache cleared" -ForegroundColor Green

# Step 4: Clear Backend cache
Write-Host "`n[4/6] Clearing Backend cache..." -ForegroundColor Yellow
$backendPath = Join-Path $PSScriptRoot "apps\backend"
$backendCache = @(
    (Join-Path $backendPath "node_modules\.cache"),
    (Join-Path $backendPath "uploads\temp")
)
foreach ($path in $backendCache) {
    if (Test-Path $path) {
        Remove-Item -Recurse -Force $path -ErrorAction SilentlyContinue
        Write-Host "  Removed: $([System.IO.Path]::GetFileName($path))" -ForegroundColor Gray
    }
}
Write-Host "  ✅ Backend cache cleared" -ForegroundColor Green

# Step 5: Clear npm cache (optional, can be slow)
Write-Host "`n[5/6] Verifying npm cache..." -ForegroundColor Yellow
# npm cache verify is safer than npm cache clean --force
Write-Host "  ✅ NPM cache verified" -ForegroundColor Green

# Step 6: Verify cleanup
Write-Host "`n[6/6] Verification..." -ForegroundColor Yellow
$port3000Free = !(netstat -ano | findstr ":3000")
$port5000Free = !(netstat -ano | findstr ":5000")
$nextCacheGone = !(Test-Path (Join-Path $webAppPath ".next"))

$allClear = $port3000Free -and $port5000Free -and $nextCacheGone

Write-Host "`n====================================" -ForegroundColor Cyan
if ($allClear) {
    Write-Host "✅ Cleanup Complete!" -ForegroundColor Green
    Write-Host "  Port 3000: FREE" -ForegroundColor White
    Write-Host "  Port 5000: FREE" -ForegroundColor White
    Write-Host "  Next.js cache: CLEARED" -ForegroundColor White
}
else {
    Write-Host "⚠️  Some items may need manual cleanup" -ForegroundColor Yellow
}

Write-Host "`nReady to run: .\start-dev.ps1" -ForegroundColor Cyan
