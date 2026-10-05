# GACP Platform — Architecture Guide

> **Thai Herbal Certification System (ระบบรับรองมาตรฐาน GACP สมุนไพรไทย)**
> Full-stack web application for managing Good Agricultural and Collection Practices (GACP) certification.

---

## System Overview

```
┌─────────────────────────────────────────────────────────┐
│                    GACP Platform                         │
├──────────────────┬──────────────────────────────────────┤
│   Frontend       │   Backend                            │
│   (Next.js 14)   │   (Express.js + Node.js)             │
│   Port: 3001     │   Port: 3000 (→ 8000 in Docker)      │
├──────────────────┼──────────────────────────────────────┤
│                  │   Database: PostgreSQL (Prisma ORM)   │
│                  │   Cache: Redis                        │
│                  │   Storage: MinIO / Local FS           │
│                  │   Queue: Bull (BullMQ)                │
└──────────────────┴──────────────────────────────────────┘
```

---

## Directory Structure

```
GACP-Certification-Application/
├── apps/
│   ├── backend/              # Express.js API server
│   │   ├── server.js         # Entry point (423 lines)
│   │   ├── config/           # env-validator, swagger, business-rules
│   │   ├── controllers/      # 22 controllers + 2 subdirs
│   │   ├── middleware/        # 16 middleware files
│   │   ├── routes/api/       # 17 route groups
│   │   ├── services/         # 53 services + 24 subdirs
│   │   ├── prisma/schema/    # 9 Prisma schema files
│   │   ├── validation/       # Zod validation schemas
│   │   ├── utils/            # Utility functions
│   │   ├── jobs/             # Cron jobs (scheduler)
│   │   └── shared/           # Logger, API response helpers
│   ├── web-app/              # Next.js 14 frontend
│   │   └── src/
│   │       ├── app/          # 101 pages (App Router)
│   │       ├── components/   # 24+ reusable components
│   │       ├── lib/          # API client, auth, i18n, utils
│   │       └── styles/       # 6 CSS files (Tailwind)
│   └── mobile-app/           # Mobile app (placeholder)
├── scripts/
│   ├── review/               # 10 code review agents
│   ├── test/                 # 20+ test agents
│   ├── deploy/               # Deployment scripts
│   └── db/                   # Database utilities
└── .agents/                  # AI agent configs
    ├── skills/               # 26 UI/UX skills
    └── workflows/            # deploy, review, test
```

---

## Backend Architecture

### Request Flow

```
Client Request
    │
    ▼
┌─ Express Middleware Stack ──────────────────┐
│  1. JSON/URL body parser (10MB limit)       │
│  2. Request ID (X-Request-ID)               │
│  3. Client IP detection                     │
│  4. Service availability check (503)        │
│  5. Helmet (security headers)               │
│  6. CORS (origin whitelist)                 │
│  7. Rate limiting (global + per-endpoint)   │
│  8. Compression (gzip)                      │
│  9. Morgan (request logging)                │
│  10. Cookie parser                          │
│  11. CSRF protection (double-submit)        │
│  12. API versioning (/api/v1 → /api)        │
└────────────────────────────────────────────┘
    │
    ▼
┌─ Router (routes/api/index.js) ─────────────┐
│  /auth      → Auth routes                  │
│  /applications → Application CRUD          │
│  /farms     → Farm management              │
│  /documents → Document upload/review       │
│  /payments  → Payment processing           │
│  /invoices  → Invoice/receipt management   │
│  /certificates → Certificate lifecycle     │
│  /audit     → Audit trail & checklists     │
│  /notifications → Push/email/SMS           │
│  /trace     → Traceability (public QR)     │
│  /admin     → Admin panel APIs             │
│  /provider  → Provider/officer APIs        │
│  /reports   → Export CSV/PDF               │
│  /planting  → Planting cycle management    │
│  /cultivation → Cultivation logs           │
│  /scoring   → GACP scoring engine          │
│  /system    → System config & health       │
└────────────────────────────────────────────┘
    │
    ▼
┌─ Controllers (22 files) ───────────────────┐
│  Handle HTTP req/res, validate input,      │
│  delegate to services, format response     │
└────────────────────────────────────────────┘
    │
    ▼
┌─ Services (53 files) ─────────────────────┐
│  Business logic layer                      │
│  ├── application-service (CRUD + workflow) │
│  ├── payment-service (PromptPay/Ksher)     │
│  ├── certificate-service (issue/verify)    │
│  ├── notification-service (email/SMS/push) │
│  ├── audit-trail (immutable logs)          │
│  ├── gacp-scoring-service (8 categories)   │
│  ├── fraud-detection-service               │
│  ├── workflow-transition-service           │
│  ├── esign-service (digital signatures)    │
│  └── ... 44 more services                  │
└────────────────────────────────────────────┘
    │
    ▼
┌─ Data Layer ───────────────────────────────┐
│  Prisma ORM → PostgreSQL                   │
│  Redis → Caching & session                 │
│  MinIO/Local → File storage                │
│  BullMQ → Background job queue             │
└────────────────────────────────────────────┘
```

### Key Middleware

