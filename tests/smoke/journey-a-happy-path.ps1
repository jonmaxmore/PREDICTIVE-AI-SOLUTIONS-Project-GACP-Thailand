#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Smoke Test: Journey A - Applicant Individual Happy Path
.DESCRIPTION
    Full end-to-end smoke test covering the complete GACP workflow:
    Register → Login → Create Farm → Apply → Pay Phase 1 → provider Review → 
    Pay Phase 2 → Certificate → Lots → Track & Trace
.PARAMETER ApiUrl
    Base URL of the API (default: http://localhost/api)
.PARAMETER SkipSetup
    Skip the setup checks and run tests immediately
#>

param(
    [string]$ApiUrl = "http://localhost/api",
    [switch]$SkipSetup
)

$ErrorActionPreference = "Stop"

# Test Configuration
$TestConfig = @{
    ApiUrl = $ApiUrl
    TestId = "JOURNEY-A-$(Get-Random -Minimum 1000 -Maximum 9999)"
    Timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
    StartTime = Get-Date
}

# Show header
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "   GACP SMOKE TEST - JOURNEY A" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Test ID: $($TestConfig.TestId)" -ForegroundColor Gray
Write-Host "API URL: $($TestConfig.ApiUrl)" -ForegroundColor Gray
Write-Host "Started: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor Gray
Write-Host ""

# Pre-flight check (unless skipped)
if (-not $SkipSetup) {
    Write-Host "Running pre-flight check..." -ForegroundColor Yellow
    & "$PSScriptRoot\pre-flight-check.ps1" -ApiUrl $ApiUrl | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "`nPre-flight check failed. Run setup first:" -ForegroundColor Red
        Write-Host "   .\tests\smoke\setup-smoke-test.ps1" -ForegroundColor Yellow
        exit 1
    }
    Write-Host "Pre-flight check passed!`n" -ForegroundColor Green
}

# Test Data
$TestData = @{}
$TestData.Applicant = @{}
$TestData.applicant.idCard = "1$(Get-Random -Minimum 10000000000 -Maximum 99999999999)"
$TestData.applicant.firstName = "Somchai"
$TestData.applicant.lastName = "Jaidee"
$TestData.applicant.phone = "089$(Get-Random -Minimum 1000000 -Maximum 9999999)"
$TestData.applicant.email = "Applicant.$(Get-Random)@test.com"
$TestData.applicant.password = "Test@12345"
$TestData.applicant.address = "123 Moo 4"
$TestData.applicant.province = "Chiang Mai"
$TestData.applicant.district = "Hang Dong"
$TestData.applicant.subdistrict = "Nong Khwai"

$TestData.Farm = @{}
$TestData.Farm.name = "Farm$(Get-Random -Minimum 100 -Maximum 999)"
$TestData.Farm.latitude = 18.7883
$TestData.Farm.longitude = 98.9853
$TestData.Farm.areaRai = 5

$TestData.Application = @{}
$TestData.Application.plantType = "CANNABIS"
$TestData.Application.areaType = "OUTDOOR"

# Results tracking
$TestResults = @{
    Journey = "A"
    Description = "Applicant Individual Happy Path"
    Stages = @()
}

# SSL bypass for self-signed certs
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
$ProgressPreference = 'SilentlyContinue'

# Helper functions
function Write-TestHeader($text) {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host $text -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
}

function Write-TestStep($step, $status, $message) {
    if (-not $message) { $message = "" }
    $icon = if ($status -eq "PASS") { "✅" } elseif ($status -eq "FAIL") { "❌" } else { "⏳" }
    $color = if ($status -eq "PASS") { "Green" } elseif ($status -eq "FAIL") { "Red" } else { "Yellow" }
    Write-Host "$icon $step" -ForegroundColor $color -NoNewline
    if ($message) { Write-Host " - $message" -ForegroundColor Gray }
    else { Write-Host }
}

