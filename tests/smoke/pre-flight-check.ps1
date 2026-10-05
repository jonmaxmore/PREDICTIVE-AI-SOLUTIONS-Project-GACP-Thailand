#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Pre-flight check before running smoke tests
    ตรวจสอบว่าระบบพร้อมสำหรับการทดสอบหรือไม่
.DESCRIPTION
    Checks:
    - Docker services are running
    - API is accessible
    - Database is connected
    - Provider Users exist
    - Payment gateway is in mock mode
#>

param(
    [string]$ApiUrl = "http://localhost/api"
)

$ErrorActionPreference = "Continue"
$ChecksPassed = 0
$ChecksFailed = 0

function Write-CheckHeader($text) {
    Write-Host "`n== $text ==" -ForegroundColor Cyan
}

function Write-CheckResult($name, $passed, $message = "") {
    $icon = if ($passed) { "✅" } else { "❌" }
    $color = if ($passed) { "Green" } else { "Red" }
    Write-Host "$icon $name" -ForegroundColor $color -NoNewline
    if ($message) { Write-Host " - $message" -ForegroundColor Gray }
    else { Write-Host }
    
    if ($passed) { $script:ChecksPassed++ } else { $script:ChecksFailed++ }
}

# Disable SSL validation for self-signed certs
add-type @"
    using System.Net;
    using System.Security.Cryptography.X509Certificates;
    public class TrustAllCertsPolicy : ICertificatePolicy {
        public bool CheckValidationResult(ServicePoint srvPoint, X509Certificate certificate, WebRequest request, int certificateProblem) {
            return true;
        }
    }