| File | Purpose |
|:---|:---|
| `auth-middleware.js` | JWT verification, role extraction |
| `role-middleware.js` | Role-based access control (RBAC) |
| `api-version.js` | `/api/v1` → `/api` alias mapping |
| `rate-limiter.js` | Per-endpoint rate limits |
| `audit-logger.js` | Automatic audit trail logging |
| `consent-manager.js` | PDPA consent tracking |
| `idempotency.js` | Prevent duplicate operations |
| `farm-ownership.js` | Verify farm belongs to user |
| `validate.js` | Zod schema validation |

### Key Services

| Service | Size | Purpose |
|:---|:---:|:---|
| `notification-service.js` | 23KB | Email + SMS + in-app notifications |
| `gacp-scoring-service.js` | 21KB | 8-category GACP scoring engine |
| `invoice-service.js` | 21KB | Invoice generation, PDF, export |
| `prisma-auth-service.js` | 19KB | User registration, login, password |
| `certificate-service.js` | 16KB | Certificate lifecycle management |
| `pdf-service.js` | 16KB | PDF generation for documents |
| `planting-cycle-service.js` | 15KB | Planting cycle CRUD |
| `security-compliance.js` | 15KB | Security hardening & compliance |
| `payment-legacy-service.js` | 14KB | Legacy payment processing |
| `email-service.js` | 13KB | Email templates & sending |

---

## Database Schema (Prisma)

Schema is organized into 9 domain files:

| File | Models | Purpose |
|:---|:---|:---|
| `_base.prisma` | Datasource, generator config | Base configuration |
| `auth.prisma` | User, Session, Token | Authentication |
| `application.prisma` | Application, Revision | Certification applications |
| `farm.prisma` | Farm, PlantUnit | Farm & plant management |
| `cultivation.prisma` | PlantingCycle, CultivationLog | Planting records |
| `certification.prisma` | Certificate, Inspection | Certificates issued |
| `billing.prisma` | Invoice, Payment, Receipt | Financial transactions |
| `audit.prisma` | AuditLog, AuditChecklist | Audit trail |
| `trace.prisma` | TraceEvent, QRCode | Traceability system |
| `system.prisma` | SystemConfig, Notification | System settings |

---

## Frontend Architecture

### Tech Stack
- **Framework**: Next.js 14 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS + custom design tokens
- **Animation**: Framer Motion
- **State**: React hooks + context
- **i18n**: Custom `useLanguage` hook (Thai/English)
- **API**: Custom `apiClient` (Axios-based)
- **Auth**: Cookie-based JWT with CSRF

### Portal Structure (101 pages)

| Portal | Pages | Audience |
|:---|:---:|:---|
| **Auth** | 7 | Login, register (no forgot-password: no reset by email or SMS, 2026-09-16) |
| **Health** | ~35 | Farmers/applicants — apply, track, manage |
| **Provider** | ~30 | Officers — review, score, approve |
| **Admin** | ~10 | System administrators |
| **Public** | ~5 | Certificate verification, terms |

### Component Library

```
components/
├── ui/               # Primitives (Button, Card, Badge, Input, etc.)
├── layout/           # Health/provider nav, sidebar, footer
├── wizard/           # Multi-step application wizard
├── document/         # Document upload, viewer, PDF
├── application-flow/ # Application lifecycle components
├── traceability/     # QR code, trace timeline
├── feature/          # Feature flags
└── theme/            # Theme toggle (dark/light)
```

### Design System (CSS Tokens)

```css
/* Primary palette — Thai herbal green */
--primary: 153 100% 20%;       /* Dark green */
--secondary: 43 45% 55%;       /* Gold accent */
--destructive: 0 72% 51%;      /* Red */
--success: 153 60% 40%;        /* Green */
--warning: 38 92% 50%;         /* Amber */
--info: 210 80% 50%;           /* Blue */

/* Font: Prompt (Thai-optimized Google Font) */
font-family: 'Prompt', sans-serif;
```

---

## Application Lifecycle

```
DRAFT → SUBMITTED → UNDER_REVIEW → DOCUMENT_REVIEW
→ PAYMENT_PENDING → PAYMENT_VERIFIED → FIELD_AUDIT_SCHEDULED
→ FIELD_AUDIT_COMPLETED → SCORING → APPROVED/REJECTED
→ CERTIFICATE_ISSUED → (RENEWAL/REPLACEMENT/AMENDMENT)
```

---

## Deployment

- **Hosting**: DigitalOcean Droplet (gacpth.com)
- **Container**: Docker Compose (backend + frontend + nginx + PostgreSQL + Redis)
- **Domain**: gacpth.com (Cloudflare DNS)
- **SSL**: Let's Encrypt via Cloudflare
- **CI/CD**: Manual via SSH (`/deploy` workflow)

---

## Testing Infrastructure

| Suite | Agents | Purpose |
|:---|:---:|:---|
| Code Review | 10 | Static analysis — code quality, logic, API, design, frontend, backend, database, duplicates, lint, sitemap |
| Carpet-Bomb Tests | 7 | Backend stress, security, database, frontend health, SEO, API contract |
| Journey Tests | 16+ | End-to-end user flows — registration, farm, wizard, documents, audit, payment, certificate, rejection, notifications |

**Current Scores**: Code review 100/100, Tests 297/297 (100%)
