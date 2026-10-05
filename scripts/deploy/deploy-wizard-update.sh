#!/bin/bash
# =============================================================
# GACP Wizard UX Update Deployment Script
# =============================================================
# Changes deployed:
# - Removed redundant service_type step (now 9 steps)
# - Converted all Accordion to flat UI
# - Fixed navigation flow
# =============================================================

set -e

echo "🚀 GACP Wizard UX Update Deployment"
echo "===================================="

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 1. Pull latest code
echo -e "${YELLOW}[1/5] Pulling latest code...${NC}"
git pull origin main

# 2. Build frontend with no cache (TSX files changed)
echo -e "${YELLOW}[2/5] Rebuilding frontend container...${NC}"
docker-compose build frontend --no-cache

# 3. Stop and recreate frontend
echo -e "${YELLOW}[3/5] Restarting frontend service...${NC}"
docker-compose up -d frontend

# 4. Wait for frontend to be healthy
echo -e "${YELLOW}[4/5] Waiting for frontend to be ready...${NC}"
sleep 10

# 5. Seed wizard configuration
echo -e "${YELLOW}[5/5] Updating wizard configuration in database...${NC}"
docker-compose exec -T backend node prisma/seed-wizard.js

echo ""
echo -e "${GREEN}✅ Deployment Complete!${NC}"
echo ""
echo "Changes applied:"
echo "  - 9-step wizard flow (no redundant steps)"
echo "  - Flat UI design (no Accordion)"
echo "  - Correct navigation between steps"
echo ""
echo "Test URL: https://gacpth.com/health/applications/new/step/1"
