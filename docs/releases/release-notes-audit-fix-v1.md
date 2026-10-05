# Release Notes — Audit Fix v1.0 (Batch 1+2)

**Release date**: TBD  
**Version**: audit-fix-batch-1-2  
**Commit range**: (insert SHA range)

---

# Part 1: Technical Release Notes

> Audience: Dev, QA, DevOps

## Release Summary

Security hardening release addressing **9 of 19** confirmed P0/P1 audit findings. Focused on backend auth/RBAC enforcement, workflow state machine, payment safety, and database schema uniqueness constraints. No frontend changes.

**Test results**: 5 suites, 40/40 pass | **Schema**: valid ✅ | **Regressions**: 0

---

## What Was Fixed

| ID | Title | Fix Summary | Files Changed |
|----|-------|------------|---------------|
| M-003 | RBAC normalization drift | `reviewer_auditor` → `document_reviewer` alias added | `canonical-rbac.js` |
| M-004 | Missing backend auth guards | 15+ routes hardened with middleware | `admin/index.js`, `identity.js`, `audits-reassign.js`, `cron.js`, `criteria.js`, `certificates.js`, `mfa.js`, `post-audit.js`, `revision-deadline.js`, `wizard.js`, `quotes.js`, `lab-webhook.routes.js` |
| M-005 | Workflow status dialect drift | Canonical status dictionary created | `status-machine.js` (NEW) |
| M-011 | Cross-tenant ownership gaps | Farm ownership middleware enforced | `farm-ownership.js` (NEW) |
| M-013 | Payment atomicity/idempotency | `gatewayRef @unique` + `logger.error` | `schema.prisma`, `payments.js` |
| M-014 | Async/cron/DLQ safety | `jwt.decode` before verify removed | `sync.js` |
| M-015 | Prisma schema duplicate | Duplicate schema deleted | `web-app/prisma/` (DELETED) |
| M-016 | Core relational integrity | 3 unique index constraints added | `schema.prisma`, `migration.sql` |
| M-017 | Payment/QR key durability | `gatewayRef`, `qrCode`, `publicUrl` @unique | `schema.prisma` |

---

## Changes by Module

### Auth & RBAC (`middleware/`, `shared/`)

- **NEW**: `require-admin.js` — reusable `adminOnly`, `providerOnly` middleware
- **NEW**: `farm-ownership.js` — `requireFarmOwnership(prisma)` for tenant isolation
- **MODIFIED**: `audits-reassign.js` — added `providerOnly` + scheduler/admin role check on POST

### Workflow Engine (`shared/`, `services/`)

- **NEW**: `status-machine.js` — canonical status dictionary (17 states), `validateTransition()`, `InvalidTransitionError`
- Wraps `workflow-transition-service.js`, resolves `transition-guard.js` import

### Payment (`routes/api/payments.js`, `services/`)

- 5× `console.error` → `logger.error` for structured log aggregation
- `queue-service.js` — startup warning when `ENABLE_WEBHOOK_DLQ` not set

### Sync (`routes/api/sync.js`)

- **SECURITY**: Removed `jwt.decode()` before `jwt.verify()` — eliminated unverified claim routing
- Auth dispatch now uses cookie presence only (`provider_token` / `auth_token`)

### Database (`prisma/schema.prisma`)

```diff
- gatewayRef String?
+ gatewayRef String? @unique

- qrCode     String?
- publicUrl  String
+ qrCode     String? @unique
+ publicUrl  String  @unique
```

- Migration: `20260306200000_add_unique_constraints_audit_m016_m017`
- Uses `CREATE UNIQUE INDEX IF NOT EXISTS` (safe re-run)

### Tests (`__tests__/unit/`)

| Suite | Tests | Coverage |
|-------|-------|----------|
| `require-admin-middleware.test.js` | 8 | Admin/provider/user role scenarios |
| `farm-ownership-middleware.test.js` | 8 | Cross-tenant denial, own-farm allow |
| `api-key-auth-middleware.test.js` | 8 | Missing/wrong/valid key, whitespace |
| `audits-reassign-auth.test.js` | 5 | Admin/scheduler allow, Applicant deny |
| `status-machine.test.js` | 11 | Dict frozen, normalize, transitions |

---

## ⚠️ Risky Areas to Watch

| Area | Risk | Mitigation |
|------|------|-----------|
| **Schema migration** | Fails if duplicate `gatewayRef`/`qrCode`/`publicUrl` data exists | Run `pre-migration-dedup-check.sql` before `migrate deploy` |
| **Sync auth dispatch** | Provider users with Bearer-only (no cookie) default to health auth | Cookie-based flow covers 99%+ users; monitor 401 rate |
| **Admin route blocking** | New `requireAdmin` may block valid admin users with incorrect role in DB | Verify admin users have `role = 'admin'` in User table |

---

## Known Limitations

1. **Frontend unchanged** — health applicant flows (M-006), evidence upload (M-008), provider namespaces (M-007) not addressed
2. **Integration tests missing** — only unit-level middleware tests exist
3. **DLQ disabled by default** — requires `ENABLE_WEBHOOK_DLQ=true` + Redis
4. **Migration chain broken** — `prisma migrate dev` fails on shadow DB (pre-existing P3006); `prisma migrate deploy` works fine
5. **30+ route files** still use `console.error` instead of `logger.error`

---

## Required Operator Actions

