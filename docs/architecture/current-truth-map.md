# Current Truth Map — GACP Platform

> Phase 1 Discovery: What actually exists today, verified from code.

## 1. Workflow / State Machine (TRACK 1 + 3)

### Source of Truth
**Canonical**: `services/workflow-transition-service.js` — 18 states

### Verified Workflow States (canonical)
```
DRAFT → SUBMITTED → PENDING_DOC_FEE → DOC_FEE_PAID → ASSIGNED_FOR_REVIEW
→ ( DOC_APPROVED | REVISION_REQUESTED ↔ ASSIGNED_FOR_REVIEW )
→ PENDING_AUDIT_FEE → AUDIT_FEE_PAID → AUDIT_CONFIRMED
→ ( AUDIT_PASSED | CAR_PENDING → CAR_REVIEWING ↔ AUDIT_CONFIRMED )
→ APPROVED → CERTIFIED
Terminal: REJECTED, EXPIRED, CANCEL_EXPIRED
```

### ⚠️ CONTRADICTION: Prisma `state` field vs Backend `status` field
- Prisma schema uses `state` field (line 27 of application.prisma): `state String @default("DRAFT")`
- But Prisma schema ALSO comments: "DB has 'status' column as legacy alias — sync via trigger"
- `workflow-transition-service.js` `buildTransitionUpdate()` writes to BOTH `status` and `formData.workflowState`
- This means THREE fields potentially store state: `state`, `status`, `formData.workflowState`
- **VERDICT: Triple-write is accidental complexity. Need to verify which DB column actually exists.**

### ⚠️ DUPLICATE: Two re-export files for same source
| File | Purpose | Notes |
|------|---------|-------|
| `shared/status-machine.js` | Re-exports from workflow-transition-service | Adds `validateTransition`, `InvalidTransitionError` |
| `shared/workflow-state-machine.js` | Re-exports from workflow-transition-service | Adds `APPLICATION_STATUSES` dict, marked "backward compat only" |

Both files re-export the same canonical source. Both construct `APPLICATION_STATUSES`. This is duplicate surface.

### ⚠️ COMPETING DASHBOARD STAGE MODELS

**Backend** (`shared/health-dashboard-stage.js`): 5-stage model
```
DRAFT | WAITING_DOCUMENT_REVIEW | WAITING_PAYMENT | WAITING_AUDIT | CERTIFIED
```

**Frontend** (`lib/health-dashboard-stage.ts`): 8-stage model
```
DRAFT | PENDING_FEE_PHASE1 | UNDER_DOCUMENT_REVIEW | REVISION_REQUIRED |
PENDING_FEE_PHASE2 | UNDER_FIELD_AUDIT | APPROVED | CERTIFIED
```

- Backend 5-stage is LESS granular — collapses payment into one bucket, misses Phase2
- Frontend 8-stage is business-correct — separates Phase 1 fee, Phase 2 fee, revision
- **VERDICT: Frontend 8-stage IS the correct business model. Backend 5-stage is stale/wrong.**

### Legacy Status Aliases (25+ legacy values mapped)
`PAYMENT_1_PAID`, `REGISTERED`, `PENDING_REVIEW`, `IN_REVIEW`, `UNDER_REVIEW`,
`DOCUMENT_APPROVED`, `PAYMENT_2_PENDING`, `AWAITING_SCHEDULE`, `SCHEDULED`,
`AUDIT_IN_PROGRESS`, `INSPECTION_COMPLETED`, `FINAL_APPROVED`, `AUDIT_FAILED`, etc.

---

## 2. Application Step Model (TRACK 2)

### ⚠️ TWO COMPETING STEP MODELS

**Model A — "New" (6 steps)**: `applications/new/application-schema.ts`
```
1. พืชและยินยอม (Plant & Consent)
2. ผู้ยื่นคำขอ (Applicant)
3. สถานที่และเพาะปลูก (Farm & Cultivation)
4. คุณภาพและหลักฐาน (Quality & Documents)
5. ตรวจทาน (Review)
6. ชำระเงิน (Payment)
```
- Has Zod schema per step
- Clean architecture: "6 steps, 1 URL, 1 schema"

**Model B — "Legacy" (9 steps)**: `applications/new-legacy/steps/` (30 files)
```
1. ยินยอมและประเภท (Consent step)
2. ข้อมูลพืช (Plant selection)
3. วัตถุประสงค์ (Purpose step)
4. ผู้ยื่นคำขอ (General/applicant)
5. สถานที่ปลูก (Farm info)
6. การผลิต (Production info)
7. เก็บเกี่ยว & คุณภาพ (Quality control)
8. หลักฐาน (Documents)
9. ตรวจสอบ + ยื่น (Review + Submit + Success + Quote + Invoice)
```
- Massive: 30 files, deeply complex
- Still actively routing via `/health/applications/new-legacy` → redirects to `new/step/1`

**VERDICT**: Model B (legacy) is what users actually see on production (confirmed by screenshot). Model A (new) exists as planned replacement but is the actual page router. The legacy `new-legacy/` contains the actual step component implementations that are imported by the new route.

---

## 3. RBAC Model (TRACK 5)

### Source of Truth
**Canonical**: `shared/canonical-rbac.js`

### Canonical Roles (6)
| Role | Value | Purpose |
|------|-------|---------|
| ADMIN | `admin` | Full access |
| SCHEDULER | `scheduler` | Audit scheduling |
| DOCUMENT_REVIEWER | `document_reviewer` | Document review |
| AUDITOR | `auditor` | Field audit + consolidated HEAD_AUDITOR |
| ACCOUNT | `account` | Finance/invoicing |
| HEALTH | `health` | Applicant/farmer |

