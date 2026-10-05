#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Deploy GACP Platform locally with production-like configuration
.DESCRIPTION
    This script sets up a local production-like environment with:
    - Nginx with SSL (self-signed)
    - PostgreSQL + Redis
    - Backend + Frontend (production builds)
    - Mobile API support
.PARAMETER Action
    Action to perform: setup, start, stop, logs, clean
.PARAMETER WithMobile
    Include mobile app build (requires Android SDK or Xcode)
.EXAMPLE
    .\scripts\local-deploy.ps1 setup
    .\scripts\local-deploy.ps1 start
    .\scripts\local-deploy.ps1 logs
    .\scripts\local-deploy.ps1 stop
    .\scripts\local-deploy.ps1 clean
#>

param(
    [Parameter(Mandatory=$true)]
    [ValidateSet("setup", "start", "stop", "logs", "clean", "status")]
    [string]$Action,
    
    [switch]$WithMobile
)

$ProjectName = "gacp-local"
$ComposeFile = "docker-compose.local-prod.yml"
$SslDir = "nginx/ssl/local"
$HostsEntry = "127.0.0.1 localhost gacp.local api.gacp.local"

function Write-Header($text) {
    Write-Host "`n========================================" -ForegroundColor Cyan
    Write-Host $text -ForegroundColor Cyan
    Write-Host "========================================`n" -ForegroundColor Cyan
}

function Test-Command($command) {
    return [bool](Get-Command -Name $command -ErrorAction SilentlyContinue)
}

function Add-HostsEntry {
    $hostsPath = "$env:SystemRoot\System32\drivers\etc\hosts"
    if (-not (Select-String -Path $hostsPath -Pattern "gacp.local" -Quiet)) {
        Write-Host "Adding gacp.local to hosts file (requires admin)..." -ForegroundColor Yellow
        try {
            Add-Content -Path $hostsPath -Value "`n$HostsEntry" -Force
            Write-Host "✅ Hosts entry added" -ForegroundColor Green
        } catch {
            Write-Host "⚠️  Could not add hosts entry automatically. Please add manually:" -ForegroundColor Red
            Write-Host $HostsEntry -ForegroundColor Yellow
        }
    }
}

