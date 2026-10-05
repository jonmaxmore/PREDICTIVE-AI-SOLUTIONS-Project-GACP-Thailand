# PDPA Right-to-Forget — Iter 27 (2026-05-16)

## Legal framework

| Authority | Provision | Effect |
|-----------|-----------|--------|
| Thai PDPA (พระราชบัญญัติคุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562) | ม.32 | Data subject's right to request erasure / anonymisation of personal data |
| Thai PDPA | ม.24(6) | Lawful basis "ปฏิบัติตามกฎหมาย" overrides erasure for data the operator is legally compelled to retain |
| Thai Revenue Code (ประมวลรัษฎากร) | ม.86/4, ม.87/3 | VAT-registered persons MUST retain tax invoices, credit notes, debit notes, ภ.พ.30 working papers, and supporting accounting records for >= 5 years (de facto 7 years per Revenue Department guidance + TFRS for NPAEs) |
| Thai e-Transactions Act (พระราชบัญญัติว่าด้วยธุรกรรมทางอิเล็กทรอนิกส์ พ.ศ. 2544) | §31 | Immutable audit trail required for electronic transactions; AuditLog rows MUST NOT be deleted |
| DTAM Bureau of Audit | Cert retention 5y | Certificates retained for at least 5 years after expiry |

The right granted by PDPA ม.32 is NOT absolute. ม.24(6) explicitly defers
to other statutory retention duties. The platform is a VAT-registered
person under ป.รัษฎากร, so the tax/accounting books fall under a
statutory retention regime that overrides the subject's erasure claim
for those rows.

## Erase / anonymise / preserve matrix

### PRESERVED in full (legally compelled — 7 years per ม.87/3 ป.รัษฎากร)

| Table | Reason | Reference |
|-------|--------|-----------|
| `Invoice` | Tax invoice (ใบกำกับภาษี) — 7y retention | ม.86/4 + ม.87/3 |
| `CreditNote` | ใบลดหนี้ — 7y retention | ม.86/10 + ม.87/3 |
| `DebitNote` | ใบเพิ่มหนี้ — 7y retention | ม.86/9 + ม.87/3 |
| `JournalEntry` / `JournalLine` | TFRS for NPAEs accounting record | TFRS for NPAEs ch.2 + ม.87/3 |
| `PaymentSlip` | Bank-reconciliation evidence; `bankRef` plaintext required for monthly recon against gateway feed | ม.87/3 |
| `PaymentTransaction` | Gateway / SCB record | ม.87/3 |
| `AuditLog` | Immutable hash-chained audit trail | Thai e-Transactions Act §31 |

Specifically `PaymentSlip.bankRef` is intentionally NOT in the encryption
scope. The reconciliation worker needs plaintext access to match the
slip row against the bank-feed line. Encrypting it would break monthly
finance close.

### ANONYMISED in place (FK intact, PII cleared)

| Table | Action |
|-------|--------|
| `User` | All PII columns cleared: `healthId`, `providerId`, `idCard`, `taxId`, `email`, `phoneNumber`, `address`/`province`/`district`/`subdistrict`/`zipCode`, `companyName`, `representativeName`, `communityName`. `firstName`/`lastName` set to sentinel `'PDPA_ERASED'` so non-null joins still render. `password` set to `'PDPA_ERASED'`, 2FA cleared. `isDeleted=true`, `deletedAt=now`. |
| `Application.formData` (JSON) | Known PII leaves (`applicantName`, `applicantPhone`, `applicantEmail`, `applicantAddress`, `thaiId`, `nationalId`, ...) cleared to null. Non-PII fields (`areaSize`, `cropType`, ...) preserved. The application ROW + `applicationNumber` are kept so audit/invoice references resolve. |
| `Certificate` | `applicantName` cleared to sentinel, `address` cleared to null. `certificateNumber`, `farmId`, dates preserved so a QR-code verifier can still confirm "this certificate is valid", but the human identity behind it is hidden. |

### ERASED (hard delete)

| Table | Reason |
|-------|--------|
| `ApplicationDraft` | Working copy with no legal retention |
| `Notification` | Per-user notifications — no statutory duty to retain |
| Per-user session tokens, refresh tokens, consent cookies | Session state — credentials path |

## Two-step request -> confirm flow

