# GACP Platform API Documentation

## Overview

Base URL: `http://localhost:8000/api` (Development)  
Production: `https://gacpth.com/api`

## Authentication

All protected endpoints require a JWT token in the Authorization header:

```
Authorization: Bearer <token>
```

---

## Public Endpoints (No Auth Required)

### Health Check

```http
GET /v2/health
```

**Response:**
```json
{
  "success": true,
  "status": "healthy",
  "timestamp": "2026-02-02T03:00:00.000Z"
}
```

### Configuration

```http
GET /v2/config/document-slots
GET /v2/config/standards
GET /v2/config/pricing
GET /v2/config/plants
```

---

## Authentication Endpoints

### Check Identifier Availability

```http
POST /auth/health/check-identifier
```

**Request Body:**
```json
{
  "identifier": "1234567890123",
  "accountType": "INDIVIDUAL"
}
```

**Response:**
```json
{
  "success": true,
  "available": true
}
```

### Register

```http
POST /auth/health/register
```

**Request Body:**
```json
{
  "identifier": "1234567890123",
  "password": "securePassword123",
  "confirmPassword": "securePassword123",
  "firstName": "สมชาย",
  "lastName": "ใจดี",
  "phoneNumber": "0812345678",
  "email": "somchai@example.com",
  "accountType": "INDIVIDUAL",
  "acceptTerms": true
}
```

**Response:**
```json
{
  "success": true,
  "user": {
    "id": "user-uuid",
    "firstName": "สมชาย",
    "lastName": "ใจดี",
    "status": "ACTIVE"
  },
  "token": "jwt-token"
}
```

### Login

```http
POST /auth/health/login
```

**Request Body:**
```json
{
  "identifier": "1234567890123",
  "password": "securePassword123",
  "accountType": "INDIVIDUAL"
}
```

**Response:**
```json
{
  "success": true,
  "user": { ... },
  "token": "jwt-token",
  "refreshToken": "refresh-token"
}
```

### Get Current User

```http
GET /auth/health/me
```

**Headers:** `Authorization: Bearer <token>`

**Response:**
```json
{
  "success": true,
  "user": {
    "id": "user-uuid",
    "firstName": "สมชาย",
    "lastName": "ใจดี",
    "email": "somchai@example.com",
    "accountType": "INDIVIDUAL",
    "status": "ACTIVE"
  }
}
```

---

## Application Endpoints

### List My Applications

```http
GET /applications/my
```

**Headers:** `Authorization: Bearer <token>`

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "app-uuid",
      "applicationNumber": "GACP-CAN-2569-00001",
      "status": "SUBMITTED",
      "plantId": "cannabis",
      "createdAt": "2026-02-02T03:00:00.000Z"
    }
  ]
}
```

### Get Application Details

```http
GET /applications/:id
```

**Headers:** `Authorization: Bearer <token>`

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "app-uuid",
    "applicationNumber": "GACP-CAN-2569-00001",
    "status": "SUBMITTED",
    "formData": { ... }
  }
}
```

### Create Application

```http
POST /applications
```

**Headers:** `Authorization: Bearer <token>`

**Request Body:**
```json
{
  "plantId": "cannabis",
  "formData": {
    "applicantData": { ... },
    "farmData": { ... },
    "productionData": { ... }
  }
}
```

### Update Application

```http
PUT /applications/:id
```

**Headers:** `Authorization: Bearer <token>`

**Request Body:**
```json
{
  "formData": { ... },
  "status": "SUBMITTED"
}
```

### Submit Application

```http
POST /applications/:id/submit
```

**Headers:** `Authorization: Bearer <token>`

---

## Document Upload

### Upload Document

```http
POST /documents/upload
Content-Type: multipart/form-data
```

**Headers:** `Authorization: Bearer <token>`

**Form Data:**
- `file`: File to upload
- `type`: Document type (e.g., "ID_CARD", "LAND_TITLE")
- `applicationId`: Application ID

**Response:**
```json
{
  "success": true,
  "url": "https://storage.example.com/documents/file.pdf"
}
```

---

## Provider Endpoints

### List All Applications (Provider Only)

```http
GET /provider/applications
```

**Headers:** `Authorization: Bearer <provider-token>`

**Query Parameters:**
- `status`: Filter by status
- `page`: Page number
- `limit`: Items per page

### Update Application Status (Provider Only)

```http
PUT /provider/applications/:id/status
```

**Headers:** `Authorization: Bearer <provider-token>`

**Request Body:**
```json
{
  "status": "DOCUMENT_REVIEW",
  "note": "เอกสารครบถ้วน"
}
```

---

## Error Responses

All errors follow this format:

```json
{
  "success": false,
  "error": "Error message in Thai or English",
  "code": "ERROR_CODE"
}
```

### Common Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `UNAUTHORIZED` | 401 | Missing or invalid token |
| `FORBIDDEN` | 403 | Insufficient permissions |
| `NOT_FOUND` | 404 | Resource not found |
| `VALIDATION_ERROR` | 400 | Invalid request data |
| `RATE_LIMITED` | 429 | Too many requests |
| `SERVER_ERROR` | 500 | Internal server error |

---

## Rate Limiting

- **Login/Register:** 5 requests per minute per IP
- **API Endpoints:** 100 requests per minute per user
- **File Upload:** 10 requests per minute per user

---

## Application Status Flow

```
DRAFT → SUBMITTED → DOCUMENT_REVIEW → PENDING_PAYMENT → PAYMENT_CONFIRMED
    → FIELD_AUDIT_SCHEDULED → FIELD_AUDIT_COMPLETED → COMMITTEE_REVIEW
    → APPROVED → CERTIFIED
```

Alternative paths:
- `DOCUMENT_REVIEW → DOCUMENT_INCOMPLETE → DOCUMENT_REVIEW`
- `COMMITTEE_REVIEW → REVISION_REQUIRED → COMMITTEE_REVIEW`
- Any status → `REJECTED` (terminal)

---

## Plant Types

| ID | Thai Name | Code |
|----|-----------|------|
| `cannabis` | กัญชา | CAN |
| `kratom` | กระท่อม | KRA |
| `turmeric` | ขมิ้นชัน | TUR |
| `ginger` | ขิง | GIN |
| `black_galangal` | กระชายดำ | BGA |
| `plai` | ไพล | PLA |

---

## Account Types

| Type | Description |
|------|-------------|
| `INDIVIDUAL` | บุคคลธรรมดา |
| `COMMUNITY_ENTERPRISE` | วิสาหกิจชุมชน |
| `JURISTIC` | นิติบุคคล |

---

## Security Notes

1. All passwords are hashed with bcrypt (10 rounds)
2. JWT tokens expire after 24 hours
3. Refresh tokens expire after 7 days
4. Account locks after 5 failed login attempts (15 min lockout)
5. All sensitive data (ID cards, tax IDs) are stored as SHA-256 hashes
