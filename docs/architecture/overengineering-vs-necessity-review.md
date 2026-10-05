# Overengineering vs Necessity Review — GACP Platform

> Classification of complexity: necessary, accidental, legacy, or bug.

## Issue Inventory

### 1. Triple-Write for State
**Files**: `workflow-transition-service.js`, Prisma schema
**Finding**: Application state stored in `state`, `status`, AND `formData.workflowState`
**Classification**: ⚠️ Accidental complexity
**Reason**: Prisma schema has `state` field; business logic writes to `status` and `formData.workflowState`; a DB trigger syncs `state`↔`status`. Three sources for one truth.
**Resolution**: Accept as operational reality — DB trigger handles sync. Document clearly. Don't add a fourth.

### 2. Two Dashboard Stage Models (RESOLVED)
**Classification**: ✅ Fixed (Batch 1)
**Resolution**: Backend upgraded from 5-stage to 8-stage, aligned with frontend.

### 3. Two Workflow Re-export Files (RESOLVED)
**Classification**: ✅ Fixed (Batch 2)
**Resolution**: Both reduced to 1-line re-exports. Canonical service consolidated.

### 4. Two Validation Systems (RESOLVED)
**Classification**: ✅ Fixed (Batch 3)
**Resolution**: `isStrongPassword` aligned with Zod rules.

### 5. 20 Health-side Page Directories
**Classification**: ⚠️ Over-engineering
**Finding**: 9 of 20 pages are post-certification features shown to all users
**Resolution**: Navigation simplified to 6 primary items (Batch 5)

### 6. 4 Audit Route Mounts
**Classification**: ⚠️ Accidental complexity
**Finding**: `/audits`, `/audit`, `/farm-audits`, `/post-audit`, `/audits/reassign`
**Resolution**: Can consolidate, but requires API consumer updates (Batch 6)

### 7. 10 Application Route Mounts
**Classification**: ⚠️ Accidental complexity
**Finding**: Main CRUD + car + config + validation + scoring + calculations + deadline + bundles + config + criteria
**Resolution**: Can consolidate under `/applications/*` (Batch 6)

### 8. 7 Navigation Component Files
**Classification**: ⚠️ Over-engineering
**Finding**: Each component hardcodes its own nav items
**Resolution**: Single nav-config.ts (Batch 5)

### 9. 15 Legacy Role Aliases
**Classification**: 🟢 Necessary complexity
**Reason**: JWT tokens from existing users contain legacy role values.
Must maintain aliases until all tokens expire or users re-login.
Managed centrally in `canonical-rbac.js`.

### 10. 25+ Legacy Status Aliases
**Classification**: 🟢 Necessary complexity
**Reason**: Database may contain old status values from historical data.
Managed centrally in `workflow-transition-service.js`.

### 11. 4 Docker Compose Files
**Classification**: ⚠️ Accidental complexity
**Finding**: `docker-compose.yml`, `production`, `local-prod`, `qa`
**Resolution**: Keep dev + production only. QA and local-prod rarely used.

## Summary

| Classification | Count | Action |
|---------------|-------|--------|
| ✅ Fixed | 3 | Done |
| 🟢 Necessary | 2 | Document, don't change |
| ⚠️ Accidental | 5 | Simplify in batches |
| **Total** | **10** | |
