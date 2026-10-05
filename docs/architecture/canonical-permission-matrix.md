# Canonical Permission Matrix

Last updated: 2026-03-06

Source of truth: `apps/backend/shared/canonical-rbac.js`

## Canonical Roles

| Canonical Role | Aliases (backend + frontend) |
|----------------|------|
| `admin` | `admin`, `super_admin` |
| `scheduler` | `scheduler` |
| `document_reviewer` | `reviewer`, `reviewer_auditor`, `document_reviewer` |
| `auditor` | `auditor`, `inspector`, `audit` |
| `head_auditor` | `head_auditor`, `approver`, `final_approver` |
| `account` | `account`, `accountant`, `finance` |
| `health` | `health`, `Applicant` |

## Route Permission Matrix

### Admin Routes (`/api/admin/*`)

| Route | Middleware | Allowed Roles |
|-------|-----------|---------------|
| `/api/admin/**` | `authenticateProvider` → `requireAdmin` | `admin` |

### Audit Routes

| Route | Middleware | Allowed Roles |
|-------|-----------|---------------|
| `GET /api/audits/reassign/reassignable` | `authenticateProvider` → `providerOnly` | all provider |
| `POST /api/audits/reassign/:id/reassign` | `authenticateProvider` → `providerOnly` + scheduler/admin check | `admin`, `scheduler` |
| `/api/audits/**` | `authenticateProvider` | all provider |

### Identity Routes (`/api/identity/*`)

| Route | Middleware | Allowed Roles |
|-------|-----------|---------------|
| `POST /api/identity/verify` | `authenticateHealth` | `health` |
| `GET /api/identity/status` | `authenticateHealth` | `health` |
| `GET /api/identity/pending` | `authenticateProvider` → `providerOnly` | all provider |
| `GET /api/identity/user/:id` | `authenticateProvider` → `providerOnly` | all provider |
| `POST /api/identity/review/:id` | `authenticateProvider` → `providerOnly` | all provider |

### Certificate Routes (`/api/certificates/*`)

| Route | Middleware | Allowed Roles |
|-------|-----------|---------------|
| `GET /api/certificates/:id/download` | `authenticateHealth` + ownership | `health` (owner only) |

### Criteria Routes (`/api/criteria/*`)

| Route | Middleware | Allowed Roles |
|-------|-----------|---------------|
| `POST /api/criteria/**` | `authenticateProvider` → `adminOnly` | `admin` |
| `PUT /api/criteria/**` | `authenticateProvider` → `adminOnly` | `admin` |
| `DELETE /api/criteria/**` | `authenticateProvider` → `adminOnly` | `admin` |
| `GET /api/criteria/**` | `authenticateHealth` | `health` |

### Quote Routes (`/api/quotes/*`)

| Route | Middleware | Allowed Roles |
|-------|-----------|---------------|
| `POST /api/quotes/*/accept` | `authenticateProvider` → `financeOnly` | `admin`, `account` |
| `POST /api/quotes/*/reject` | `authenticateProvider` → `financeOnly` | `admin`, `account` |
| `POST /api/quotes/*/send` | `authenticateProvider` → `financeOnly` | `admin`, `account` |

### Cron Routes (`/api/cron/*`)

| Route | Middleware | Allowed Roles |
|-------|-----------|---------------|
| `/api/cron/**` | `verifyCronSecret` (mandatory) | M2M with `CRON_SECRET` header |

### Lab Webhook Routes (`/api/callbacks/*`)

| Route | Middleware | Allowed Roles |
|-------|-----------|---------------|
| `POST /api/callbacks/lab-result` | `requireApiKey('LAB_API_KEY')` | M2M with `x-api-key` header |

### MFA Routes (`/api/mfa/*`)

| Route | Middleware | Allowed Roles |
|-------|-----------|---------------|
| `POST /api/mfa/verify` | `authenticateHealth` + rate limiter | `health` |

### Farm-Scoped Routes

| Route | Middleware | Allowed Roles |
|-------|-----------|---------------|
| `/api/site-analyses/**` | `authenticateHealth` → `requireFarmOwnership` | `health` (farm owner only) |
| `/api/training-records/**` | `authenticateHealth` → `requireFarmOwnership` | `health` (farm owner only) |

### Post-Audit & Revision Routes

| Route | Middleware | Allowed Roles |
|-------|-----------|---------------|
| `/api/post-audit/**` | `authenticateProvider` → `providerOnly` | all provider |
| `/api/revision-deadline/**` | `authenticateProvider` → `providerOnly` | all provider |

## Enforcement Middleware Reference

| Middleware | File | Behavior |
|-----------|------|----------|
| `requireAdmin` | `middleware/require-admin.js` | 403 if canonical role ≠ `admin` |
| `providerOnly` | `middleware/role-middleware.js` | 403 if not any provider role |
| `adminOnly` | `middleware/role-middleware.js` | 403 if canonical role ≠ `admin` |
| `financeOnly` | `middleware/role-middleware.js` | 403 if not `admin` or `account` |
| `requireFarmOwnership` | `middleware/farm-ownership.js` | 403 if `Farm.userId ≠ req.user.id` |
| `requireApiKey` | `middleware/api-key-auth.js` | 401 if `x-api-key` header invalid |
| `verifyCronSecret` | `routes/api/cron.js` | 401 if `x-cron-secret` header invalid |