function Initialize-SslCertificates {
    Write-Header "Generating SSL Certificates"
    
    if (-not (Test-Path $SslDir)) {
        New-Item -ItemType Directory -Path $SslDir -Force | Out-Null
    }
    
    if (-not (Test-Path "$SslDir/localhost.crt")) {
        Write-Host "Generating self-signed SSL certificates..." -ForegroundColor Yellow
        
        # Generate using OpenSSL (requires Git or OpenSSL installed)
        $openssl = "openssl"
        if (-not (Test-Command $openssl)) {
            # Try to find openssl from Git
            $gitOpenssl = "C:\Program Files\Git\usr\bin\openssl.exe"
            if (Test-Path $gitOpenssl) {
                $openssl = $gitOpenssl
            } else {
                Write-Host "❌ OpenSSL not found. Please install Git for Windows or OpenSSL" -ForegroundColor Red
                exit 1
            }
        }
        
        & $openssl req -x509 -nodes -days 365 -newkey rsa:2048 `
            -keyout "$SslDir/localhost.key" `
            -out "$SslDir/localhost.crt" `
            -subj "/CN=localhost/O=GACP Local/C=TH" `
            -addext "subjectAltName=DNS:localhost,DNS:gacp.local,DNS:api.gacp.local,IP:127.0.0.1" `
            2>$null
        
        if ($LASTEXITCODE -eq 0) {
            Write-Host "✅ SSL certificates generated" -ForegroundColor Green
            Write-Host "   Location: $SslDir/" -ForegroundColor Gray
        } else {
            Write-Host "❌ Failed to generate SSL certificates" -ForegroundColor Red
            exit 1
        }
    } else {
        Write-Host "✅ SSL certificates already exist" -ForegroundColor Green
    }
}

function Initialize-Environment {
    Write-Header "Environment Setup"
    
    # Create .env file if not exists
    $envFile = ".env.local"
    if (-not (Test-Path $envFile)) {
        @"
# Local Production-like Environment
NODE_ENV=production
DB_USER=gacp
DB_PASSWORD=change-me-local
DB_NAME=gacp_db
JWT_SECRET=local-jwt-secret-$(Get-Random -Maximum 99999)
DTAM_JWT_SECRET=local-dtam-secret-$(Get-Random -Maximum 99999)

# Mobile Support
MOBILE_API_ENABLED=true
ALLOW_EMULATOR_TRAFFIC=true

# Payment (Mock mode for local)
PAYMENT_GATEWAY=MOCK
PAYMENT_PUBLIC_KEY=pk_test_local
PAYMENT_SECRET_KEY=sk_test_local

"@ | Out-File -FilePath $envFile -Encoding UTF8
        Write-Host "✅ Created $envFile" -ForegroundColor Green
    }
    
    # Create logs directory
    if (-not (Test-Path "logs/nginx")) {
        New-Item -ItemType Directory -Path "logs/nginx" -Force | Out-Null
    }
}

function Start-LocalDeploy {
    Write-Header "Starting Local Production Deployment"
    
    # Check Docker
    if (-not (Test-Command "docker")) {
        Write-Host "❌ Docker not found. Please install Docker Desktop" -ForegroundColor Red
        exit 1
    }
    
    if (-not (Test-Command "docker-compose") -and -not (Test-Command "docker")) {
        Write-Host "❌ Docker Compose not found" -ForegroundColor Red
        exit 1
    }
    
    Initialize-SslCertificates
    Initialize-Environment
    
    # Pull latest images
    Write-Host "Pulling latest images..." -ForegroundColor Yellow
    docker-compose -f $ComposeFile pull
    
    # Build and start
    Write-Host "Building and starting services..." -ForegroundColor Yellow
    docker-compose -f $ComposeFile up -d --build
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "`n✅ Deployment successful!" -ForegroundColor Green
        Write-Host "`n📱 Access Points:" -ForegroundColor Cyan
        Write-Host "   Web App:     https://localhost" -ForegroundColor White
        Write-Host "   API Docs:    https://localhost/api-docs" -ForegroundColor White
        Write-Host "   Health:      https://localhost/api/health" -ForegroundColor White
        Write-Host "   Swagger UI:  https://localhost/api-docs" -ForegroundColor White
        Write-Host "`n⚠️  Note: Accept the self-signed certificate warning in your browser" -ForegroundColor Yellow
        Write-Host "   Mobile API:  https://192.168.x.x (for device testing)" -ForegroundColor Gray
    } else {
        Write-Host "❌ Deployment failed" -ForegroundColor Red
        exit 1
    }
}

function Stop-LocalDeploy {
    Write-Header "Stopping Local Deployment"
    docker-compose -f $ComposeFile down
    Write-Host "✅ Services stopped" -ForegroundColor Green
}

function Show-Logs {
    param([string]$Service = "")
    
    if ($Service) {
        docker-compose -f $ComposeFile logs -f $Service
    } else {
        docker-compose -f $ComposeFile logs -f
    }
}

function Clear-LocalDeploy {
    Write-Header "Cleaning Up"
    docker-compose -f $ComposeFile down -v --remove-orphans
    
    # Ask before deleting SSL certs
    $deleteCerts = Read-Host "Delete SSL certificates? (y/N)"
    if ($deleteCerts -eq "y" -or $deleteCerts -eq "Y") {
        Remove-Item -Path $SslDir -Recurse -Force -ErrorAction SilentlyContinue
        Write-Host "✅ SSL certificates deleted" -ForegroundColor Green
    }
    
    Write-Host "✅ Cleanup complete" -ForegroundColor Green
}

function Show-Status {
    Write-Header "Deployment Status"
    docker-compose -f $ComposeFile ps
    
    Write-Host "`n🔗 Endpoints:" -ForegroundColor Cyan
    Write-Host "   https://localhost" -ForegroundColor White
    Write-Host "   https://localhost/api/health" -ForegroundColor White
}

# Main execution
switch ($Action) {
    "setup" {
        Initialize-SslCertificates
        Initialize-Environment
        Add-HostsEntry
        Write-Host "`n✅ Setup complete. Run './scripts/local-deploy.ps1 start' to begin" -ForegroundColor Green
    }
    "start" { Start-LocalDeploy }
    "stop" { Stop-LocalDeploy }
    "logs" { Show-Logs }
    "clean" { Clear-LocalDeploy }
    "status" { Show-Status }
}
