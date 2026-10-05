# =============================================================================
# GACP Platform - API Client Generator (Windows PowerShell)
# "One Brain, Many Faces" Architecture
# =============================================================================

$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$OpenApiDir = Join-Path $ProjectRoot "openapi"
$WebOutput = Join-Path $ProjectRoot "apps\web-app\src\generated\api"
$MobileOutput = Join-Path $ProjectRoot "apps\mobile_app\lib\generated\api"

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "   GACP API Client Generator" -ForegroundColor Cyan
Write-Host "   One Brain, Many Faces Architecture" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

# Check if openapi-generator-cli is installed
try {
    $null = Get-Command openapi-generator-cli -ErrorAction Stop
    Write-Host "✓ OpenAPI Generator CLI found" -ForegroundColor Green
}
catch {
    Write-Host "Installing OpenAPI Generator CLI..." -ForegroundColor Yellow
    npm install -g @openapitools/openapi-generator-cli
}

# Create output directories
New-Item -ItemType Directory -Force -Path $WebOutput | Out-Null
New-Item -ItemType Directory -Force -Path $MobileOutput | Out-Null

# Services to generate
$Services = @(
    "auth-health",
    "application-service",
    "payment-service",
    "certificate-service",
    "audit-service",
    "authentication-service",
    "pricing-service",
    "access-service"
)

Write-Host ""
Write-Host "Generating TypeScript clients for web-app..." -ForegroundColor Green

foreach ($service in $Services) {
    $specFile = Join-Path $OpenApiDir "$service.yaml"
    if (Test-Path $specFile) {
        Write-Host "  📦 Generating: $service"
        $outputDir = Join-Path $WebOutput $service
        try {
            openapi-generator-cli generate `
                -i $specFile `
                -g typescript-axios `
                -o $outputDir `
                --additional-properties=supportsES6=true `
                --skip-validate-spec 2>$null
            Write-Host "    ✓ Done" -ForegroundColor Green
        }
        catch {
            Write-Host "    ⚠️ Warning: Some issues with $service" -ForegroundColor Yellow
        }
    }
    else {
        Write-Host "  ⏭️ Skipping: $service (spec not found)" -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "Generating Dart clients for mobile_app..." -ForegroundColor Green

foreach ($service in $Services) {
    $specFile = Join-Path $OpenApiDir "$service.yaml"
    if (Test-Path $specFile) {
        Write-Host "  📦 Generating: $service"
        $outputDir = Join-Path $MobileOutput $service
        $pubName = "gacp_" + ($service -replace "-", "_") + "_client"
        try {
            openapi-generator-cli generate `
                -i $specFile `
                -g dart `
                -o $outputDir `
                --additional-properties=pubName=$pubName `
                --skip-validate-spec 2>$null
            Write-Host "    ✓ Done" -ForegroundColor Green
        }
        catch {
            Write-Host "    ⚠️ Warning: Some issues with $service" -ForegroundColor Yellow
        }
    }
    else {
        Write-Host "  ⏭️ Skipping: $service (spec not found)" -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "   Generation Complete!" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Generated clients:"
Write-Host "  📁 TypeScript: $WebOutput"
Write-Host "  📁 Dart: $MobileOutput"
Write-Host ""
Write-Host "Next steps:"
Write-Host "  1. Import generated clients in your code"
Write-Host "  2. Run 'npm install' in web-app if needed"
Write-Host "  3. Run 'flutter pub get' in mobile_app if needed"