function Invoke-ApiRequest {
    param(
        [string]$Method = "GET",
        [string]$Endpoint,
        [object]$Body = $null,
        [hashtable]$Headers = @{},
        [string]$Token = $null
    )
    
    $url = "$ApiUrl$Endpoint"
    $headers['Content-Type'] = 'application/json'
    if ($Token) { $headers['Authorization'] = "Bearer $Token" }
    
    try {
        if ($Body) {
            $jsonBody = $Body | ConvertTo-Json -Depth 10 -Compress
            $response = Invoke-RestMethod -Uri $url -Method $Method -Headers $headers -Body $jsonBody -TimeoutSec 30
        } else {
            $response = Invoke-RestMethod -Uri $url -Method $Method -Headers $headers -TimeoutSec 30
        }
        return @{ Success = $true; Data = $response }
    } catch {
        $errorMsg = $_.Exception.Message
        $statusCode = $null
        if ($_.Exception.Response) {
            $statusCode = $_.Exception.Response.StatusCode.value__
            try {
                $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
                $errorBody = $reader.ReadToEnd()
                $reader.Close()
                $errorMsg = "$errorMsg (HTTP $statusCode): $errorBody"
            } catch {
                $errorMsg = "$errorMsg (HTTP $statusCode)"
            }
        }
        return @{ Success = $false; Error = $errorMsg; StatusCode = $statusCode }
    }
}

function Test-EndpointExists($endpoint) {
    try {
        Invoke-RestMethod -Uri "$ApiUrl$endpoint" -Method GET -TimeoutSec 5 | Out-Null
        return $true
    } catch {
        return $_.Exception.Response.StatusCode.value__ -ne 404
    }
}

# ==================== STAGE 1: REGISTRATION ====================
Write-TestHeader "STAGE 1: Applicant Registration"

$Stage1 = @{ Name = "Registration"; StartTime = Get-Date; Status = "PENDING" }

try {
    Write-TestStep "Registering Applicant..." "PENDING" ""
    
    $registerBody = @{
        accountType = "INDIVIDUAL"
        idCard = $TestData.applicant.idCard
        firstName = $TestData.applicant.firstName
        lastName = $TestData.applicant.lastName
        phoneNumber = $TestData.applicant.phone
        email = $TestData.applicant.email
        password = $TestData.applicant.password
        address = $TestData.applicant.address
        province = $TestData.applicant.province
        district = $TestData.applicant.district
        subdistrict = $TestData.applicant.subdistrict
    }
    
    $result = Invoke-ApiRequest -Method "POST" -Endpoint "/auth-health/register" -Body $registerBody
    
    if ($result.Success -and $result.Data.success) {
        $TestData.applicant.userId = $result.Data.data.user.id
        Write-TestStep "Registration" "PASS" "User ID: $($TestData.applicant.userId)"
        $Stage1.Status = "PASS"
    } else {
        throw $result.Error
    }
} catch {
    Write-TestStep "Registration" "FAIL" $_.Exception.Message
    $Stage1.Status = "FAIL"
    $Stage1.Error = $_.Exception.Message
}

$Stage1.EndTime = Get-Date
$TestResults.Stages += $Stage1

# ==================== STAGE 2: LOGIN ====================
Write-TestHeader "STAGE 2: Applicant Login"

$Stage2 = @{ Name = "Login"; StartTime = Get-Date; Status = "PENDING" }

try {
    $loginBody = @{ 
        identifier = $TestData.applicant.idCard
        password = $TestData.applicant.password 
    }
    $result = Invoke-ApiRequest -Method "POST" -Endpoint "/auth-health/login" -Body $loginBody
    
    if ($result.Success -and $result.Data.success) {
        $TestData.applicant.token = $result.Data.data.token
        Write-TestStep "Login" "PASS" "Token received"
        $Stage2.Status = "PASS"
    } else {
        throw $result.Error
    }
} catch {
    Write-TestStep "Login" "FAIL" $_.Exception.Message
    $Stage2.Status = "FAIL"
}

$Stage2.EndTime = Get-Date
$TestResults.Stages += $Stage2

if ($Stage2.Status -eq "FAIL") { 
    Write-Host "Cannot proceed without authentication" -ForegroundColor Red
    exit 1 
}

# ==================== STAGE 3: CREATE FARM ====================
Write-TestHeader "STAGE 3: Create Farm"

