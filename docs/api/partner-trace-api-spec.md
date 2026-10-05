# Partner Trace API — Design Specification

> **Status**: Phase 4 — Specification only (no implementation yet)
> **Version**: v1.0-draft

## Overview

Public-facing API for partners (distributors, pharmacies, e-commerce platforms) to programmatically verify herb traceability by QR code or lot number.

---

## Endpoints

### `GET /api/trace/:qrCode`

**Purpose**: Lookup trace data by QR code (existing endpoint)

**Response layers**:

| Layer | Scope | Description |
|-------|-------|-------------|
| `public` | Default | Farm name, plant, certificate status, dates, verification |
| `advanced` | API Key required | Lab results detail, lot packaging, full timeline |

### `GET /api/trace/lot/:lotNumber`

**Purpose**: Lookup trace data by lot number (new)

**Response**: Same two-layer structure as QR endpoint

---

## Authentication

### Public tier (no key)

- Rate limit: 60 req/min per IP
- Response: `public` layer only
- CORS: `*` (open)

### Partner tier (API key)

- Header: `X-GACP-API-Key: <key>`
- Rate limit: 600 req/min per key
- Response: `public` + `advanced` layers
- CORS: Whitelisted origins only

---

## API Key Management

### Issuance

- Provider dashboard → Settings → API Keys
- Each key tied to organization + contact email
- Keys are hashed (bcrypt) in DB, full key shown only once

### Schema (future)

```sql
CREATE TABLE partner_api_keys (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_name   VARCHAR(255) NOT NULL,
  key_hash   VARCHAR(255) NOT NULL,
  key_prefix VARCHAR(8)   NOT NULL,  -- first 8 chars for identification
  tier       VARCHAR(20)  DEFAULT 'partner',
  rate_limit INT          DEFAULT 600,
  cors_origins TEXT[],
  created_at TIMESTAMPTZ  DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id)
);
```

---

## Rate Limiting

| Tier | Limit | Window | Exceeded response |
|------|-------|--------|-------------------|
| Public | 60/min | Sliding window | `429 Too Many Requests` |
| Partner | 600/min | Sliding window | `429 Too Many Requests` |

Use Redis `INCR` + `EXPIRE` pattern (already have Redis in stack).

---

## CORS Policy

```nginx
# In nginx config for /api/trace/*
location /api/trace/ {
    # Public tier: allow all origins
    if ($http_x_gacp_api_key = '') {
        add_header Access-Control-Allow-Origin '*';
    }
    
    # Partner tier: check whitelist (handled by backend middleware)
    proxy_pass http://backend:3001;
}
```

---

## Response Format

```json
{
  "success": true,
  "type": "LOT",
  "data": {
    "farm": { "name": "...", "location": "..." },
    "plant": { "nameTH": "...", "nameEN": "..." },
    "certificate": { "number": "...", "isValid": true },
    "verification": { "valid": true, "scannedAt": "..." }
  },
  "advanced": {
    "lot": { "lotNumber": "...", "packageType": "..." },
    "lab_analysis": { "status": "PASSED", "reportUrl": "..." },
    "dates": { "planted": "...", "harvested": "..." }
  }
}
```

> `advanced` field only present when authenticated with API key.

---

## Implementation Phases

1. **Current**: Public trace API exists (`/api/trace/:qrCode`), no rate limiting, no CORS policy
2. **Next sprint**: Add rate limiting middleware + CORS to nginx
3. **Future**: API key management UI + partner dashboard