A one-click "delete my account" button is rejected by the threat model:
a hijacked session or coerced user could trigger irreversible erasure.
We therefore require:

1. **POST `/api/pdpa/erasure/request`** (HEALTH self-service)
   - Body: `{ reason?: string }`
   - Subject resolved from `req.user.canonicalId` (NEVER from request body)
   - Service generates a 32-hex-char single-use token + 24-hour window
   - Token persisted inside `User.privacySettings.pdpaErasure` (already
     covered by the Phase-1 encryption envelope on the privacySettings
     JSON when at-rest encryption flips on)
   - Notification (`PDPA_ERASURE_REQUESTED`) fan-out delivers token via
     email; HTTP response returns only `requestId` + `expiresAt`
   - Response status: `202 Accepted`

2. **POST `/api/pdpa/erasure/confirm`** (HEALTH self-service)
   - Body: `{ requestId, token }`
   - Constant-time token comparison via `crypto.timingSafeEqual`
   - Validations: requestId matches, status is `REQUESTED`, window
     unexpired
   - Triggers `executeErasure` inside a single `prisma.$transaction`
     so partial failure rolls back

3. **POST `/api/pdpa/erasure/:id/cancel`** (HEALTH self-service)
   - Flips status to `CANCELED`, strips token from envelope

4. **GET `/api/pdpa/erasure/requests`** (ADMIN)
   - Lists envelopes scoped to `organizationId` (or caller's org by default)
   - Token field intentionally REDACTED from the admin view

## Status state machine

```
REQUESTED ──confirm──> EXECUTED
    │                  ▲
    ├──cancel─────> CANCELED
    │
    └──window passes─> EXPIRED
```

The envelope itself is never deleted from `User.privacySettings` — it
remains as a structured audit marker on the user row. The `AuditLog`
hash chain has the canonical record of every state transition.

## Audit trail

Every state transition writes an `AuditLog` row through `auditLogger.log`:

| Action | Category | Severity |
|--------|----------|----------|
| `PDPA_ERASURE_REQUESTED` | SECURITY | INFO |
| `PDPA_ERASURE_CANCELED`  | SECURITY | INFO |
| `PDPA_ERASURE_EXECUTED`  | SECURITY | WARNING |

The `PDPA_ERASURE_EXECUTED` metadata embeds:
- counts of anonymised vs. erased rows
- the preserved-table list (Invoice/JournalLine/PaymentSlip/AuditLog/...)
- `legalBasis: ['PDPA ม.32', 'ม.87/3 ป.รัษฎากร']`

The legal-basis citation lets a future PDPA audit reconstruct, from the
audit row alone, that the operator (a) honored the data subject's
ม.32 request AND (b) preserved exactly the rows mandated by ม.87/3.

## Field-level encryption surface (Iter 27 additions)

The Prisma PDPA extension (`services/prisma-pdpa-extension.js`) is
env-gated by `ENABLE_PDPA_FIELD_ENCRYPTION=true`. AES-256-GCM with
random per-call IVs, version prefix `enc:v1:`, key derived from
`ENCRYPTION_KEY` via SHA-256 (matches `shared/encryption.js`).

### Phase 1 (pre-existing, 2026-05-15)

```
User: idCard, taxId, laserCode, communityRegistrationNo,
      address, province, district, subdistrict, zipCode
```

### Phase 2 (Iter 27, 2026-05-16)

```
User: phoneNumber, firstName, lastName
Certificate: applicantName, address
```

All Phase 2 additions verified zero `where:` matches across
`apps/backend/**` before joining the encryption scope.

### Still NOT in scope (would break queries)

```
User: healthId, providerId, email
```

`healthId`/`providerId` are heavily WHERE-filtered for applicant lookups
— migration deferred until callers use the `*Hash` HMAC columns.
`email` is the login key — migration deferred until a parallel
`emailHash` column lands.

### Application.formData encryption — service-layer concern

`Application.formData` is a free-form JSON column. The extension does
NOT traverse JSON — Prisma's JSON-path filtering would silently break
under transparent encryption. PII leaves inside formData are scrubbed
by the erasure flow's `_sanitizeApplicationFormData` walker rather than
encrypted at rest. The application-service is responsible for not
persisting plaintext PII into formData; a future iteration can move
selected leaves into per-column encrypted shadows.