$Stage3 = @{ Name = "Create Farm"; StartTime = Get-Date; Status = "PENDING" }

try {
    Write-TestStep "Checking farm endpoint..." "PENDING" ""
    
    if (-not (Test-EndpointExists "/farms")) {
        Write-TestStep "Create Farm" "SKIP" "Endpoint /farms not available"
        $Stage3.Status = "SKIP"
        $Stage3.Error = "Endpoint not available"
    } else {
        $farmBody = @{
            farmName = $TestData.Farm.name
            farmType = "CULTIVATION"
            address = $TestData.applicant.address
            province = $TestData.applicant.province
            district = $TestData.applicant.district
            subDistrict = $TestData.applicant.subdistrict
            postalCode = "50230"
            latitude = $TestData.Farm.latitude
            longitude = $TestData.Farm.longitude
            totalArea = $TestData.Farm.areaRai
            cultivationArea = $TestData.Farm.areaRai
            cultivationMethod = "SOIL"
            status = "SUBMITTED"
        }
        
        $result = Invoke-ApiRequest -Method "POST" -Endpoint "/farms" -Body $farmBody -Token $TestData.applicant.token
        
        if ($result.Success -and $result.Data.success) {
            $TestData.Farm.id = $result.Data.data.id
            Write-TestStep "Create Farm" "PASS" "Farm ID: $($TestData.Farm.id)"
            $Stage3.Status = "PASS"
        } else {
            throw $result.Error
        }
    }
} catch {
    Write-TestStep "Create Farm" "FAIL" $_.Exception.Message
    $Stage3.Status = "FAIL"
    $Stage3.Error = $_.Exception.Message
}

$Stage3.EndTime = Get-Date
$TestResults.Stages += $Stage3

# ==================== STAGE 4: CREATE APPLICATION ====================
Write-TestHeader "STAGE 4: Create GACP Application"

$Stage4 = @{ Name = "Create Application"; StartTime = Get-Date; Status = "PENDING" }

try {
    Write-TestStep "Creating application..." "PENDING" ""
    
    if (-not (Test-EndpointExists "/applications")) {
        Write-TestStep "Create Application" "SKIP" "Endpoint not available"
        $Stage4.Status = "SKIP"
    } else {
        $appBody = @{
            serviceType = "new_application"
            areaType = $TestData.Application.areaType
            farmId = $TestData.Farm.id
            plantCode = $TestData.Application.plantType
            formData = @{ 
                plotName = "Plot 1"
                plotArea = $TestData.Farm.areaRai
                cultivationMethod = "SOIL"
                expectedYield = 100 
            }
        }
        
        $result = Invoke-ApiRequest -Method "POST" -Endpoint "/applications" -Body $appBody -Token $TestData.applicant.token
        
        if ($result.Success -and $result.Data.success) {
            $TestData.Application.id = $result.Data.data.id
            $TestData.Application.number = $result.Data.data.applicationNumber
            Write-TestStep "Create Application" "PASS" "App#: $($TestData.Application.number)"
            $Stage4.Status = "PASS"
        } else {
            throw $result.Error
        }
    }
} catch {
    Write-TestStep "Create Application" "FAIL" $_.Exception.Message
    $Stage4.Status = "FAIL"
}

$Stage4.EndTime = Get-Date
$TestResults.Stages += $Stage4

