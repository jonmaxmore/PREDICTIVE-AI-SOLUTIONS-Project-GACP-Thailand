# GACP Platform API Documentation (OpenAPI 3.0)

Complete OpenAPI 3.0.3 specifications for all 5 Core Services.

## 📋 Overview

This directory contains comprehensive OpenAPI (Swagger) specifications for the GACP Platform microservices architecture.

**Total Services:** 5  
**Total Endpoints:** 24  
**Total Schemas:** 75+  
**OpenAPI Version:** 3.0.3

---

## 🗂️ Service Documentation

### 1. Authentication Service

**File:** `authentication-service.yaml`  
**Base URL:** `/v1/auth`  
**Endpoints:** 6

#### Key Features

- ✅ User registration (Applicant, DTAM)
- ✅ JWT authentication (RS256)
- ✅ Token refresh mechanism
- ✅ Thai ID validation (Mod 11)
- ✅ Rate limiting (5 requests/15min)
- ✅ Account lockout (30min after 5 failures)

#### Endpoints

- `POST /register` - Register new user
- `POST /login` - Authenticate and get JWT
- `POST /refresh` - Refresh access token
- `POST /logout` - Invalidate session
- `GET /me` - Get current user profile
- `POST /change-password` - Change password

---

### 2. Application Service

**File:** `application-service.yaml`  
**Base URL:** `/v1/applications`  
**Endpoints:** 8

#### Key Features

- ✅ 12-state workflow (FSM)
- ✅ Document upload/validation
- ✅ DTAM review workflow
- ✅ GPS coordinates validation
- ✅ Thai address format
- ✅ Timeline tracking

#### Application States

1. DRAFT
2. SUBMITTED
3. UNDER_REVIEW
4. PAYMENT_PENDING
5. PAYMENT_VERIFIED
6. INSPECTION_SCHEDULED
7. INSPECTION_COMPLETED
8. PHASE2_PAYMENT_PENDING
9. PHASE2_PAYMENT_VERIFIED
10. APPROVED
11. CERTIFICATE_ISSUED
12. REJECTED
13. REVISION_REQUIRED
14. EXPIRED

#### Endpoints

- `GET /applications` - List applications
- `POST /applications` - Create application
- `GET /applications/{id}` - Get application
- `PATCH /applications/{id}` - Update application
- `POST /applications/{id}/submit` - Submit application
- `POST /applications/{id}/review` - DTAM review
- `POST /applications/{id}/documents` - Upload document
- `GET /applications/{id}/timeline` - Get timeline

---

### 3. Payment Service

**File:** `payment-service.yaml`  
**Base URL:** `/v1/payments`  
**Endpoints:** 5

#### Key Features

- ✅ PromptPay QR generation (BOT v2.1)
- ✅ Credit card (Omise + 3D Secure)
- ✅ Thai tax invoice/receipt (VAT 7%)
- ✅ Webhook handling
- ❌ No refunds (All payments are non-refundable)

#### Payment Methods

- **PromptPay QR** - Bank of Thailand standard v2.1
- **Credit/Debit Card** - Omise (PCI DSS Level 1)

#### Payment Phases

- Phase 1: ฿5,000 (Application fee)
- Phase 2: ฿25,000 (Inspection fee)

#### Endpoints

- `POST /invoices` - Create invoice
- `GET /invoices/{id}` - Get invoice
- `POST /invoices/{id}/promptpay` - Generate PromptPay QR
- `POST /invoices/{id}/creditcard` - Pay with credit card
- `GET /invoices/{id}/receipt` - Download tax receipt
- `POST /webhooks/omise` - Omise webhook (Internal)

---

### 4. Certificate Service

**File:** `certificate-service.yaml`  
**Base URL:** `/v1/certificates`  
**Endpoints:** 7

#### Key Features

- ✅ Auto-generate on APPROVED
- ✅ PDF/A-1b format (ISO 19005-1)
- ✅ Digital signature (RSA-2048 + SHA-256)
- ✅ QR verification (Public)
- ✅ 3-year validity
- ✅ Revocation system
- ✅ Renewal workflow

#### Certificate States

- ACTIVE - Valid and usable
- EXPIRING_SOON - 30 days before expiry
- EXPIRED - Past validity date
- REVOKED - Manually revoked

#### Endpoints

- `GET /certificates` - List certificates
- `POST /certificates` - Generate certificate (Auto)
- `GET /certificates/{id}` - Get certificate
- `GET /certificates/{id}/download` - Download PDF
- `GET /api/v1/public/verify/{number}` - Verify certificate (Public)
- `GET /certificates/{id}/qr` - Get QR code
- `POST /certificates/{id}/revoke` - Revoke certificate (DTAM)
- `POST /certificates/{id}/renew` - Renew certificate

---

### 5. Audit Service

**File:** `audit-service.yaml`  
**Base URL:** `/v1/audit`  
**Endpoints:** 5

#### Key Features

- ✅ Immutable logs (blockchain-like)
- ✅ SHA-256 hash chain
- ✅ 7-year retention
- ✅ Full-text search (Elasticsearch)
- ✅ GDPR compliance
- ✅ Timeline reconstruction

#### Event Categories

1. AUTHENTICATION - Login, logout, password changes
2. APPLICATION - Application lifecycle events
3. PAYMENT - Payment and refund events
4. CERTIFICATE - Certificate generation/revocation
5. ADMIN - Administrative actions
6. SECURITY - Security-related events

#### Severity Levels

- INFO - Informational events
- WARNING - Warning events
- ERROR - Error events
- CRITICAL - Critical security events

#### Endpoints

- `POST /logs` - Create audit log (Internal)
- `GET /logs` - List audit logs
- `GET /logs/{id}` - Get audit log details
- `POST /logs/search` - Advanced search
- `GET /timeline/{type}/{id}` - Get resource timeline
- `POST /verify/chain` - Verify hash chain integrity