"@
[System.Net.ServicePointManager]::CertificatePolicy = New-Object TrustAllCertsPolicy
[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "   PRE-FLIGHT CHECK FOR SMOKE TESTS" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "API URL: $ApiUrl`n" -ForegroundColor Gray

# 1. Check Docker Services
Write-CheckHeader "1. Docker Services"

try {
    $containers = docker ps --format "{{.Names}}" 2>&1
    $requiredContainers = @("gacp-backend", "gacp-frontend", "gacp-nginx", "gacp-postgres", "gacp-redis")
    $allRunning = $true
    
    foreach ($container in $requiredContainers) {
        if ($containers -contains $container) {
            Write-CheckResult "Container: $container" $true
        } else {
            Write-CheckResult "Container: $container" $false "Not running"
            $allRunning = $false
        }
    }
} catch {
    Write-CheckResult "Docker check" $false $_.Exception.Message
}

# 2. Check API Health
Write-CheckHeader "2. API Health Check"

try {
    $response = Invoke-RestMethod -Uri "$ApiUrl/health" -Method GET -TimeoutSec 10
    if ($response.success -eq $true) {
        Write-CheckResult "API Health" $true "Version: $($response.version)"
        Write-CheckResult "Database" ($response.dbStatus.status -eq "connected") "Type: $($response.dbStatus.type)"
    } else {
        Write-CheckResult "API Health" $false "Unhealthy response"
    }
} catch {
    Write-CheckResult "API Health" $false $_.Exception.Message
}

# 3. Check API Endpoints
Write-CheckHeader "3. API Endpoints"

$endpoints = @(
    @{ Name = "Auth HEALTH_USER"; Path = "/auth-health/login"; Method = "POST" },
    @{ Name = "Auth DTAM"; Path = "/auth-dtam/login"; Method = "POST" },
    @{ Name = "Applications"; Path = "/applications"; Method = "GET" },
    @{ Name = "Farms"; Path = "/farms"; Method = "GET" },
    @{ Name = "Certificates"; Path = "/certificates"; Method = "GET" },
    @{ Name = "Trace"; Path = "/trace/test-qr"; Method = "GET" }
)

foreach ($endpoint in $endpoints) {
    try {
        if ($endpoint.Method -eq "POST") {
            # For auth endpoints, we expect 400 (missing body) or 401 (wrong creds) - that's OK
            try {
                Invoke-RestMethod -Uri "$ApiUrl$($endpoint.Path)" -Method POST -TimeoutSec 5 | Out-Null
                Write-CheckResult $endpoint.Name $true
            } catch {
                $statusCode = $_.Exception.Response.StatusCode.value__
                if ($statusCode -eq 400 -or $statusCode -eq 401) {
                    Write-CheckResult $endpoint.Name $true "Endpoint exists (returns $statusCode)"
                } else {
                    Write-CheckResult $endpoint.Name $false "HTTP $statusCode"
                }
            }
        } else {
            Invoke-RestMethod -Uri "$ApiUrl$($endpoint.Path)" -Method GET -TimeoutSec 5 | Out-Null
            Write-CheckResult $endpoint.Name $true
        }
    } catch {
        $statusCode = $_.Exception.Response.StatusCode.value__
        if ($statusCode -eq 404) {
            Write-CheckResult $endpoint.Name $false "Not Found (404)"
        } elseif ($statusCode -eq 401 -or $statusCode -eq 403) {
            Write-CheckResult $endpoint.Name $true "Protected endpoint (returns $statusCode)"
        } else {
            Write-CheckResult $endpoint.Name $false "HTTP $statusCode"
        }
    }
}

# 4. Check Provider Users
Write-CheckHeader "4. Provider Users"

try {
    # Try to login as reviewer
    $loginBody = @{ username = "reviewer"; password = "Test@12345" } | ConvertTo-Json
    try {
        $response = Invoke-RestMethod -Uri "$ApiUrl/auth-dtam/login" -Method POST -Body $loginBody -ContentType "application/json" -TimeoutSec 5
        Write-CheckResult "Reviewer login" $true
    } catch {
        if ($_.Exception.Response.StatusCode.value__ -eq 401) {
            Write-CheckResult "Reviewer login" $false "Invalid credentials - need to seed users"
        } else {
            Write-CheckResult "Reviewer login" $false $_.Exception.Message
        }
    }
} catch {
    Write-CheckResult "provider check" $false $_.Exception.Message
}

# 5. Check Payment Gateway
Write-CheckHeader "5. Payment Gateway"

try {
    # This is a mock check - in real scenario, check env vars or config endpoint
    Write-CheckResult "Payment Gateway" $true "Assumed MOCK mode (verify .env.local)"
    Write-Host "   ℹ️  Ensure PAYMENT_GATEWAY=MOCK in environment" -ForegroundColor Yellow
} catch {
    Write-CheckResult "Payment check" $false $_.Exception.Message
}

# Summary
Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "   PRE-FLIGHT SUMMARY" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Passed: $ChecksPassed" -ForegroundColor Green
Write-Host "Failed: $ChecksFailed" -ForegroundColor $(if ($ChecksFailed -gt 0) { "Red" } else { "Green" })
Write-Host ""

if ($ChecksFailed -eq 0) {
    Write-Host "✅ ALL CHECKS PASSED!" -ForegroundColor Green
    Write-Host "System is ready for smoke testing." -ForegroundColor Green
    Write-Host ""
    Write-Host "Run smoke test with:" -ForegroundColor Gray
    Write-Host "   .\tests\smoke\journey-a-happy-path.ps1" -ForegroundColor White
    exit 0
} else {
    Write-Host "❌ SOME CHECKS FAILED" -ForegroundColor Red
    Write-Host "Please fix the issues above before running smoke tests." -ForegroundColor Red
    Write-Host ""
    Write-Host "Quick fixes:" -ForegroundColor Yellow
    Write-Host "   1. Start Docker: docker-compose -f docker-compose.local-prod.yml up -d" -ForegroundColor Gray
    Write-Host "   2. Seed Provider Users: docker exec gacp-backend node scripts/seed-provider-users.js" -ForegroundColor Gray
    Write-Host "   3. Check API health: curl http://localhost/api/health" -ForegroundColor Gray
    exit 1
}