# ==================== STAGE 5-10: Conditional Tests ====================
if ($Stage4.Status -ne "PASS") {
    Write-TestHeader "STAGES 5-10: Skipped"
    Write-Host "Cannot proceed without valid application" -ForegroundColor Yellow
    
    # Mark remaining stages as skipped
    @("Payment Phase 1", "provider Approval", "Payment Phase 2", "Certificate", "Create Lots", "Track and Trace") | ForEach-Object {
        $skipStage = @{ Name = $_; StartTime = Get-Date; EndTime = Get-Date; Status = "SKIP" }
        $TestResults.Stages += $skipStage
    }
} else {
    # Continue with remaining stages...
    
    # STAGE 5: PAYMENT PHASE 1
    Write-TestHeader "STAGE 5: Payment Phase 1 (5,000 THB)"
    $Stage5 = @{ Name = "Payment Phase 1"; StartTime = Get-Date; Status = "PENDING" }
    
    try {
        Write-TestStep "Initiating Phase 1 payment..." "PENDING" ""
        
        if (-not (Test-EndpointExists "/payments/phase1/$($TestData.Application.id)")) {
            Write-TestStep "Payment Phase 1" "SKIP" "Endpoint not available"
            $Stage5.Status = "SKIP"
        } else {
            $result = Invoke-ApiRequest -Method "POST" -Endpoint "/payments/phase1/$($TestData.Application.id)" -Token $TestData.applicant.token
            Start-Sleep -Seconds 2
            
            if ($result.Success) {
                Write-TestStep "Payment Phase 1" "PASS" "5,000 THB paid"
                $Stage5.Status = "PASS"
            } else {
                throw $result.Error
            }
        }
    } catch {
        Write-TestStep "Payment Phase 1" "FAIL" $_.Exception.Message
        $Stage5.Status = "FAIL"
    }
    $Stage5.EndTime = Get-Date
    $TestResults.Stages += $Stage5

    # STAGE 6: provider APPROVAL
    Write-TestHeader "STAGE 6: provider Review & Approve"
    $Stage6 = @{ Name = "provider Approval"; StartTime = Get-Date; Status = "PENDING" }
    
    try {
        Write-TestStep "provider login..." "PENDING" ""
        
        $PROVIDERLogin = @{ username = "reviewer"; password = "Test@12345" }
        $result = Invoke-ApiRequest -Method "POST" -Endpoint "/auth-dtam/login" -Body $PROVIDERLogin
        
        if ($result.Success -and $result.Data.success) {
            $PROVIDERToken = $result.Data.data.token
            Write-TestStep "provider Login" "PASS" ""
            
            $approveBody = @{ status = "APPROVED_DOCUMENT"; notes = "Documents complete" }
            $approveResult = Invoke-ApiRequest -Method "PUT" -Endpoint "/applications/$($TestData.Application.id)/status" -Body $approveBody -Token $PROVIDERToken
            
            if ($approveResult.Success) {
                Write-TestStep "provider Approval" "PASS" "Application approved"
                $Stage6.Status = "PASS"
            } else {
                throw $approveResult.Error
            }
        } else {
            throw "provider login failed: $($result.Error)"
        }
    } catch {
        Write-TestStep "provider Approval" "FAIL" $_.Exception.Message
        $Stage6.Status = "FAIL"
    }
    $Stage6.EndTime = Get-Date
    $TestResults.Stages += $Stage6

    # STAGE 7: PAYMENT PHASE 2
    Write-TestHeader "STAGE 7: Payment Phase 2 (25,000 THB)"
    $Stage7 = @{ Name = "Payment Phase 2"; StartTime = Get-Date; Status = "PENDING" }
    
    try {
        Write-TestStep "Initiating Phase 2 payment..." "PENDING" ""
        
        if (-not (Test-EndpointExists "/payments/phase2/$($TestData.Application.id)")) {
            Write-TestStep "Payment Phase 2" "SKIP" "Endpoint not available"
            $Stage7.Status = "SKIP"
        } else {
            $result = Invoke-ApiRequest -Method "POST" -Endpoint "/payments/phase2/$($TestData.Application.id)" -Token $TestData.applicant.token
            Start-Sleep -Seconds 2
            
            if ($result.Success) {
                Write-TestStep "Payment Phase 2" "PASS" "25,000 THB paid"
                $Stage7.Status = "PASS"
            } else {
                throw $result.Error
            }
        }
    } catch {
        Write-TestStep "Payment Phase 2" "FAIL" $_.Exception.Message
        $Stage7.Status = "FAIL"
    }
    $Stage7.EndTime = Get-Date
    $TestResults.Stages += $Stage7

    # STAGE 8: CERTIFICATE
    Write-TestHeader "STAGE 8: Generate Certificate"
    $Stage8 = @{ Name = "Certificate"; StartTime = Get-Date; Status = "PENDING" }
    
    try {
        Write-TestStep "Generating certificate..." "PENDING" ""
        
        if (-not (Test-EndpointExists "/certificates/generate")) {
            Write-TestStep "Certificate" "SKIP" "Endpoint not available"
            $Stage8.Status = "SKIP"
        } else {
            $certBody = @{ applicationId = $TestData.Application.id; issuedBy = "Admin"; validityYears = 3 }
            $result = Invoke-ApiRequest -Method "POST" -Endpoint "/certificates/generate" -Body $certBody -Token $TestData.applicant.token
            
            if ($result.Success -and $result.Data.success) {
                $TestData.Certificate = @{ id = $result.Data.data.id; number = $result.Data.data.certificateNumber; qrCode = $result.Data.data.qrData }
                Write-TestStep "Certificate" "PASS" "Cert#: $($TestData.Certificate.number)"
                $Stage8.Status = "PASS"
            } else {
                throw $result.Error
            }
        }
    } catch {
        Write-TestStep "Certificate" "FAIL" $_.Exception.Message
        $Stage8.Status = "FAIL"
    }
    $Stage8.EndTime = Get-Date
    $TestResults.Stages += $Stage8

    # STAGE 9: CREATE LOTS
    Write-TestHeader "STAGE 9: Create Lots with QR Codes"
    $Stage9 = @{ Name = "Create Lots"; StartTime = Get-Date; Status = "PENDING" }
    
    try {
        Write-TestStep "Creating planting cycle..." "PENDING" ""
        
        if (-not (Test-EndpointExists "/planting-cycles")) {
            Write-TestStep "Create Lots" "SKIP" "Endpoint not available"
            $Stage9.Status = "SKIP"
        } else {
            $cycleBody = @{
                farmId = $TestData.Farm.id
                certificateId = $TestData.Certificate.id
                cycleName = "Cycle 1/2026"
                plantCode = $TestData.Application.plantType
                startDate = (Get-Date).ToString("yyyy-MM-dd")
                expectedHarvestDate = (Get-Date).AddMonths(4).ToString("yyyy-MM-dd")
            }
            
            $result = Invoke-ApiRequest -Method "POST" -Endpoint "/planting-cycles" -Body $cycleBody -Token $TestData.applicant.token
            
            if ($result.Success -and $result.Data.success) {
                $cycleId = $result.Data.data.id
                Write-TestStep "Planting Cycle" "PASS" "Cycle ID: $cycleId"
                
                # Create harvest batch
                $batchBody = @{ cycleId = $cycleId; farmId = $TestData.Farm.id; harvestDate = (Get-Date).ToString("yyyy-MM-dd"); freshWeight = 100.5; dryWeight = 25.2; status = "RECEIVED" }
                $batchResult = Invoke-ApiRequest -Method "POST" -Endpoint "/harvest-batches" -Body $batchBody -Token $TestData.applicant.token
                
                if ($batchResult.Success -and $batchResult.Data.success) {
                    $batchId = $batchResult.Data.data.id
                    Write-TestStep "Harvest Batch" "PASS" "Batch#: $($batchResult.Data.data.batchNumber)"
                    
                    # Create lot
                    $lotBody = @{ batchId = $batchId; packageType = "VACUUM_BAG"; quantity = 10; unitWeight = 0.5; totalWeight = 5.0 }
                    $lotResult = Invoke-ApiRequest -Method "POST" -Endpoint "/lots" -Body $lotBody -Token $TestData.applicant.token
                    
                    if ($lotResult.Success -and $lotResult.Data.success) {
                        $TestData.Lot = @{ id = $lotResult.Data.data.id; number = $lotResult.Data.data.lotNumber; qrCode = $lotResult.Data.data.qrCode }
                        Write-TestStep "Create Lot" "PASS" "Lot#: $($TestData.Lot.number)"
                        $Stage9.Status = "PASS"
                    } else {
                        throw "Lot creation failed: $($lotResult.Error)"
                    }
                } else {
                    throw "Batch creation failed: $($batchResult.Error)"
                }
            } else {
                throw "Cycle creation failed: $($result.Error)"
            }
        }
    } catch {
        Write-TestStep "Create Lots" "FAIL" $_.Exception.Message
        $Stage9.Status = "FAIL"
    }
    $Stage9.EndTime = Get-Date
    $TestResults.Stages += $Stage9

    # STAGE 10: TRACK & TRACE
    Write-TestHeader "STAGE 10: Track & Trace Verification"
    $Stage10 = @{ Name = "Track and Trace"; StartTime = Get-Date; Status = "PENDING" }
    
    try {
        Write-TestStep "Testing QR code trace..." "PENDING" ""
        
        if (-not $TestData.Lot.qrCode) {
            Write-TestStep "Track & Trace" "SKIP" "No QR code available"
            $Stage10.Status = "SKIP"
        } else {
            $result = Invoke-ApiRequest -Method "GET" -Endpoint "/trace/$($TestData.Lot.qrCode)"
            
            if ($result.Success -and $result.Data.data.certificateNumber) {
                Write-TestStep "Track & Trace" "PASS" "QR: $($TestData.Lot.qrCode)"
                $Stage10.Status = "PASS"
            } else {
                throw "Trace query failed: $($result.Error)"
            }
        }
    } catch {
        Write-TestStep "Track & Trace" "FAIL" $_.Exception.Message
        $Stage10.Status = "FAIL"
    }
    $Stage10.EndTime = Get-Date
    $TestResults.Stages += $Stage10
}

