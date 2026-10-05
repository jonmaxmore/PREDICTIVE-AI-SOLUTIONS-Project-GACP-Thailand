#!/bin/bash
# Deploy QA Server on Localhost
# Usage: ./scripts/deploy-qa-local.sh

set -e

echo "═══════════════════════════════════════════════════════════════"
echo "           🚀 Deploying QA Server on Localhost"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

log() {
    echo -e "${BLUE}[$(date +%H:%M:%S)]${NC} $1"
}

success() {
    echo -e "${GREEN}✓${NC} $1"
}

warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

error() {
    echo -e "${RED}✗${NC} $1"
}

# Check prerequisites
check_prerequisites() {
    log "Checking prerequisites..."
    
    if ! command -v docker &> /dev/null; then
        error "Docker not found. Please install Docker first."
        exit 1
    fi
    success "Docker found"
    
    if ! command -v docker-compose &> /dev/null; then
        error "Docker Compose not found. Please install Docker Compose first."
        exit 1
    fi
    success "Docker Compose found"
    
    # Check if ports are available
    log "Checking port availability..."
    
    for port in 3001 5001 5433 6380 8080; do
        if lsof -Pi :$port -sTCP:LISTEN -t >/dev/null 2>&1; then
            warning "Port $port is already in use"
        else
            success "Port $port is available"
        fi
    done
}

# Stop existing QA containers
stop_existing() {
    log "Stopping existing QA containers..."
    docker-compose -f docker-compose.qa.yml down --remove-orphans 2>/dev/null || true
    success "Existing containers stopped"
}

# Build images
build_images() {
    log "Building Docker images..."
    docker-compose -f docker-compose.qa.yml build --no-cache
    success "Images built"
}

# Start services
start_services() {
    log "Starting QA services..."
    docker-compose -f docker-compose.qa.yml up -d
    success "Services started"
}

# Wait for database
wait_for_db() {
    log "Waiting for database to be ready..."
    
    max_attempts=30
    attempt=1
    
    while [ $attempt -le $max_attempts ]; do
        if docker-compose -f docker-compose.qa.yml exec -T postgres-qa pg_isready -U gacp_qa -d gacp_qa_db >/dev/null 2>&1; then
            success "Database is ready"
            return 0
        fi
        
        echo -n "."
        sleep 2
        attempt=$((attempt + 1))
    done
    
    error "Database failed to start after $max_attempts attempts"
    return 1
}

# Run database migrations
run_migrations() {
    log "Running database migrations..."
    
    cd apps/backend
    
    # Set environment for QA
    export DATABASE_URL="postgresql://gacp_qa:qa_password_123@localhost:5433/gacp_qa_db"
    
    # Generate Prisma Client
    npx prisma generate
    
    # Run migrations
    npx prisma migrate deploy
    
    cd ../..
    
    success "Migrations completed"
}

