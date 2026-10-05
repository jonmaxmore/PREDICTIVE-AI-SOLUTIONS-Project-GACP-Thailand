<!--
  GACP Pull Request Template — production-grade certification system.
  Tick every box that applies. If a section does not apply, write "n/a"
  in front of the section header. Do NOT delete sections — reviewers
  rely on the structure being stable.
-->

## Summary

<!-- 1-3 sentences. What does this PR do, and why? -->

## Linked issues / decisions

<!-- e.g. closes #123, ADR-014 Phase 3b PR D, security-issue-XXX -->

## Type

- [ ] feat — user-visible feature
- [ ] fix — bug fix
- [ ] refactor — no behavior change
- [ ] perf — performance only
- [ ] docs — docs only
- [ ] infra — CI / docker / nginx / deploy
- [ ] schema — Prisma migration / DB change
- [ ] security — security fix or hardening

## Workflow surfaces touched

Tick each that applies. The reviewer will look harder at these.

- [ ] application submit / draft
- [ ] document review (approve / reject / rejection count)
- [ ] payment (5,000 THB document review fee)
- [ ] payment (25,000 THB assessment fee)
- [ ] payment (resubmission fee on 3rd rejection)
- [ ] audit scheduling (online / onsite)
- [ ] audit result (pass / fail / evidence)
- [ ] certificate generation
- [ ] QR / public verify
- [ ] track & trace
- [ ] notifications
- [ ] dashboard counts
- [ ] role-based access (HEALTH / PROVIDER / REVIEWER / SCHEDULER / AUDITOR / ADMIN)
- [ ] tenant scoping (ADR-014)
- [ ] none

## Identity model — naming check

- [ ] No new occurrences of `farmerid` / `farmerId` / `staffid` / `staffId`
- [ ] All new identity references use `healthid` (applicant) or `providerid` (staff)
- [ ] If legacy names are kept, they are clearly marked as a migration shim

> ### ⚠️ ตรวจด้วยตา — CI ไม่ได้ตรวจให้ (2026-08-04)
> สองข้อนี้ **ไม่มีเครื่องมืออัตโนมัติบังคับ** ผู้ review ต้องอ่าน diff เอง · **CI เขียวไม่ใช่คำรับรอง**
>
> - [ ] ไม่มีจุดไหนเอา MOPH `provider_id` (**เลขใบประกอบวิชาชีพ**) เขียนลง `users.providerId` / `providerIdHash` / `providerIdHmac` (**เลขบัตรประชาชน**) — สองชื่อนี้ต่างกันแค่ underscore แต่เป็นคนละข้อมูล คนละกฎหมาย · การปนกันแก้ย้อนไม่ได้เพราะสองค่าอยู่ในคอลัมน์เดียวกันแล้ว
> - [ ] ไม่มีโค้ดแอปเขียน (create/update/upsert/delete) ตาราง `identity_links` — ยังติดธง **D-MANUAL-HASHCID** · การ **อ่าน** ทำได้ปกติ
>
> `__tests__/unit/identity-provider-naming-collision.test.js` จับได้เฉพาะรูปที่ตรงไปตรงมาที่สุดในไฟล์เดียว · **ไม่ครอบ** การเขียนผ่านตัวแปร / พารามิเตอร์ / computed key / destructure-rename + shorthand / raw SQL ที่ชื่อคอลัมน์อยู่ใน double quote / dataflow ข้ามไฟล์ — ขอบเขตเต็มอยู่ในหัวไฟล์นั้น หัวข้อ (ค) · หลักฐาน `evidence/AUTH-01/A/audit-round3-verdict.md`

## Business logic correctness

- [ ] State transitions are validated (invalid transitions are blocked)
- [ ] Rejection count is incremented correctly (third reject triggers new resubmission fee per business rule)
- [ ] Approval unlocks the correct next fee / step
- [ ] Scheduler can schedule only after assessment fee is paid
- [ ] Auditor sees only assigned audits
- [ ] Online audit supports a meeting link; onsite audit supports evidence upload

## Security & authorization

- [ ] Every new route uses `authenticateHealth` / `authenticateProvider` / `authenticateAny` / `optionalAuth`
- [ ] Every `GET /:id` filters by `req.user.healthId` / `providerId` / `organizationId` (no IDOR)
- [ ] Public endpoints are intentionally public (cite the reason in the description if you added one)
- [ ] No client-supplied amount / fee / role / status is trusted
- [ ] File uploads validate MIME and size on the server
- [ ] No secrets, API keys, or credentials in code or commit messages

## Payment integrity

- [ ] Payment amount is computed server-side from invoice / SKU / fee config
- [ ] Paying an already-paid invoice is idempotent (no double-charge, no re-unlock)
- [ ] Successful payment writes to the audit log
- [ ] Failed / refunded payments transition state correctly

## Certificate & QR

- [ ] Certificate issuance is gated on an actual audit pass record
- [ ] QR URL points at the verify endpoint and contains only verification-grade fields (no PII)
- [ ] Revoked / expired certificates return the right verify-page state
- [ ] No hardcoded certificate data

## Multi-tenancy (ADR-014)

- [ ] Every Prisma write to a tenant-scoped model (see `TENANT_SCOPED_MODELS` in `apps/backend/services/tenant-prisma-extension.js`) runs inside an authenticated request OR is wrapped in `runWithTenantContext`
- [ ] Platform-admin handlers wrap their Prisma calls in `withoutTenantScope`
- [ ] `npm run check:tenant-conventions` passes

## Database

- [ ] Migrations are forward-compatible (no destructive change without backup plan)
- [ ] Foreign keys / indexes / unique constraints are correct
- [ ] Soft delete (`isDeleted`, `deletedAt`, `deletedBy`) is respected on new tables
- [ ] No seed / mock data leaks into production

## Audit log

- [ ] Critical state changes call `auditLogger.log({...})` (login, payment status, review decision, schedule create/update, audit result, cert create/revoke, admin override)

## Tests

- [ ] Unit tests added or updated
- [ ] Integration tests added or updated (where there's a service / DB boundary)
- [ ] E2E tests updated (where there's a user-facing flow change)
- [ ] Role-based tests cover each role that can hit the changed surface
- [ ] `npm test` passes locally
- [ ] `npm run check:no-new-eslint-warnings` passes
- [ ] `npm run check:tenant-conventions` passes (if you touched tenancy)

## Deploy & rollback

- [ ] Migration is idempotent or has explicit rollback steps in the PR description
- [ ] Env var changes are reflected in `.env.example`
- [ ] If this is a destructive infra change, the rollback command is in the PR description

## Screenshots / recordings (UI changes only)

<!-- Drop in screenshots or short recordings for any UX-affecting change. -->

## Test plan

<!--
  Checklist of how a reviewer can verify this PR. Be specific. Include
  the exact role to log in as, the exact route to visit, and the exact
  outcome to look for.
-->

- [ ]
- [ ]
- [ ]

