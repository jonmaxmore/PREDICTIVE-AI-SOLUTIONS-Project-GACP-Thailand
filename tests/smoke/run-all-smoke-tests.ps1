#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Run all smoke tests for GACP Platform
.DESCRIPTION
    Executes all journey smoke tests and generates combined report
.PARAMETER ApiUrl
    Base API URL
.PARAMETER Parallel
    Run tests in parallel (faster but harder to debug)
.EXAMPLE
    .\run-all-smoke-tests.ps1
    .\run-all-smoke-tests.ps1 -ApiUrl "https://localhost/api" -Parallel
#>

param(
    [string]$ApiUrl = "https://localhost/api",
    [string]$WebUrl = "https://localhost",
    [switch]$Parallel
)

$ErrorActionPreference = "Stop"
$TestScripts = @(
    @{ Name = "Journey A - HEALTH_USER Happy Path"; Script = "journey-a-happy-path.ps1"; Description = "บุคคลธรรมดา ยื่นใหม่ จ่ายครบ ได้ใบรับรอง" }
    @{ Name = "Journey B - Corporate Bundle"; Script = "journey-b-bundle.ps1"; Description = "นิติบุคคล ยื่น Bundle Indoor+Outdoor" }
    @{ Name = "Journey C - Renewal Flow"; Script = "journey-c-renewal.ps1"; Description = "ต่ออายุใบรับรอง" }
    @{ Name = "Journey D - Reject & CAR"; Script = "journey-d-reject-car.ps1"; Description = "Reject และ Corrective Action" }
)

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "   GACP PLATFORM - SMOKE TEST SUITE" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Target: $ApiUrl" -ForegroundColor Gray
Write-Host "Mode: $(if ($Parallel) { "Parallel" } else { "Sequential" })" -ForegroundColor Gray
Write-Host ""

$Results = @()
$StartTime = Get-Date

if ($Parallel) {
    # Run in parallel using jobs
    Write-Host "Starting parallel test execution..." -ForegroundColor Yellow
    
    $jobs = @()
    foreach ($test in $TestScripts) {
        Write-Host "  Starting: $($test.Name)" -ForegroundColor Gray
        $jobs += Start-Job -ScriptBlock {
            param($script, $api, $web)
            Set-Location $using:PWD
            & ".\tests\smoke\$script" -ApiUrl $api -WebUrl $web
            return $LASTEXITCODE
        } -ArgumentList $test.Script, $ApiUrl, $WebUrl
    }
    
    # Wait for all jobs
    $jobs | Wait-Job | Out-Null
    
    # Collect results
    foreach ($job in $jobs) {
        $exitCode = Receive-Job $job
        $Results += @{ Name = ($TestScripts | Where-Object { $job.Name -like "*$($_.Script)*" }).Name; ExitCode = $exitCode }
        Remove-Job $job
    }
} else {
    # Run sequentially
    foreach ($test in $TestScripts) {
        Write-Host "========================================" -ForegroundColor Yellow
        Write-Host "Running: $($test.Name)" -ForegroundColor Yellow
        Write-Host $test.Description -ForegroundColor Gray
        Write-Host "========================================" -ForegroundColor Yellow
        
        $testStart = Get-Date
        try {
            & ".\tests\smoke\$($test.Script)" -ApiUrl $ApiUrl -WebUrl $WebUrl
            $exitCode = $LASTEXITCODE
        } catch {
            Write-Host "ERROR: $_" -ForegroundColor Red
            $exitCode = 1
        }
        $testEnd = Get-Date
        
        $Results += @{
            Name = $test.Name
            Description = $test.Description
            ExitCode = $exitCode
            Duration = $testEnd - $testStart
        }
        
        Write-Host ""
    }
}

$EndTime = Get-Date
$TotalDuration = $EndTime - $StartTime

# Generate Summary Report
Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "         FINAL TEST REPORT" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Total Duration: $($TotalDuration.ToString('mm\:ss'))" -ForegroundColor Gray
Write-Host ""

$passed = 0
$failed = 0

foreach ($result in $Results) {
    $icon = if ($result.ExitCode -eq 0) { "✅ PASS" } else { "❌ FAIL" }
    $color = if ($result.ExitCode -eq 0) { "Green" } else { "Red" }
    
    Write-Host $icon -ForegroundColor $color -NoNewline
    Write-Host " $($result.Name)" -ForegroundColor White
    
    if ($result.Duration) {
        Write-Host "   Duration: $($result.Duration.ToString('mm\:ss'))" -ForegroundColor Gray
    }
    
    if ($result.ExitCode -eq 0) { $passed++ } else { $failed++ }
}

Write-Host "`n----------------------------------------" -ForegroundColor White
Write-Host "Results: $passed Passed, $failed Failed" -ForegroundColor White

if ($failed -eq 0) {
    Write-Host "`n🎉 ALL SMOKE TESTS PASSED!" -ForegroundColor Green
    Write-Host "System is ready for deployment." -ForegroundColor Green
    exit 0
} else {
    Write-Host "`n❌ SOME TESTS FAILED" -ForegroundColor Red
    Write-Host "Please review the individual test reports." -ForegroundColor Red
    exit 1
}
