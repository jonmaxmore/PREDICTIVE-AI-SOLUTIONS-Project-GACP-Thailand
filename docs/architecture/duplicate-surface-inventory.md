# Duplicate Surface Inventory — GACP Platform

> Every instance where the same concern has multiple implementations.

## CATEGORY A: Active Conflicts (different behavior, same domain)

### A1. Dashboard Stage Model (5-stage vs 8-stage)
| Aspect | Backend (`shared/health-dashboard-stage.js`) | Frontend (`lib/health-dashboard-stage.ts`) |
|--------|----------------------------------------------|---------------------------------------------|
| Stages | 5 | 8 |
| Phase 1 fee | Lumped into WAITING_PAYMENT | PENDING_FEE_PHASE1 |
| Phase 2 fee | Lumped into WAITING_PAYMENT | PENDING_FEE_PHASE2 |
| Revision | Lumped into WAITING_DOCUMENT_REVIEW | REVISION_REQUIRED (own stage) |
| Approved | Lumped into CERTIFIED | APPROVED (own stage) |
| **Impact** | Backend APIs may return WAITING_PAYMENT for both phases | Frontend handles correctly |

**Resolution**: Backend 5-stage must be upgraded to 8-stage or deprecated.

---

### A2. Password Validation Rules
| Rule | `zod-schemas.js` (passwordSchema) | `validation.js` (isStrongPassword) |
|------|-----------------------------------|------------------------------------|
| Min length | 8 | 8 |
| Uppercase | Required | Required |
| Lowercase | Required | Required |
| Number | Required | Required |
| Special char | **NOT required** | **Required** `[@$!%*?&]` |

**Impact**: A password passing Zod validation may fail `isStrongPassword()` and vice versa.

---

### A3. Application Step Model
| Aspect | Model A (new/application-schema.ts) | Model B (new-legacy/steps/) |
|--------|--------------------------------------|------------------------------|
| Steps | 6 | 9+ (with sub-steps) |
| Files | 1 schema file | 30 component files |
| Routing | `/new/step/[id]` | `/new-legacy/` → redirects |
| Validation | Zod per-step | Mixed inline validation |
| **Currently active** | Yes (route target) | Yes (component implementations) |

**Impact**: The production wizard uses legacy components routed through the new URL.

---

## CATEGORY B: Unnecessary Duplication (same behavior, multiple files)

### B1. Workflow State Machine Re-exports
| File | Source | Extra exports |
|------|--------|---------------|
| `services/workflow-transition-service.js` | **CANONICAL** | All 13 exports |
| `shared/workflow-state-machine.js` | Re-export | `APPLICATION_STATUSES` dict |
| `shared/status-machine.js` | Re-export | `validateTransition`, `InvalidTransitionError` |

**Resolution**: Inline validation logic into canonical service. Remove re-export files.

---

### B2. Navigation Components
| Component | Location | Purpose |
|-----------|----------|---------|
| `app-shell.tsx` | `components/layout/` | Top nav (5 health items) |
| `sidebar.tsx` | `components/ui/` | Mobile sidebar (8 items) |
| `sidebar-nav.tsx` | `components/ui/` | Desktop sidebar (11+ items w/ sub-items) |
| `mobile-header.tsx` | `components/ui/` | Mobile header nav (8 items) |
| `bottom-nav.tsx` | `components/ui/` | Mobile bottom tabs (5 items) |
| `mobile-bottom-nav.tsx` | `components/layout/` | Another mobile bottom nav (4 items) |
| `dashboard-layout.tsx` | `components/layout/` | Desktop + mobile bottom tabs |

**7 files** define health navigation independently. No config file drives them all.

**Resolution**: Create ONE `nav-config.ts` that all components read from.

---

### B3. Thai ID Validation
| File | Function | Technology |
|------|----------|-----------|
| `zod-schemas.js` | `thaiIdSchema` | Zod + checksum |
| `validation.js` | `isValidThaiID()` | Plain JS + checksum |

Same algorithm, duplicated. Both include 13-digit regex + checksum.

---