# Seed test data
seed_data() {
    log "Seeding test data..."
    
    # Create seed script
    cat > /tmp/qa_seed.sql << 'EOF'
-- Seed test data for QA environment

-- Insert test users
INSERT INTO "User" (id, email, phone, "firstName", "lastName", "idCardHash", "passwordHash", role, status, "createdAt", "updatedAt") VALUES
('user-001', 'Applicant1@qa.test', '0811111111', 'สมชาย', 'ใจดี', 'hash001', '$2b$12$testhash', 'Applicant', 'ACTIVE', NOW(), NOW()),
('user-002', 'Applicant2@qa.test', '0822222222', 'สมหญิง', 'รักดี', 'hash002', '$2b$12$testhash', 'Applicant', 'ACTIVE', NOW(), NOW()),
('PROVIDER-001', 'provider@qa.test', '0833333333', 'เจ้าหน้าที่', 'ตรวจสอบ', 'hash003', '$2b$12$testhash', 'PROVIDER', 'ACTIVE', NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- Insert test farms
INSERT INTO "Farm" (id, "ownerId", name, description, address, province, "districtCode", "areaRai", "areaNgan", "areaSqWa", latitude, longitude, "landCertificateNo", "landType", status, "createdAt", "updatedAt") VALUES
('farm-001', 'user-001', 'สวนผักสมุนไทยแม่ริม', 'ฟาร์มปลูกกัญชาอินทรีย์', '123 หมู่ 4 ต.แม่ริม', 'เชียงใหม่', '50180', 5, 2, 50, 18.796143, 98.979263, '1234', 'OWNED', 'ACTIVE', NOW(), NOW()),
('farm-002', 'user-002', 'ฟาร์มกัญชาออร์แกนิค', 'ฟาร์มปลูกกัญชาคุณภาพ', '456 หมู่ 2 ต.สันกำแพง', 'เชียงใหม่', '50130', 10, 0, 0, 18.785, 99.012, '5678', 'OWNED', 'ACTIVE', NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- Insert test applications
INSERT INTO "Application" (id, "applicationNumber", "applicantId", "farmId", "plantId", "plantType", status, "submittedAt", "createdAt", "updatedAt") VALUES
('app-001', 'APP-2025-000001', 'user-001', 'farm-001', 'plant-001', 'CANNABIS', 'PENDING', NOW(), NOW(), NOW()),
('app-002', 'APP-2025-000002', 'user-002', 'farm-002', 'plant-001', 'CANNABIS', 'UNDER_REVIEW', NOW(), NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

EOF

    # Execute seed
    docker-compose -f docker-compose.qa.yml exec -T postgres-qa psql -U gacp_qa -d gacp_qa_db -f /tmp/qa_seed.sql 2>/dev/null || warning "Seed data may already exist"
    
    success "Test data seeded"
}

# Health check
health_check() {
    log "Performing health checks..."
    
    # Check Backend
    if curl -s http://localhost:5001/api/health > /dev/null; then
        success "Backend API is healthy (http://localhost:5001)"
    else
        warning "Backend API health check failed"
    fi
    
    # Check Frontend
    if curl -s http://localhost:3001 > /dev/null; then
        success "Frontend is accessible (http://localhost:3001)"
    else
        warning "Frontend health check failed"
    fi
    
    # Check Nginx
    if curl -s http://localhost:8080/health > /dev/null; then
        success "Nginx proxy is healthy (http://localhost:8080)"
    else
        warning "Nginx health check failed"
    fi
}

# Print summary
print_summary() {
    echo ""
    echo "═══════════════════════════════════════════════════════════════"
    echo "              ✅ QA Server Deployed Successfully!"
    echo "═══════════════════════════════════════════════════════════════"
    echo ""
    echo "📱 Access URLs:"
    echo "   • Frontend:     http://localhost:3001"
    echo "   • Backend API:  http://localhost:5001"
    echo "   • Nginx Proxy:  http://localhost:8080"
    echo ""
    echo "🗄️  Database:"
    echo "   • PostgreSQL:   localhost:5433"
    echo "   • Database:     gacp_qa_db"
    echo "   • Username:     gacp_qa"
    echo "   • Password:     qa_password_123"
    echo ""
    echo "⚡ Redis:"
    echo "   • Host:         localhost:6380"
    echo ""
    echo "📋 Useful Commands:"
    echo "   • View logs:    docker-compose -f docker-compose.qa.yml logs -f"
    echo "   • Stop:         docker-compose -f docker-compose.qa.yml down"
    echo "   • Restart:      docker-compose -f docker-compose.qa.yml restart"
    echo ""
    echo "🧪 Run Tests:"
    echo "   • Backend:      cd apps/backend && npm test"
    echo ""
    echo "═══════════════════════════════════════════════════════════════"
}

# Main execution
main() {
    check_prerequisites
    stop_existing
    build_images
    start_services
    wait_for_db
    run_migrations
    seed_data
    health_check
    print_summary
}

# Run main function
main
