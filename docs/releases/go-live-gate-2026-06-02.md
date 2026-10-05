# GACP Go-Live Gate — Corrected Working Copy

**Date:** 2026-06-02 · **Scope:** **A — Controlled launch (1 farm)** · **Owner:** jonmaxmore

> This corrects the working go-live gate. The biggest correction is in **§E**: the
> "เกณฑ์ผ่าน 80% คำนวณถูก" framing is **void** — there is no automated scoring system.
> Pass/fail is decided **solely by the on-site field-assessment team**. This document
> is reorganised around what was *verified in code* on 2026-06-02; environment-dependent
> rows are bucketed for fresh-droplet runs rather than reproduced verbatim from the
> chat gate.

---

## Operating rules (read first)

1. **This container ≠ production.** The agent's execution container is ephemeral: no
   production `DATABASE_URL`, no real secrets, no managed Postgres/Redis, reclaimed
   after the session. Nothing run here proves a production property. (Live example:
   `prisma validate` fails in-container with `P1012 DATABASE_URL not found` — an env
   gap, **not** a schema defect.) **Every ⬜ row must be run on a fresh, production-like
   droplet.** "An agent said it works" is not evidence; a logged command + output on the
   target host is.
2. **Code-evidence ≠ runtime-evidence.** ✅(code) = verified by reading source; it still
   needs a ⬜ runtime confirm before it counts as green for go-live.
3. **No fabricated data on outputs downstream depends on** — certificates especially
   (ผิดไม่ได้).

### Status legend
| Mark | Meaning |
|---|---|
| ✅(code) | Verified in source this session — still needs a ⬜ runtime confirm |
| ⬜ | Environment-dependent — run on a fresh prod-like droplet |
| ⚠️ | Accepted risk for Scope A — record reason; revisit before Scope B/C |
| 🔴 | Blocker — must resolve before go-live |
| 🟡→⚠️ | Was a blocker; downgraded by scope (note kept) |

---

## §E — Certification decision & workflow  *(REFRAMED)*

**Correction.** There is **no scoring system**. GACP pass/fail is a **human decision by
the on-site field-assessment team** — **PASS / FAIL / NEEDS_REVIEW**. The old
"80% computed correctly" check is removed. The real gate is **workflow integrity**:

| # | Check | Status | Evidence |
|---|---|---|---|
| E1 | On-site auditor records PASS / FAIL / NEEDS_REVIEW | ✅(code) | `audit-onsite-service.submitDecision` (GACP-PRD §6.4) — writes the Audit decision row + transitions state |
| E2 | Issuance gated on the **human PASS record**, not a score | ✅(code) | `certificate-service.generateCertificate` refuses without `auditResult='PASS'` (PR-1.3); canonical path `POST /api/audits/:id/result` |
| E3 | No path flips status→APPROVED without a PASS record | ✅(code) | gate accepts either the column path (`Application.auditResult`) or JSON path (`formData.auditResult` + `auditedAt`) |
| E4 | E2E run on fresh env: apply → doc review → schedule → on-site PASS → cert issued | ⬜ | fresh-env |

---

## §F — Certificate truth  ⭐  *(ผิดไม่ได้)*

| # | Check | Status | Evidence / note |
|---|---|---|---|
| F1 | Certificate carries **no fabricated score** | ✅ **FIXED 2026-06-02** | Removed the `score` (gacp-scoring-service % / hardcoded fallback **100**) from the cert data, the Prisma column, **and** the content-integrity hash. Migration `20260602120000_drop_certificate_score`. |
| F2 | Cert fields pulled from real source (farm / applicant / location) | ✅(code) → ⬜ | `certData` maps from `Application` / `Farm` / `applicant`; confirm against a real record on fresh env |
| F3 | Content-integrity hash detects tampering | ✅(code) | `buildCertificateDocumentHash` = SHA-256 over canonical fields. **Caveat:** F1 changed the canonical → any certificate issued *before* this change re-hashes as "tampered". Safe pre-go-live (no real certs issued); re-hash plan in the migration header if any exist. |
| F4 | Cert template diffed vs the official DTAM sample cert | 🟠 **done — discrepancies found (2026-06-02)** | Diffed `certificate.html` vs the in-repo sample `docs/architecture/2026-04-28-sample-gacp-certificate.pdf`. ✅ Official cert shows **no score** (binary PASS) → F1 removal validated. ⚠️ 4 layout discrepancies need DTAM sign-off (table below). Resolve before `export_documents` is enabled. |
| F5 | `export_documents` stays **OFF** until F4 passes | ⬜ | confirm flag state on fresh env |

### §F4 diff — live template vs official DTAM sample (2026-06-02)

Official sample = `docs/architecture/2026-04-28-sample-gacp-certificate.pdf`
(`GACP-2569-DEMO-0001`). Live template = `services/pdf/templates/certificate.html`
(B23 redesign, 2026-05-16 — **newer** than the sample, so some deltas may be
intentional; DTAM confirms which are regressions).

