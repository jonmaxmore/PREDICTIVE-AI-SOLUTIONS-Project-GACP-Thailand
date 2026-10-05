#!/bin/bash
# =============================================================================
# GACP Platform - API Client Generator
# "One Brain, Many Faces" Architecture
# =============================================================================
# This script generates API clients from OpenAPI specs for:
# - TypeScript (web-app)
# - Dart (mobile_app)
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
OPENAPI_DIR="$PROJECT_ROOT/openapi"
WEB_OUTPUT="$PROJECT_ROOT/apps/web-app/src/generated/api"
MOBILE_OUTPUT="$PROJECT_ROOT/apps/mobile_app/lib/generated/api"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "=========================================="
echo "   GACP API Client Generator"
echo "   One Brain, Many Faces Architecture"
echo "=========================================="

# Check if openapi-generator-cli is installed
if ! command -v openapi-generator-cli &> /dev/null; then
    echo -e "${YELLOW}Installing OpenAPI Generator CLI...${NC}"
    npm install -g @openapitools/openapi-generator-cli
fi

# Create output directories
mkdir -p "$WEB_OUTPUT"
mkdir -p "$MOBILE_OUTPUT"

# Array of service specs
SERVICES=(
    "auth-health"
    "application-service"
    "payment-service"
    "certificate-service"
    "audit-service"
    "authentication-service"
)

echo ""
echo -e "${GREEN}Generating TypeScript clients for web-app...${NC}"

for service in "${SERVICES[@]}"; do
    SPEC_FILE="$OPENAPI_DIR/$service.yaml"
    if [ -f "$SPEC_FILE" ]; then
        echo "  📦 Generating: $service"
        openapi-generator-cli generate \
            -i "$SPEC_FILE" \
            -g typescript-axios \
            -o "$WEB_OUTPUT/$service" \
            --additional-properties=supportsES6=true,npmName=@gacp/$service-client \
            --skip-validate-spec \
            2>/dev/null || echo -e "${YELLOW}    ⚠️ Warning: Some issues with $service${NC}"
    else
        echo -e "${YELLOW}  ⏭️  Skipping: $service (spec not found)${NC}"
    fi
done

echo ""
echo -e "${GREEN}Generating Dart clients for mobile_app...${NC}"

for service in "${SERVICES[@]}"; do
    SPEC_FILE="$OPENAPI_DIR/$service.yaml"
    if [ -f "$SPEC_FILE" ]; then
        echo "  📦 Generating: $service"
        openapi-generator-cli generate \
            -i "$SPEC_FILE" \
            -g dart \
            -o "$MOBILE_OUTPUT/$service" \
            --additional-properties=pubName=gacp_${service//-/_}_client \
            --skip-validate-spec \
            2>/dev/null || echo -e "${YELLOW}    ⚠️ Warning: Some issues with $service${NC}"
    else
        echo -e "${YELLOW}  ⏭️  Skipping: $service (spec not found)${NC}"
    fi
done

echo ""
echo -e "${GREEN}=========================================="
echo "   Generation Complete!"
echo "==========================================${NC}"
echo ""
echo "Generated clients:"
echo "  📁 TypeScript: $WEB_OUTPUT"
echo "  📁 Dart: $MOBILE_OUTPUT"
echo ""
echo "Next steps:"
echo "  1. Import generated clients in your code"
echo "  2. Run 'npm install' in web-app if needed"
echo "  3. Run 'flutter pub get' in mobile_app if needed"
echo ""