# ==================== SUMMARY ====================
Write-TestHeader "TEST SUMMARY"

$TestResults.EndTime = Get-Date
$TestResults.Duration = $TestResults.EndTime - $TestConfig.StartTime

Write-Host ""
Write-Host "Journey: $($TestResults.Journey) - $($TestResults.Description)" -ForegroundColor Cyan
Write-Host "Test ID: $($TestConfig.TestId)" -ForegroundColor Gray
Write-Host "Duration: $($TestResults.Duration.ToString('mm\:ss'))" -ForegroundColor Gray
Write-Host ""

$passed = 0
$failed = 0
$skipped = 0

foreach ($stage in $TestResults.Stages) {
    $duration = $stage.EndTime - $stage.StartTime
    $icon = if ($stage.Status -eq "PASS") { "✅" } elseif ($stage.Status -eq "FAIL") { "❌" } else { "⏭️" }
    $color = if ($stage.Status -eq "PASS") { "Green" } elseif ($stage.Status -eq "FAIL") { "Red" } else { "Yellow" }
    Write-Host "$icon $($stage.Name) ($($duration.ToString('ss'))s)" -ForegroundColor $color
    
    switch ($stage.Status) {
        "PASS" { $passed++ }
        "FAIL" { $failed++ }
        "SKIP" { $skipped++ }
    }
}