### B4. Email Validation
| File | Function |
|------|----------|
| `zod-schemas.js` | `emailSchema` (Zod `.email()`) |
| `validation.js` | `validateEmail` / `isValidEmail` (regex) |

Two names, two implementations for the same thing.

---

### B5. Phone Validation
| File | Function |
|------|----------|
| `zod-schemas.js` | `phoneSchema` (10 digits, starts with 0) |
| `validation.js` | `validatePhone` (any 10 digits), `isValidThaiPhone` (starts with 0) |

Three phone validators total.

---

## CATEGORY C: Unnecessary Route Surface

### C1. Audit Routes (4 mounts)
```
/api/audits           → audits.js (main CRUD)
/api/audit            → audit.js (alternate mount)
/api/farm-audits      → farm-audit.js
/api/post-audit       → post-audit.js
/api/audits/reassign  → audits-reassign.js (separate from audits)
```

5 route files for one domain concept. Should be consolidated under `/api/audits/*`.

### C2. Application Sub-routes (6 mounts)
```
/api/applications           → main CRUD
/api/applications/car       → corrective action
/api/applications/config    → config
/api/validation             → standalone validation
/api/gacp-scoring           → scoring standalone
/api/calculations           → calculations standalone
/api/revision-deadline      → deadline management
/api/application-bundles    → bundles
/api/cultivation-config     → journey.js
/api/criteria               → criteria
```

10 route mounts for application domain. Should be nested under `/api/applications/*`.

### C3. Document Routes (4 mounts)
```
/api/documents        → main
/api/templates        → doc templates
/api/report-submissions
/api/reports
```

---

## CATEGORY D: Legacy Aliases Still Present

### D1. Schema Aliases
```javascript
const ApplicantLoginSchema = healthLoginSchema;      // alias
const ApplicantRegistrationSchema = healthRegistrationSchema; // alias
```

### D2. Role Aliases (15)
`reviewer_auditor`, `inspector`, `head_auditor`, `approver`, `final_approver`,
`accountant`, `finance`, `Applicant`, `super_admin`, `audit`

### D3. Workflow State Aliases (25+)
`REGISTERED`, `PENDING_REVIEW`, `IN_REVIEW`, `UNDER_REVIEW`, `PAYMENT_1_PAID`,
`DOCUMENT_APPROVED`, `AWAITING_SCHEDULE`, `SCHEDULED`, `INSPECTION_IN_PROGRESS`,
`AUDITED`, `FINAL_APPROVED`, `AUDIT_FAILED`, etc.

### D4. Legacy Routes (guarded)
```
/api/provider-cms   (ENABLE_PROVIDER_LEGACY_ALIAS=true)
/api/wizard         (ENABLE_PROVIDER_LEGACY_ALIAS=true)
/api/admin          (ENABLE_PROVIDER_LEGACY_ALIAS=true)
```

---

## CATEGORY E: Over-Engineering

### E1. Health-side Pages (20 directories, most pre-cert)
Many pages are accessible to users who haven't even submitted their first application:
- `sop-builder`, `sop-templates` — Post-certification utility
- `training` — Post-certification
- `resources` — Reference material
- `tracking` — Post-certification trace
- `export-documents` — Post-certification
- `establishments` — Post-certification
- `site-analysis` — Post-certification
- `official-documents` — Post-certification
- `start` — Onboarding (could be dashboard)

**9 of 20 pages** are post-certification features shown too early.

### E2. Provider-side Pages (19 directories)
- `coordinator/` — unclear if used
- `criteria/` — could be settings sub-page
- `calendar/` — scheduling sub-feature

---

## Summary: Duplication Score

| Category | Count | Risk |
|----------|-------|------|
| A: Active Conflicts | 3 | 🔴 HIGH |
| B: Unnecessary Duplication | 5 | 🟡 MEDIUM |
| C: Unnecessary Route Surface | 3 | 🟡 MEDIUM |
| D: Legacy Aliases | 4 | 🟢 LOW |
| E: Over-Engineering | 2 | 🟡 MEDIUM |
| **Total** | **17 issues** | |
