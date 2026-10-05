# GACP Platform — API Reference

> All backend API endpoints organized by domain.

---

## Authentication

| Method | Endpoint | Auth | Purpose |
|:---|:---|:---:|:---|
| POST | `/api/auth/health/login` | ❌ | Health user login (Thai ID) |
| POST | `/api/auth/health/register` | ❌ | Register new health user |
| POST | `/api/auth/health/check-identifier` | ❌ | Check if Thai ID exists |
| POST | `/api/auth/provider/login` | ❌ | Provider/officer login |
| POST | `/api/auth/logout` | ✅ | Logout (clear tokens) |
| GET | `/api/auth/me` | ✅ | Get current user profile |
| POST | `/api/auth/refresh` | ✅ | Refresh JWT token |
| POST | `/api/auth/change-password` | ✅ | Change password |

## Applications

| Method | Endpoint | Auth | Purpose |
|:---|:---|:---:|:---|
| GET | `/api/applications/my` | ✅ | List user's applications |
| POST | `/api/applications` | ✅ | Create new application |
| GET | `/api/applications/:id` | ✅ | Get application details |
| PATCH | `/api/applications/:id` | ✅ | Update draft application |
| POST | `/api/applications/:id/submit` | ✅ | Submit for review |
| POST | `/api/applications/:id/revision` | ✅ | Request revision |
| GET | `/api/applications/:id/timeline` | ✅ | Application timeline |

## Farms

| Method | Endpoint | Auth | Purpose |
|:---|:---|:---:|:---|
| GET | `/api/farms` | ✅ | List user's farms |
| POST | `/api/farms` | ✅ | Register new farm |
| GET | `/api/farms/:id` | ✅ | Get farm details |
| PATCH | `/api/farms/:id` | ✅ | Update farm info |

## Documents

| Method | Endpoint | Auth | Purpose |
|:---|:---|:---:|:---|
| POST | `/api/documents/upload` | ✅ | Upload document |
| GET | `/api/documents/:id` | ✅ | Download document |
| DELETE | `/api/documents/:id` | ✅ | Delete document |

## Payments

| Method | Endpoint | Auth | Purpose |
|:---|:---|:---:|:---|
| POST | `/api/payments/create` | ✅ | Create payment |
| POST | `/api/payments/phase1` | ✅ | Phase 1 payment |
| POST | `/api/payments/phase2` | ✅ | Phase 2 payment |
| GET | `/api/payments/:id` | ✅ | Get payment status |
| POST | `/api/webhooks/payment` | ❌ | Payment webhook |

## Invoices

| Method | Endpoint | Auth | Purpose |
|:---|:---|:---:|:---|
| GET | `/api/invoices` | ✅ | List invoices |
| GET | `/api/invoices/:id` | ✅ | Get invoice details |
| GET | `/api/invoices/:id/pdf` | ✅ | Download invoice PDF |
| GET | `/api/invoices/export` | ✅ | Export CSV/PDF |

## Certificates

| Method | Endpoint | Auth | Purpose |
|:---|:---|:---:|:---|
| GET | `/api/certificates` | ✅ | List certificates |
| GET | `/api/certificates/:id` | ✅ | Get certificate details |
| POST | `/api/certificates/:id/renew` | ✅ | Renew certificate |
| POST | `/api/certificates/:id/replace` | ✅ | Replace certificate |

## Planting Cycles

| Method | Endpoint | Auth | Purpose |
|:---|:---|:---:|:---|
| GET | `/api/planting-cycles` | ✅ | List planting cycles |
| POST | `/api/planting-cycles` | ✅ | Create planting cycle |
| PATCH | `/api/planting-cycles/:id` | ✅ | Update cycle |
| POST | `/api/planting-cycles/:id/logs` | ✅ | Add cultivation log |

## Notifications

| Method | Endpoint | Auth | Purpose |
|:---|:---|:---:|:---|
| GET | `/api/notifications` | ✅ | List notifications |
| PATCH | `/api/notifications/:id/read` | ✅ | Mark as read |
| PATCH | `/api/notifications/read-all` | ✅ | Mark all as read |

## Provider (Officer)

| Method | Endpoint | Auth | Purpose |
|:---|:---|:---:|:---|
| GET | `/api/provider/applications` | ✅ | List all applications |
| PATCH | `/api/provider/applications/:id/status` | ✅ | Update status |
| POST | `/api/provider/applications/:id/score` | ✅ | Submit GACP score |
| POST | `/api/provider/applications/:id/audit` | ✅ | Submit audit result |

## Trace (Public)

| Method | Endpoint | Auth | Purpose |
|:---|:---|:---:|:---|
| GET | `/api/trace/:certNumber` | ❌ | Verify certificate (QR) |

## Health Check

| Method | Endpoint | Auth | Purpose |
|:---|:---|:---:|:---|
| GET | `/api/health` | ❌ | API health check |
| GET | `/api/v1/health` | ❌ | Versioned health check |

---

## Response Format

All API responses follow this structure:

```json
{
  "success": true,
  "data": { ... },
  "message": "Operation successful",
  "messageTh": "ดำเนินการสำเร็จ"
}
```

Error responses:

```json
{
  "success": false,
  "code": "VALIDATION_ERROR",
  "error": "Invalid input",
  "errorTh": "ข้อมูลไม่ถูกต้อง",
  "requestId": "abc-123"
}
```

---

## Rate Limits

| Endpoint | Window | Max Requests |
|:---|:---:|:---:|
| Global API | 15 min | 1000 |
| Login | 15 min | 50 |
| Register | 30 min | 20 |
| Check Identifier | 10 min | 45 |
| Payment | 1 min | 10 |
| Webhook | 1 min | 30 |