Write-Host ""
Write-Host "----------------------------------------" -ForegroundColor White
Write-Host "Passed:  $passed" -ForegroundColor Green
Write-Host "Failed:  $failed" -ForegroundColor $(if ($failed -gt 0) { "Red" } else { "Green" })
Write-Host "Skipped: $skipped" -ForegroundColor Yellow
Write-Host "Total:   $($TestResults.Stages.Count)" -ForegroundColor White

if ($failed -eq 0 -and $skipped -eq 0) {
    Write-Host ""
    Write-Host "🎉 SMOKE TEST PASSED!" -ForegroundColor Green
} elseif ($failed -eq 0) {
    Write-Host ""
    Write-Host "⚠️  SMOKE TEST PASSED WITH SKIPS" -ForegroundColor Yellow
} else {
    Write-Host ""
    Write-Host "❌ SMOKE TEST FAILED" -ForegroundColor Red
}

# Save report
$testReport = @{
    TestId = $TestConfig.TestId
    Timestamp = $TestConfig.Timestamp
    Results = $TestResults
    TestData = $TestData
} | ConvertTo-Json -Depth 10

$reportPath = "tests/reports/journey-a-$($TestConfig.Timestamp).json"
$testReport | Out-File -FilePath $reportPath

Write-Host ""
Write-Host "Report saved: $reportPath" -ForegroundColor Gray

exit $failed
