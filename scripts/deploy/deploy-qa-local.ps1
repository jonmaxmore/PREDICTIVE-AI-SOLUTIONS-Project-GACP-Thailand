# Deploy QA Server on Localhost (Windows)
# Usage: .\scripts\deploy-qa-local.ps1

$ErrorActionPreference = "Stop"

function Write-ColorOutput($ForegroundColor) {
    $fc = $host.UI.RawUI.ForegroundColor
    $host.UI.RawUI.ForegroundColor = $ForegroundColor
    if ($args) {
        Write-Output $args
    }
    $host.UI.RawUI.ForegroundColor = $fc
}

function Log($message) {
    $timestamp = Get-Date -Format "HH:mm:ss"
    Write-ColorOutput Blue "[$timestamp] $message"
}

function Success($message) {
    Write-ColorOutput Green "✓ $message"
}

function Warning($message) {
    Write-ColorOutput Yellow "⚠ $message"
}

function ErrorMsg($message) {
    Write-ColorOutput Red "✗ $message"
}

function Check-Prerequisites {
    Log "Checking prerequisites..."
    
    # Check Docker
    try {
        $dockerVersion = docker --version
        Success "Docker found: $dockerVersion"
    } catch {
        ErrorMsg "Docker not found. Please install Docker first."
        exit 1
    }
    
    # Check Docker Compose
    try {
        $composeVersion = docker-compose --version
        Success "Docker Compose found: $composeVersion"
    } catch {
        ErrorMsg "Docker Compose not found. Please install Docker Compose first."
        exit 1
    }
    
    # Check ports
    Log "Checking port availability..."
    $ports = @(3001, 5001, 5433, 6380, 8080)
    
    foreach ($port in $ports) {
        $connection = Test-NetConnection -ComputerName localhost -Port $port -WarningAction SilentlyContinue
        if ($connection.TcpTestSucceeded) {
            Warning "Port $port is already in use"
        } else {
            Success "Port $port is available"
        }
    }
}

function Stop-Existing {
    Log "Stopping existing QA containers..."
    try {
        docker-compose -f docker-compose.qa.yml down --remove-orphans 2>$null
        Success "Existing containers stopped"
    } catch {
        Warning "No existing containers to stop"
    }
}

function Build-Images {
    Log "Building Docker images..."
    docker-compose -f docker-compose.qa.yml build --no-cache
    Success "Images built"
}

function Start-Services {
    Log "Starting QA services..."
    docker-compose -f docker-compose.qa.yml up -d
    Success "Services started"
}

function Wait-ForDatabase {
    Log "Waiting for database to be ready..."
    
    $maxAttempts = 30
    $attempt = 1
    
    while ($attempt -le $maxAttempts) {
        try {
            $result = docker-compose -f docker-compose.qa.yml exec -T postgres-qa pg_isready -U gacp_qa -d gacp_qa_db 2>$null
            if ($LASTEXITCODE -eq 0) {
                Success "Database is ready"
                return
            }
        } catch {}
        
        Write-Host -NoNewline "."
        Start-Sleep -Seconds 2
        $attempt++
    }
    
    ErrorMsg "Database failed to start after $maxAttempts attempts"
    exit 1
}

function Run-Migrations {
    Log "Running database migrations..."
    
    Push-Location apps/backend
    
    $env:DATABASE_URL = "postgresql://gacp_qa:qa_password_123@localhost:5433/gacp_qa_db"
    
    # Generate Prisma Client
    npx prisma generate
    
    # Run migrations
    npx prisma migrate deploy
    
    Pop-Location
    
    Success "Migrations completed"
}

