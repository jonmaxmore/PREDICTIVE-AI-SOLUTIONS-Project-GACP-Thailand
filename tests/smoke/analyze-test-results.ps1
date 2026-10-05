#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Analyze smoke test results and provide recommendations
.DESCRIPTION
    Reads test result JSON files and provides detailed analysis
#>

param(
    [string]$ReportPath = "tests/reports"
)

$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "   SMOKE TEST RESULTS ANALYZER" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Find all report files
$reports = Get-ChildItem -Path $ReportPath -Filter "journey-*.json" | Sort-Object LastWriteTime -Descending

if ($reports.Count -eq 0) {
    Write-Host "No test reports found in $ReportPath" -ForegroundColor Red
    Write-Host "Run smoke tests first:" -ForegroundColor Yellow
    Write-Host "   .\tests\smoke\journey-a-happy-path.ps1" -ForegroundColor White
    exit 1
}

Write-Host "Found $($reports.Count) test report(s)`n" -ForegroundColor Gray

# Analyze each report
$analysis = @()

foreach ($report in $reports | Select-Object -First 5) {
    $content = Get-Content $report.FullName | ConvertFrom-Json
    
    $passCount = ($content.Results.Stages | Where-Object { $_.Status -eq "PASS" }).Count
    $failCount = ($content.Results.Stages | Where-Object { $_.Status -eq "FAIL" }).Count
    $skipCount = ($content.Results.Stages | Where-Object { $_.Status -eq "SKIP" }).Count
    
    $analysis += [PSCustomObject]@{
        TestId = $content.TestId
        Timestamp = $content.Timestamp
        Duration = $content.Results.Duration
        Passed = $passCount
        Failed = $failCount
        Skipped = $skipCount
        Total = $content.Results.Stages.Count
        SuccessRate = [math]::Round(($passCount / $content.Results.Stages.Count) * 100, 1)
        FailedStages = ($content.Results.Stages | Where-Object { $_.Status -eq "FAIL" } | ForEach-Object { $_.Name }) -join ", "
    }
}

# Display summary table
$analysis | Format-Table -Property TestId, Passed, Failed, Skipped, SuccessRate, Duration -AutoSize

# Latest test details
$latest = $analysis | Select-Object -First 1

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "   LATEST TEST: $($latest.TestId)" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

if ($latest.Failed -gt 0) {
    Write-Host "❌ Failed Stages:" -ForegroundColor Red
    $latestReport = Get-Content "$ReportPath\journey-a-$($latest.Timestamp).json" | ConvertFrom-Json
    $failedStages = $latestReport.Results.Stages | Where-Object { $_.Status -eq "FAIL" }
    
    foreach ($stage in $failedStages) {
        Write-Host "   • $($stage.Name)" -ForegroundColor Red
        if ($stage.Error) {
            Write-Host "     Error: $($stage.Error)" -ForegroundColor Gray
        }
    }
    
    Write-Host ""
    Write-Host "📋 Recommendations:" -ForegroundColor Yellow
    
    # Common issues and solutions
    $errors = $failedStages | ForEach-Object { $_.Error }
    
    if ($errors -match "404") {
        Write-Host "   • API Endpoints (404): Check that backend services are running" -ForegroundColor White
        Write-Host "     docker ps" -ForegroundColor Gray
    }
    
    if ($errors -match "401") {
        Write-Host "   • Authentication (401): Provider Users may not exist" -ForegroundColor White
        Write-Host "     docker exec gacp-backend node scripts/seed-provider-users.js" -ForegroundColor Gray
    }
    
    if ($errors -match "Unable to connect") {
        Write-Host "   • Connection Error: Docker services may not be running" -ForegroundColor White
        Write-Host "     docker-compose -f docker-compose.local-prod.yml up -d" -ForegroundColor Gray
    }
    
    if ($errors -match "Endpoint not available") {
        Write-Host "   • Missing Endpoints: Some API endpoints are not implemented" -ForegroundColor White
        Write-Host "     Check backend routes configuration" -ForegroundColor Gray
    }
} else {
    Write-Host "✅ All stages passed!" -ForegroundColor Green
}

# Trends
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "   TRENDS (Last 5 Tests)" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$avgSuccess = ($analysis | Measure-Object -Property SuccessRate -Average).Average
Write-Host "Average Success Rate: $([math]::Round($avgSuccess, 1))%" -ForegroundColor $(if ($avgSuccess -ge 80) { "Green" } elseif ($avgSuccess -ge 50) { "Yellow" } else { "Red" })

$passTrend = $analysis | Select-Object -First 3 | Where-Object { $_.Failed -eq 0 }
if ($passTrend.Count -eq 3) {
    Write-Host "Trend: Improving ✅" -ForegroundColor Green
} elseif ($passTrend.Count -eq 0) {
    Write-Host "Trend: Needs attention ❌" -ForegroundColor Red
} else {
    Write-Host "Trend: Stable ⚠️" -ForegroundColor Yellow
}

Write-Host ""