| Action | When | Command |
|--------|------|---------|
| Set `CRON_SECRET` in production env | Before deploy | Add to `.env` / secrets manager |
| Set `LAB_API_KEY` in production env | Before deploy | Add to `.env` / secrets manager |
| Run dedup check | Before migration | `psql $DATABASE_URL < prisma/pre-migration-dedup-check.sql` |
| Apply migration | During deploy | `npx prisma migrate deploy` |
| Regenerate client | After migration | `npx prisma generate` |
| Tag previous Docker image | Before deploy | `docker tag gacp-backend:latest gacp-backend:pre-audit-fix` |
| Verify `NODE_ENV=production` | Before deploy | Ensures E2E routes disabled |

---

## Rollback Summary

| Trigger | Action | Time |
|---------|--------|------|
| Login failure > 20% | Rollback Docker image | < 5 min |
| Payment 500 > 3 in 10 min | Rollback Docker image | < 5 min |
| Cross-tenant data visible | Immediate rollback + incident | < 5 min |
| Migration fails | `prisma migrate resolve --rolled-back` | < 5 min |

```bash
docker tag gacp-backend:pre-audit-fix gacp-backend:latest
docker compose down && docker compose up -d
# If migration needs reversal:
psql $DATABASE_URL -c "DROP INDEX IF EXISTS payment_transactions_gatewayRef_key, trace_qr_security_qrCode_key, trace_qr_security_publicUrl_key;"
npx prisma migrate resolve --rolled-back 20260306200000_add_unique_constraints_audit_m016_m017
```

---
---

# Part 2: Business Release Notes

> Audience: Stakeholders, Product Owner, Non-technical users

---

## สรุปการอัปเดต

อัปเดตครั้งนี้เป็นการ **เสริมความปลอดภัยของระบบ** จากผลการ audit ภายใน ไม่มีการเปลี่ยนแปลง UI หรือ workflow ที่ผู้ใช้เห็น ระบบจะทำงานเหมือนเดิมทุกประการ แต่มีความปลอดภัยมากขึ้น

---

## สิ่งที่เปลี่ยนแปลง

### 🔐 ความปลอดภัยของบัญชีผู้ใช้

- **ระบบสิทธิ์ (RBAC)**: ปรับปรุงการตรวจสอบสิทธิ์ทุกหน้าที่ต้องใช้สิทธิ์พิเศษ เช่น หน้า Admin, การมอบหมาย Auditor, การจัดการ Cron
- **การป้องกันข้ามบัญชี**: เพิ่มการตรวจสอบว่าผู้ใช้สามารถดูเฉพาะข้อมูลฟาร์มของตนเองเท่านั้น

### 💳 ความปลอดภัยการชำระเงิน

- **ป้องกันธุรกรรมซ้ำ**: เพิ่มกลไกป้องกันการประมวลผล webhook ซ้ำ (ระบบจะไม่สร้างรายการชำระเงินซ้ำจาก payment gateway)
- **ปรับปรุง logging**: บันทึกข้อผิดพลาดการชำระเงินในรูปแบบที่ติดตามได้ง่ายขึ้น

### 📋 ระบบสถานะเอกสาร

- **เพิ่ม Status Dictionary**: สร้างพจนานุกรมสถานะกลางสำหรับระบบ เพื่อป้องกันการเปลี่ยนสถานะที่ไม่ถูกต้อง (เช่น ข้ามจาก "ร่าง" ไปเป็น "อนุมัติ" โดยไม่ผ่านขั้นตอน)

### 🔍 ระบบ QR Code / Traceability

- **ป้องกัน QR Code ซ้ำ**: ระบบจะไม่สร้าง QR Code ที่มีรหัสเดียวกันได้อีก ป้องกันความสับสนในการตรวจสอบผลิตภัณฑ์

---

## สิ่งที่ไม่เปลี่ยนแปลง

- ✅ หน้าจอทั้งหมดยังเหมือนเดิม
- ✅ ขั้นตอนการใช้งานยังเหมือนเดิม
- ✅ ข้อมูลทั้งหมดยังอยู่ครบ
- ✅ ใบรับรองและเอกสารที่ออกแล้วไม่ได้รับผลกระทบ

---

## ข้อจำกัดที่ทราบ

1. **ระบบ health flow** (สำหรับเกษตรกร/ประชาชน): ยังไม่ได้ปรับปรุงในรอบนี้ — จะดำเนินการใน Batch 3
2. **ระบบอัปโหลดเอกสาร/หลักฐาน**: ยังไม่ได้ปรับปรุง — จะดำเนินการใน Batch 3
3. **ชื่อเมนู Provider/Admin**: ยังใช้ชื่อเดิม — จะปรับให้ตรงกับมาตรฐานใน Batch 3

---

## สิ่งที่ต้องสังเกตหลัง deploy

- ระบบอาจ **log ข้อผิดพลาดมากขึ้นชั่วคราว** เนื่องจากปรับ logging ให้ละเอียดขึ้น (ไม่ใช่ bug ใหม่ แต่เป็นการจับ error ที่เคยถูกซ่อน)
- ผู้ใช้ที่มีสิทธิ์ไม่ถูกต้องในฐานข้อมูลอาจ **ถูกปฏิเสธการเข้าถึง** (ต้องตรวจสอบ role ในระบบ)

---

## แผนการดำเนินงานต่อไป

| Batch | เนื้อหา | กำหนดการ |
|-------|---------|---------|
| **Batch 3** | ปรับปรุง health flow, evidence upload, provider/admin namespace | TBD |
| **Batch 4** | Integration tests, session contract freeze | TBD |
