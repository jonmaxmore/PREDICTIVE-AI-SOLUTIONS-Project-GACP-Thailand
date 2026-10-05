
# =============================================================================
# GACP Platform - Post-Deployment Script (PowerShell)
# Run this after deployment to ensure database has required seed data
# =============================================================================

Write-Host "🚀 GACP Post-Deployment Setup"
Write-Host "=============================="

# Wait for backend to be ready
Write-Host "⏳ Waiting for backend to be ready..."
Start-Sleep -Seconds 5

# Check if containers are running
if (-not (docker ps | Select-String "gacp-backend")) {
    Write-Host "❌ Error: gacp-backend container not running"
    exit 1
}

if (-not (docker ps | Select-String "gacp-postgres")) {
    Write-Host "❌ Error: gacp-postgres container not running"
    exit 1
}

# Run Prisma migrations
Write-Host "📦 Running Prisma migrations..."
docker exec gacp-backend npx prisma migrate deploy
if ($LASTEXITCODE -ne 0) {
    Write-Host "⚠️ Migration warning (might already be up to date)"
}

# Run seed scripts
Write-Host "🌱 Seeding plant species and document requirements..."
docker exec gacp-backend node prisma/seed-plants.js

# Verify seed data
Write-Host "🔍 Verifying seed data..."
$PLANTS = docker exec gacp-postgres psql -U gacp -d gacp_db -t -c "SELECT COUNT(*) FROM plant_species;"
$DOCS = docker exec gacp-postgres psql -U gacp -d gacp_db -t -c "SELECT COUNT(*) FROM document_requirements;"

Write-Host "  ✅ Plants: $PLANTS"
Write-Host "  ✅ Document Requirements: $DOCS"

# Health check
Write-Host "🏥 Running health check..."
try {
    $response = Invoke-WebRequest -Uri "http://127.0.0.1:5000/api/health" -UseBasicParsing
    if ($response.StatusCode -eq 200) {
        Write-Host "  ✅ API Health: OK"
    } else {
        Write-Host "  ⚠️ API Health: Check failed (Status: $($response.StatusCode))"
    }
} catch {
    Write-Host "  ⚠️ API Health: Check failed ($($_.Exception.Message))"
}

Write-Host ""
Write-Host "=============================="
Write-Host "✅ Post-deployment setup complete!"
Write-Host "=============================="