---

## 🚀 Usage

### View Documentation (Swagger UI)

#### Option 1: Swagger Editor (Online)

1. Go to https://editor.swagger.io
2. Copy YAML content from any service file
3. Paste into editor
4. View interactive documentation

#### Option 2: Local Swagger UI (Docker)

```bash
# Run Swagger UI container
docker run -p 8080:8080 \
  -e SWAGGER_JSON_URL=https://raw.githubusercontent.com/your-org/gacp-platform/main/openapi/authentication-service.yaml \
  swaggerapi/swagger-ui

# Open http://localhost:8080
```

#### Option 3: VS Code Extension

1. Install "Swagger Viewer" extension
2. Open any `.yaml` file
3. Press `Shift+Alt+P` → "Preview Swagger"

---

## 🔧 Generate API Clients

### TypeScript (Frontend)

```bash
# Install OpenAPI Generator
npm install -g @openapitools/openapi-generator-cli

# Generate TypeScript client
openapi-generator-cli generate \
  -i openapi/authentication-service.yaml \
  -g typescript-axios \
  -o frontend/src/api/auth
```

### Node.js (Backend)

```bash
# Generate Node.js client
openapi-generator-cli generate \
  -i openapi/authentication-service.yaml \
  -g typescript-node \
  -o backend/src/api/auth
```

### Other Languages

- Python: `-g python`
- Java: `-g java`
- PHP: `-g php`
- Ruby: `-g ruby`

---

## 🧪 API Testing

### Postman Collection

```bash
# Convert OpenAPI to Postman collection
npm install -g openapi-to-postmanv2

openapi2postmanv2 \
  -s openapi/authentication-service.yaml \
  -o postman/authentication-service.json
```

### cURL Examples

#### Register User

```bash
curl -X POST https://api.gacp.platform/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "Applicant@example.com",
    "password": "SecurePass123!",
    "fullName": "สมชาย ใจดี",
    "role": "Applicant",
    "thaiId": "1234567890123",
    "phoneNumber": "0812345678"
  }'
```

#### Login

```bash
curl -X POST https://api.gacp.platform/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "Applicant@example.com",
    "password": "SecurePass123!"
  }'
```

#### Get User Profile

```bash
curl -X GET https://api.gacp.platform/v1/auth/me \
  -H "Authorization: Bearer <ACCESS_TOKEN>"
```

---

## 📊 Validation

### Validate OpenAPI Specs

```bash
# Install validator
npm install -g swagger-cli

# Validate all specs
swagger-cli validate openapi/authentication-service.yaml
swagger-cli validate openapi/application-service.yaml
swagger-cli validate openapi/payment-service.yaml
swagger-cli validate openapi/certificate-service.yaml
swagger-cli validate openapi/audit-service.yaml
```

---

## 🔐 Security

### Authentication

All endpoints (except public verification) require JWT Bearer token:

```http
Authorization: Bearer <access_token>
```

### Token Types

- **Access Token**: 15 minutes validity
- **Refresh Token**: 7 days validity

### Rate Limiting

- Authentication: 5 requests per 15 minutes
- General API: 100 requests per minute
- Public endpoints: 10 requests per minute

---

## 🌍 Environments

| Environment | Base URL                            |
| ----------- | ----------------------------------- |
| Production  | `https://api.gacp.platform`         |
| Staging     | `https://staging-api.gacp.platform` |
| Development | `http://localhost:3000`             |

### Service Ports (Development)

- Authentication Service: `3001`
- Application Service: `3002`
- Payment Service: `3003`
- Certificate Service: `3004`
- Audit Service: `3005`

---

## 📚 Standards & Compliance

### OpenAPI 3.0.3

- Follows OpenAPI 3.0.3 specification
- Complete request/response schemas
- Security schemes defined
- Examples for all operations

### Research-Based Design

- **ISO 27001** - Information security
- **ISO 19005-1** - PDF/A-1b archival format
- **ISO 18004** - QR code standard
- **PCI DSS Level 1** - Payment security
- **OWASP Top 10** - Security best practices
- **NIST SP 800-63B** - Digital identity guidelines
- **Bank of Thailand** - PromptPay v2.1 standard
- **Thai Revenue Department** - Tax regulations

---

## 🔄 Versioning

### API Version: v1

All endpoints use `/v1/` prefix.

### Breaking Changes

Breaking changes will be introduced in new versions (e.g., `/v2/`).

### Deprecation Policy

- 6 months notice before deprecation
- Parallel support for 1 year
- Clear migration guide provided

---

## 📝 Changelog

### Version 1.0.0 (2025-10-16)

- ✅ Initial OpenAPI 3.0.3 specifications
- ✅ 5 Core Services documented
- ✅ 25+ endpoints with full schemas
- ✅ Security schemes defined
- ✅ Examples for all operations
- ✅ Error handling documented

---

## 🤝 Contributing

### Adding New Endpoints

1. Update appropriate service YAML file
2. Follow existing schema patterns
3. Add request/response examples
4. Validate with `swagger-cli`
5. Update this README

### Best Practices

- ✅ Use semantic operation IDs
- ✅ Provide clear descriptions
- ✅ Include all required parameters
- ✅ Document all error responses
- ✅ Add realistic examples
- ✅ Follow RESTful conventions

---

## 📞 Support

**Technical Issues:** api-support@gacp.platform  
**Documentation:** docs@gacp.platform  
**Security:** security@gacp.platform

---

## 📄 License

© 2025 GACP Platform. All rights reserved.

---

**Generated:** 2025-10-16  
**OpenAPI Version:** 3.0.3  
**Total Endpoints:** 24  
**Total Lines:** 2,800+