### Legacy Aliases (15)
`super_admin`, `reviewer`, `reviewer_auditor`, `inspector`, `audit`, `head_auditor`,
`approver`, `final_approver`, `accountant`, `finance`, `Applicant`

### ⚠️ ROLE_GROUPS duplicates both canonical AND uppercase legacy
Each ROLE_GROUP array contains BOTH forms: `['admin', 'ADMIN', 'SUPER_ADMIN']`
- This is because `requireRole()` needs case-insensitive matching
- But it means every role check array is 2x longer than needed
- If `requireRole` normalized first, groups could be canonical-only

---

## 4. Route Surface (TRACK 4)

### Backend API Routes — 60+ mounts at `/api/`

**Canonical domain routes** (necessary):
- `/auth/health`, `/auth/provider`, `/public`
- `/applications`, `/applications/car`, `/applications/config`
- `/invoices`, `/payments`, `/quotes`, `/accounting`, `/pricing`
- `/audits`, `/audit`, `/farm-audits`, `/post-audit`
- `/certificates`, `/standards`
- `/planting-cycles`, `/cultivation-logs`, `/harvest-batches`, `/farms`
- `/trace`, `/lots`
- `/documents`, `/templates`, `/reports`, `/sop-documents`
- `/provider` (CMS operations)

**System routes** (necessary):
- `/health`, `/metrics`, `/version`, `/system`, `/cron`, `/webhooks`, `/sync`, `/e2e`
- `/notifications`, `/tickets`, `/config`, `/system-config`, `/dashboard`
- `/master-data`, `/analytics`

**⚠️ Potentially duplicate/over-split**:
- `/audits` vs `/audit` vs `/farm-audits` vs `/post-audit` — 4 audit route sets
- `/applications/car` as separate mount
- `/fraud-detection`, `/site-analyses` — very specific, low-traffic
- `/cultivation-config` (actually `journey.js`)
- `/validation` as standalone mount
- `/calculations`, `/gacp-scoring` as separate mounts

**Legacy routes** (guarded by `ENABLE_PROVIDER_LEGACY_ALIAS`):
- `/provider-cms`, `/wizard`, `/admin`

### Frontend Routes — Health-side (20 directories)
`applications`, `certificates`, `dashboard`, `documents`, `establishments`,
`export-documents`, `notifications`, `official-documents`, `payments`, `planting`,
`profile`, `reports`, `resources`, `settings`, `site-analysis`, `sop-builder`,
`sop-templates`, `start`, `tracking`, `training`

### ⚠️ Health-side has 20 page directories — massive cognitive overload
Many are low-traffic or post-certification features shown to all users.

---

## 5. Navigation Audit (TRACK 6)

### ⚠️ FOUR COMPETING NAVIGATION SYSTEMS

| System | File | Items |
|--------|------|-------|
| Top nav bar | `dashboard-layout.tsx` | Receives `navItems` prop |
| Desktop app-shell | `app-shell.tsx` | 5 health items: Dashboard, Applications, Payments, Certificates, Profile |
| Sidebar | `sidebar.tsx` | 8 items: Dashboard, Applications, Certificates, Payments, Notifications, Profile, Settings |
| Sidebar-nav | `sidebar-nav.tsx` | 11+ items with sub-items |
| Mobile bottom nav | `bottom-nav.tsx` | 5 items |
| Mobile bottom nav (layout) | `mobile-bottom-nav.tsx` | 4 health items |
| Mobile header | `mobile-header.tsx` | 8 items (same as sidebar) |

**VERDICT**: At least 4 separate navigation component files define health-side nav items independently. No single source of truth for navigation items.

---

## 6. Validation (TRACK 7)

### ⚠️ TWO VALIDATION SYSTEMS

| System | File | Technology |
|--------|------|-----------|
| Zod schemas | `shared/zod-schemas.js` | Zod (290 lines) |
| Legacy validation | `shared/validation.js` | Plain JS functions (238 lines) |

- Both validate Thai ID (checksum), email, phone, password
- Zod schemas used for API middleware (`validateBody`)
- Legacy validation used in scattered service code
- Password strength: Zod requires upper+lower+number; legacy requires upper+lower+number+special char
- **MISMATCH**: `isStrongPassword` in validation.js requires special character `[@$!%*?&]`, but Zod `passwordSchema` does NOT require special character

---

## 7. Runtime Topology (TRACK 8)

| Component | Port | Notes |
|-----------|------|-------|
| Backend | 8000 | Express, Prisma ORM |
| Frontend | 3000 | Next.js |
| Nginx | 80/443 | Reverse proxy |
| PostgreSQL | 5432 | Database |
| Redis | 6379 | Cache + sessions |

Docker compose files: `docker-compose.yml` (dev), `docker-compose.production.yml`, `docker-compose.local-prod.yml`, `docker-compose.qa.yml` — 4 compose files.

---

## 8. Key Contradictions Summary

| # | Issue | Severity | Category |
|---|-------|----------|----------|
| 1 | Two dashboard stage models (5 vs 8) | HIGH | Duplicate abstraction |
| 2 | Two re-export wrappers for workflow-state-machine | MEDIUM | Duplicate surface |
| 3 | Two validation systems (Zod vs plain JS) with password mismatch | HIGH | Logic conflict |
| 4 | Two application step models (6 vs 9 steps) | HIGH | Competing UX |
| 5 | 4+ competing navigation component files | MEDIUM | No SoT for nav |
| 6 | Triple-write for state (state, status, formData.workflowState) | HIGH | Accidental complexity |
| 7 | 15 legacy role aliases living alongside 6 canonical roles | LOW | Legacy debt |
| 8 | 4 separate audit route mounts | MEDIUM | Over-split |
| 9 | 20 health-side page directories (cognitive overload) | MEDIUM | UX noise |
| 10 | 4 docker-compose files | LOW | Operational sprawl |