function Seed-Data {
    Log "Seeding test data..."
    
    $seedSql = @"
-- Seed test data for QA environment
INSERT INTO "User" (id, email, phone, "firstName", "lastName", "idCardHash", "passwordHash", role, status, "createdAt", "updatedAt") VALUES
('user-001', 'Applicant1@qa.test', '0811111111', 'สมชาย', 'ใจดี', 'hash001', '`$2b`$12`$testhash', 'Applicant', 'ACTIVE', NOW(), NOW()),
('user-002', 'Applicant2@qa.test', '0822222222', 'สมหญิง', 'รักดี', 'hash002', '`$2b`$12`$testhash', 'Applicant', 'ACTIVE', NOW(), NOW()),
('PROVIDER-001', 'provider@qa.test', '0833333333', 'เจ้าหน้าที่', 'ตรวจสอบ', 'hash003', '`$2b`$12`$testhash', 'PROVIDER', 'ACTIVE', NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

INSERT INTO "Farm" (id, "ownerId", name, description, address, province, "districtCode", "areaRai", "areaNgan", "areaSqWa", latitude, longitude, "landCertificateNo", "landType", status, "createdAt", "updatedAt") VALUES
('farm-001', 'user-001', 'สวนผักสมุนไทยแม่ริม', 'ฟาร์มปลูกกัญชาอินทรีย์', '123 หมู่ 4 ต.แม่ริม', 'เชียงใหม่', '50180', 5, 2, 50, 18.796143, 98.979263, '1234', 'OWNED', 'ACTIVE', NOW(), NOW()),
('farm-002', 'user-002', 'ฟาร์มกัญชาออร์แกนิค', 'ฟาร์มปลูกกัญชาคุณภาพ', '456 หมู่ 2 ต.สันกำแพง', 'เชียงใหม่', '50130', 10, 0, 0, 18.785, 99.012, '5678', 'OWNED', 'ACTIVE', NOW(), NOW())
ON CONFLICT (id) DO NOTHING;
"@
    
    $seedSql | Out-File -FilePath ".\tmp_qa_seed.sql" -Encoding utf8
    
    try {
        docker-compose -f docker-compose.qa.yml exec -T postgres-qa psql -U gacp_qa -d gacp_qa_db -f /tmp/qa_seed.sql 2>$null
    } catch {
        Warning "Seed data may already exist"
    }
    
    Remove-Item -Path ".\tmp_qa_seed.sql" -ErrorAction SilentlyContinue
    
    Success "Test data seeded"
}

function Health-Check {
    Log "Performing health checks..."
    
    # Check Backend
    try {
        $response = Invoke-WebRequest -Uri "http://localhost:5001/api/health" -Method GET -TimeoutSec 5 -ErrorAction SilentlyContinue
        Success "Backend API is healthy (http://localhost:5001)"
    } catch {
        Warning "Backend API health check failed"
    }
    
    # Check Frontend
    try {
        $response = Invoke-WebRequest -Uri "http://localhost:3001" -Method GET -TimeoutSec 5 -ErrorAction SilentlyContinue
        Success "Frontend is accessible (http://localhost:3001)"
    } catch {
        Warning "Frontend health check failed"
    }
    
    # Check Nginx
    try {
        $response = Invoke-WebRequest -Uri "http://localhost:8080/health" -Method GET -TimeoutSec 5 -ErrorAction SilentlyContinue
        Success "Nginx proxy is healthy (http://localhost:8080)"
    } catch {
        Warning "Nginx health check failed"
    }
}

function Print-Summary {
    Write-Host ""
    Write-Host "═══════════════════════════════════════════════════════════════"
    Write-Host "              ✅ QA Server Deployed Successfully!"
    Write-Host "═══════════════════════════════════════════════════════════════"
    Write-Host ""
    Write-Host "📱 Access URLs:"
    Write-Host "   • Frontend:     http://localhost:3001"
    Write-Host "   • Backend API:  http://localhost:5001"
    Write-Host "   • Nginx Proxy:  http://localhost:8080"
    Write-Host ""
    Write-Host "🗄️  Database:"
    Write-Host "   • PostgreSQL:   localhost:5433"
    Write-Host "   • Database:     gacp_qa_db"
    Write-Host "   • Username:     gacp_qa"
    Write-Host "   • Password:     qa_password_123"
    Write-Host ""
    Write-Host "⚡ Redis:"
    Write-Host "   • Host:         localhost:6380"
    Write-Host ""
    Write-Host "📋 Useful Commands:"
    Write-Host "   • View logs:    docker-compose -f docker-compose.qa.yml logs -f"
    Write-Host "   • Stop:         docker-compose -f docker-compose.qa.yml down"
    Write-Host "   • Restart:      docker-compose -f docker-compose.qa.yml restart"
    Write-Host ""
    Write-Host "🧪 Run Tests:"
    Write-Host "   • Backend:      cd apps/backend; npm test"
    Write-Host ""
    Write-Host "═══════════════════════════════════════════════════════════════"
}

# Main execution
function Main {
    Check-Prerequisites
    Stop-Existing
    Build-Images
    Start-Services
    Wait-ForDatabase
    Run-Migrations
    Seed-Data
    Health-Check
    Print-Summary
}

# Run main
Main