| Field | Official sample | Live template | Verdict |
|---|---|---|---|
| Score / คะแนน | absent (binary "ได้ผ่านการประเมิน…") | absent | ✅ removal validated |
| Title | "ใบรับรองมาตรฐานการปฏิบัติทางการเกษตรที่ดี / CERTIFICATE OF GOOD AGRICULTURAL AND COLLECTION PRACTICES (GACP)" | "ใบรับรองมาตรฐาน GACP" (shorter) | ⚠️ wording differs |
| National ID | not shown | shows a **masked** ID `X-XXXX-XXXXX-XX-X` (`maskNationalId`, middle 5 hidden) | ⚠️ official omits it entirely — policy question (show a masked ID or not?), **not** a raw-PII leak |
| มาตรฐาน / Standard | shown ("GACP-WHO-2003-Adapted / GACP Thai") | **not rendered** | ⚠️ missing field |
| Farm name | distinct "ฟาร์ม / Farm : [name]" line | only `{{FARM_LOCATION}}` (FARM_NAME token unused) | ⚠️ farm name likely missing |
| Crop | "กัญชา (Cannabis sativa)" | `{{CULTIVATION_METHODS}}` | ~ semantics differ (crop vs methods) |
| Cert No · dates · QR · signer · Garuda · DTAM footer | present | present | ✅ match |

**Findings, not fixes — what the cert must show is a DTAM / regulatory decision
(ผิดไม่ได้). Resolve before `export_documents` is enabled.**

---

## §G — Pricing / billing / accounting (GL)

**Correction (2026-06-02):** an earlier draft of this gate called §G "pricing not built /
GL off via middleware." That was **unverified and wrong**. On inspection the billing +
accounting suite is **built and role-gated**, not absent:
- **18 services** — `fee-service`, `invoice-service`, `payment-service` (+ phase-flow /
  webhook-flow / legacy), `phase-billing-service`, `quote-service`,
  `split-payment-calculator`, `receipt-numbering-service`, `payment-slip-service`,
  `subscription/` …
- **9 models** — `Invoice`, `InvoiceLineItem`, `Subscription`, `Quote`,
  `PaymentTransaction`, `PaymentAudit`, `PaymentReconciliation`, `PaymentSlip`,
  `ReceiptSequence`.
- **"GL" = General Ledger (accounting), not "go-live."** Thai-tax-compliant finance
  suite under `routes/api/finance/` (Trial Balance · P&L · Balance Sheet · General
  Ledger · WHT · credit/debit notes · refunds กรมบัญชีกลาง · period-close), **role-gated**
  to `ACCOUNT_PLATFORM` / `ACCOUNT_DTAM` / `AUDITOR` / `ADMIN` with separation-of-duties.
- Pricing is **config-driven** via `SystemConfig` (`routes/api/finance/pricing.js` →
  `system-config-service.js`); subscription entitlements gate features (`FEATURE_LOCKED`).

| # | Check | Status | Note |
|---|---|---|---|
| G1 | Billing/accounting subsystem exists | ✅(code) | built + role-gated (above) — **not** a build gap |
| G2 | Pilot **pricing config values** set in `SystemConfig` | ⬜ / decision | confirm the real fee amounts for the 1-farm pilot on fresh env — a finance/product decision, not code |
| G3 | Which billing flows are **enabled** for Scope A | ⬜ / decision | if the pilot takes no real payment, fee flows can stay role-gated/dormant (⚠️ accepted-risk) — confirm |
| G4 | Billing runtime correctness (invoice → slip → reconcile) | ⬜ | fresh-env E2E; code-evidence only so far |

---

## §A–C / §J–L — Infra, HA, load, monitoring  *(fresh-env / scope-gated)*

| Section | Area | Status (Scope A) | Note |
|---|---|---|---|
| A–C | Provisioning · secrets · TLS · backups · **migrations** | ⬜ | Fresh-env runs. Migrations now include `20260602120000_drop_certificate_score`. **Heed `prisma/migrations/_UNREGISTERED_SQL_WARNING.md`:** only `YYYYMMDDHHMMSS_`-prefixed folders are applied by Prisma; loose SQL is ignored — do not rely on it. |
| J | HA / failover | **⚠️ accepted-risk** | Single farm, single node is acceptable for Scope A. 🟡→⚠️. Revisit before Scope B/C. |
| L | Load / capacity | **⚠️ accepted-risk** | Pilot volume; no load test required for 1 farm. 🟡→⚠️. Revisit before Scope B/C. |
| K | Monitoring / alerting | ⬜ | Fresh-env. *(Confirm exact rows against your working gate.)* |

---

## Live blockers (Scope A)

1. 🔴 **F4** — cert PDF not yet diffed vs the real DTAM certificate. Do this before
   `export_documents` is ever turned ON; it also resolves "what replaces the removed score."
2. ⬜ / decision **§G** — billing/GL is **built + role-gated** (not unbuilt; see §G correction).
   Open items are pilot **pricing config** (`SystemConfig` fee values) + which flows are enabled
   for Scope A — a finance/product decision + fresh-env verify, **not a build blocker**.
3. ⬜ **E4 + A–C + K** — fresh-droplet runtime confirmations (this container cannot stand in for prod).

## Resolved on 2026-06-02

- **§E reframed** — the human field-team decision is authoritative; issuance is correctly
  gated on it (✅ code-evidence), not on a score.
- **§F1 fixed** — the fabricated certificate score is removed end-to-end (code + schema +
  content hash + migration).
- **§G corrected** — billing/accounting (GL) is built + role-gated, not "unbuilt / off via
  middleware"; the open items are pilot pricing config + enablement decisions (see §G).
- **Scope locked to A** (controlled, 1 farm); **§J / §L downgraded 🟡→⚠️**.
- **Operating rule established** — container ≠ production; ✅(code) ≠ runtime-green.
