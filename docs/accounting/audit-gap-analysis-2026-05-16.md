> ## ⚠️ เอกสารนี้บันทึกโมเดลที่เลิกใช้แล้ว (ปักป้าย 2026-09-05)
>
> เนื้อหาด้านล่างเขียนขึ้นภายใต้โมเดล **two-money-flow / ตัวแทนรับชำระ** ซึ่งถูกยกเลิกโดย
> มติ operator W14 (2026-08-22) และมติ 2026-09-05 · จุดยืนปัจจุบัน: **บริษัทเป็นผู้ออกเอกสารรายเดียว
> เก็บ VAT 7% บนค่าบริการทั้งก้อน ไม่มีส่วนใดยกเว้นภาษี และบริษัทจ่ายกรมฯ ภายหลังในฐานะต้นทุน**
>
> เก็บไว้อ่านเป็นบันทึกประวัติ — **อย่านำตัวเลข ผังบัญชี หรือข้อสรุปทางภาษีในนี้ไปใช้**
> ความจริงปัจจุบันอยู่ที่ `docs/architecture/fee-model-2026-09-05.md`

# GACP Platform — Accounting & Finance Gap Analysis

**Date**: 2026-05-16
**Type**: READ-ONLY senior accounting / finance systems audit
**Scope**: Payment intake, document issuance, approval workflow, journal posting, financial reports, UX (applicant + finance staff)
**Repo root**: `C:\Users\charo\GACP-Application\GACP-Certification-Application`
**Method**: Direct source inspection only — no guessing, every claim cites a file path and (where load-bearing) line numbers.

The platform implements TWO legal-entity money flows ("two-money-flow"): the applicant transfers state fees DIRECTLY to กรมบัญชีกลาง (DTAM revenue account, ธนาคารกรุงไทย 4750134376) and platform fees + VAT 7% to the Predictive AI Solution Co., Ltd. corporate bank account. The platform's books recognise ONLY platform revenue + Output VAT — state fees never post to its general ledger. This model is owner-confirmed (2026-05-16, batch B16-C) and the journal-entry service explicitly short-circuits STATE invoices with `{ skipped: true, reason: 'STATE_FEE_NOT_IN_PLATFORM_BOOKS' }`.

---

## Section 1 — Inventory of what EXISTS

### A. Payment intake

| Capability | File(s) | Status |
|---|---|---|
| Slip upload service + state machine | `apps/backend/services/payment-slip-service.js` | Complete. PHASE_1/PHASE_2 + SUBSCRIPTION paths, supersede-on-reupload, atomic transaction with invoice + journal entry + status writer (lines 596-677) |
| Slip upload route (multipart, 5 MB, JPG/PNG/PDF) | `apps/backend/routes/api/finance/payment-slips.js` (lines 60-63, 144-244) | Complete |
| SHA-256 file integrity | `apps/backend/services/slip-hash-integrity.js`; computed at route boundary (`payment-slips.js:189-203`) | Implemented but **hash stored on `Attachment` table only** (`apps/backend/prisma/schema/attachment.prisma:56`). `PaymentSlip` model itself has NO `fileHash` column (`apps/backend/prisma/schema/billing.prisma:418-482`). Verifying integrity requires joining via polymorphic Attachment row. |
| PromptPay QR / bank account | `apps/backend/config/invoice-issuers.js` (`DTAM_BANK_ACCOUNT`, `PLATFORM_BANK_ACCOUNT`); `BankAccount` Prisma model + `IssuerBankAccount` model (`billing.prisma:373-413`, `755-771`) | Complete for DTAM defaults; `PLATFORM_BANK_ACCOUNT` defaults to `PENDING_FINANCE_CONFIRMATION` sentinel (`invoice-issuers.js:403-404`). Startup validator exists (`listPendingIssuerFields`, line 495). |
| Two-side parallel intake (DTAM + PLATFORM) | `payment-slip-service.js` `classifyInvoiceSide` + `resolveAllowedIssuerSides` (lines 37-84); `TwoCardPaymentSection.tsx`; `PaymentInvoiceCard.tsx` | Complete |

### B. Document issuance per fee transaction

| Document | File(s) | Status |
|---|---|---|
| Quotation (QT-DTAM-๒๕๖๙-… / QT-PRD-2026-…) | `apps/backend/services/quotation-service.js`; `Quotation` Prisma model (`billing.prisma:670-730`) | Complete. Issued in pairs (DTAM + PLATFORM) per application; idempotent. `Decimal(15,2)` money columns. Status machine DRAFT→SENT→PENDING→ACCEPTED→INVOICED→REJECTED→EXPIRED |
| Invoice | `apps/backend/services/invoice-service.js`; `Invoice` Prisma model (`billing.prisma:3-113`) | Complete for legacy flow. **subtotal / vat / totalAmount are `Float`** (lines 40-42) — see Section 3 |
| Tax Invoice / Government Revenue Receipt PDF templates | `apps/backend/services/pdf/templates/{tax-invoice,government-revenue-receipt,invoice,receipt,quotation}.html`; rendered by `services/pdf/invoice-template-service.js` | Complete |
| Receipt numbering | `apps/backend/services/receipt-numbering-service.js`; `ReceiptSequence` Prisma model (`billing.prisma:607-629`) | Complete. Atomic serializable allocator. Two streams: `RCP-DTAM-๒๕๖๙-๐๐๐๐๐๑` (Thai numerals + BE year) and `TAX-PRD-2026-000001` (Arabic + CE) |
| Auto digital signing on approval | `apps/backend/services/receipt-auto-sign-service.js` | Complete. Two RSA key namespaces (`rsa:dtam-receipt`, `rsa:platform-receipt`). Falls back to single key with loud warning if namespaced key absent |

### C. Approval workflow

| Concern | Where | Status |
|---|---|---|
| Slip review with side-split (ACCOUNT_DTAM vs ACCOUNT_PLATFORM) | `payment-slip-service.js:556-744` (`approveSlip`, `rejectSlip`); `routes/api/finance/payment-slips.js:354-482` | Complete with SoD enforcement: cross-side approval throws `INVALID_REVIEWER_SIDE` (HTTP 403). ADMIN bypasses with `[admin-override]` audit marker |
| Slip approve → invoice PAID → journal entry → digital sign (atomic) | `payment-slip-service.js:596-677` — wrapped in `prisma.$transaction` with `journalEntryService.recordPaymentEntry(... { tx })` | Complete. Rolls back if journal write fails |
| Rejection with reason (≥ 10 chars) | `payment-slip-service.js:753-829` | Complete |
| SLA breach detection | `accounting-service.js:41` (`SLIP_SLA_HOURS = 24`); frontend `provider/accounting/page.tsx:66` | Complete (UI badge `ค้างเกิน 24 ชม.`). **No automated alerting cron** found |
| Audit log of approval events | `routes/api/finance/payment-slips.js:96-114`, `385-401`, `446-457`; `services/audit-trail.js` | Complete with hash-chain (`previousHash`/`currentHash` verified at read) |

### D. Accounting / bookkeeping (journal layer)

| Capability | File(s) | Status |
|---|---|---|
| Journal entry auto-posting | `apps/backend/services/journal-entry-service.js` (`recordPaymentEntry`, `recordRemittanceToDtam`) | Complete. Balanced Dr/Cr with `Decimal(15,2)` arithmetic via `round2` |
| Chart of Accounts (Thai NPAE) | `apps/backend/services/chart-of-accounts-service.js` | Complete in-memory; **NO `Account` Prisma table** (line 41 comment: "verified via grep on 2026-05-16"). `seedChartOfAccounts` is a no-op until a table is added |
| DTAM skip rule | `journal-entry-service.js:516-540` (`recordPaymentEntry` short-circuit on `ISSUER.DTAM`) | Complete — returns `{ skipped: true, reason: 'STATE_FEE_NOT_IN_PLATFORM_BOOKS' }` |
| Persistence (DB vs logger fallback) | `journal-entry-service.js:417-454` (`persistEntry`) writes to `JournalEntry`/`JournalLine`; logs `[journal-fallback]` on failure | Complete. Inside a tx the failure re-throws so the surrounding `$transaction` rolls back (lines 593-598) |
| Schema | `apps/backend/prisma/schema/billing.prisma:515-559` (JournalEntry, JournalLine — both `Decimal(15,2)`); `JournalEntry.isDeleted` soft-delete only (lines arrived from migration `20260516010000_add_journal_quotation_receipt_seq_bank_accounts`) | Complete |

### E. Financial reports (TFRS for NPAEs)

| Report | File | Status |
|---|---|---|
| งบทดลอง Trial Balance | `apps/backend/services/trial-balance-service.js` | Complete. UTF-8 BOM CSV export. Excludes 9xxx suspense (collection-agent model invariant) |
| งบกำไรขาดทุน P&L | `apps/backend/services/financial-statements-service.js` | Complete |
| งบดุล Balance Sheet | same file | Complete. Asserts `Assets = Liabilities + Equity` invariant |
| สมุดบัญชีแยกประเภท General Ledger | `apps/backend/services/general-ledger-service.js` | Complete with running balance and opening balance |
| ภ.พ.30 Output VAT | `apps/backend/services/vat-report-service.js` | **Partial — Output VAT only.** Input VAT is explicitly TODO (lines 22-29). Filed monthly by 15th (e-filing, ม.83/8) |
| Bank Reconciliation | `apps/backend/services/bank-reconciliation-service.js` | Complete. **`bookSide` parameter is REQUIRED** (no default) per B16-C |
| Reports routes | `apps/backend/routes/api/finance/reports.js`, `tax-reports.js`, `reconciliation.js` | Complete; org-scoped; audit-logged `FINANCE_REPORT_EXPORTED`. ACCOUNT_DTAM is INTENTIONALLY EXCLUDED from `/api/finance/reports/*` (DTAM books live in กรมบัญชีกลาง's systems) |

### F. UX

| Surface | File(s) | Status |
|---|---|---|
| Applicant — two-card payment page | `apps/web-app/src/components/payments/TwoCardPaymentSection.tsx`, `PaymentInvoiceCard.tsx` | Complete. Responsive (md+ grid-cols-2, mobile stacks state-side first) |
| Applicant — slip upload modal | `apps/web-app/src/app/health/payments/slip-upload-modal.tsx` | Complete |
| Finance staff — slip queue, side-filtered | `apps/web-app/src/app/provider/accounting/page.tsx` (lines 68-799); chips hidden for DTAM staff |
| Finance staff — 5-tab reports page (Trial Balance, P&L, BS, GL, Output VAT) | `apps/web-app/src/app/provider/accounting/reports/page.tsx` + sibling tabs | Complete. ACCOUNT_DTAM blocked with Thai "ไม่มีสิทธิ์เข้าถึง" |
| Role-based gating | `lib/constants/canonical-roles.ts` (`getAccountSide`); RBAC matrix in `apps/backend/shared/canonical-rbac.js` | Complete |

---

## Section 2 — GAPS (ranked by Thai accounting law + production SaaS expectations)

Legend: **P0** = blocks production for a Thai SME; **P1** = important but not blocking; **P2** = nice-to-have

### P0 — Production blockers

#### P0-1. Credit Note (ใบลดหนี้) — MISSING
- **Legal**: ป.รัษฎากร ม.86/10 requires a credit note any time an invoice amount is reduced (price adjustment, service withdrawal, refund).
- **Evidence of absence**:
    - `Glob **/credit-note*` → no files
    - `Grep "CREDIT_NOTE|ใบลดหนี้"` → no matches anywhere in repo
    - No `CreditNote` Prisma model in `apps/backend/prisma/schema/billing.prisma`
- **Impact**: Any cancelled / withdrawn application after a paid invoice has NO compliant way to reverse the VAT amount on ภ.พ.30. Reversing entries in `journal-entry-service.js` exist conceptually (`buildRemittanceEntryLines`) but there is no Credit Note document, no separate numbering bucket (`receipt_sequences.documentType='CREDIT_NOTE'` not used), and no PDF template.
- **Frequency**: Inevitable — applicants will withdraw, refund disputes occur, miscalculations on `totalAreaTypes` happen.

#### P0-2. Refund / cancellation money-flow — MISSING
- **Evidence**:
    - `subscription-order-service.js:233-256` cancels subscription with `cancelledAt`/`cancelReason` but explicit comment "no prorated refund — subscription was already paid" (line 17)
    - `invoice/invoice-finance-ops.js:94-107` (`forfeitRevenue`) marks invoice FORFEITED with a note. **No reversing journal entry, no money returned, no credit note**
    - No `RefundService`, no refund route under `routes/api/finance/`
- **Impact**: Once a slip is approved and journal entry posted, there is no codified path to (a) reverse the GL entry, (b) issue a refund slip, (c) generate a credit note. Finance must do all three by hand.

#### P0-3. Decimal type inconsistency across billing domain — MISSING uniformity
- **Evidence** (`apps/backend/prisma/schema/billing.prisma`):
    - `Invoice.subtotal`, `Invoice.vat`, `Invoice.totalAmount` → `Float` (lines 40-42)
    - `Quote.subtotal/vat/totalAmount` → `Float` (lines 218-220)
    - `Quotation.subtotal/vat/totalAmount` → `Decimal(15,2)` (lines 689-691) — NEW canonical
    - `PaymentSlip.amountClaimed`, `PaymentSlip.amountVerified` → `Int` (satang, ×100) (lines 450, 461)
    - `PaymentTransaction.amount` → `Int` (satang) (line 275)
    - `JournalLine.debit/credit/taxableAmount` → `Decimal(15,2)` (lines 544-552)
    - `Subscription.priceTHB` → `Float` (line 175)
    - `PaymentReconciliation.totalAmount` → `Float` (line 360)
- **Same domain, four units**: Float baht, Decimal baht, Int satang, in-app `round2(Number)`. Money arithmetic across `Invoice → JournalEntry → PaymentSlip` necessarily crosses three unit systems. TFRS for NPAEs requires exact decimal math.
- **Concrete bug surface**: `payment-service-phase-flow.js:139,273` does `amount: phase1Amount * 100` (baht→satang); `payment-service-webhook-flow.js:257,283` is "mixed; verify each caller" per the schema comment (lines 273-274). The mixed mode is documented as fragile but unfixed.
- **Impact**: Sub-satang rounding errors compound. Trial balance discrepancy detector exists (`trial-balance-service.js:243` tolerates 0.005 THB) but only catches journal-side imbalance — does not catch Invoice.totalAmount vs JournalLine sum mismatch.

#### P0-4. AR Aging (รายงานลูกหนี้ค้างชำระ) — MISSING
- **Evidence**: `Grep "ar.aging|ar-aging|aged.receivables|ลูกหนี้ค้างชำระ"` → no matches
- **Account `1130 ลูกหนี้การค้า` exists in CoA** (`chart-of-accounts-service.js:138-143`) marked "For accrual-basis invoicing (future use; cash-basis today)". The platform is currently cash-basis only.
- **Impact**: For corporate (JURISTIC) customers on Net-30 terms (P1-9 below) the platform would need aging buckets (0-30, 31-60, 61-90, >90) — none exist. Today's invoicing model is cash-up-front so the gap is recoverable, but ANY shift to corporate billing will expose this.

### P1 — Important

#### P1-5. Debit Note (ใบเพิ่มหนี้) — MISSING
- **Legal**: ป.รัษฎากร ม.86/9 — when additional charges are added after the original invoice issued.
- **Evidence**: `Grep "DEBIT_NOTE|ใบเพิ่มหนี้"` → no matches.
- **Impact**: Lower frequency than Credit Note but still standard. Same architectural gap.

#### P1-6. Customer Statement (สรุปยอดลูกค้า) — MISSING
- **Evidence**: `Grep "customer.statement|customer-statement|สรุปยอดลูกค้า"` → no matches.
- **Partial workaround**: Applicants see `/api/invoices/my` (their own invoices) via `invoices.js:73-87`. There is no consolidated statement (opening balance, paid invoices, outstanding, period totals).

#### P1-7. Daily Cash Report (รายงานเงินสดรับประจำวัน) — MISSING
- **Evidence**: `Grep "daily.cash|cash.report|รายงานเงินสดรับ"` → no matches.
- **Partial workaround**: Bank reconciliation report (`bank-reconciliation-service.js`) can be run with a one-day window, but the schema/columns are tuned for slip-flow, not "daily cash by issuer side". Side-by-side DTAM vs PLATFORM intraday view is missing.

#### P1-8. Manual Journal Entry by finance staff — MISSING
- **Evidence**: `Grep "manual.journal|adjusting.entry"` → no matches.
- **Today only auto-posted entries exist** (`recordPaymentEntry`, `recordRemittanceToDtam`). Bank charges, FX adjustments, accruals, period-end reclassifications cannot be entered. No route under `routes/api/finance/` accepts a manual journal entry payload.

#### P1-9. Period Close / lock — MISSING
- **Evidence**: `Grep "period.close|closeBooks|lock.period"` → no matches.
- **Partial**: `tax-reports.js` exposes `/period-closable` (line 8 of file) which CHECKS if a period can be closed, but no service ENFORCES the lock. Any backdated journal entry today succeeds because `JournalEntry.entryDate` has no period-lock check.
- **TFRS for NPAEs ch.5** requires the month-end close to be a deliberate event after the trial balance balances.

#### P1-10. Reversing Entries — MISSING
- **Evidence**: `Grep "reversing.entry|reverseEntry"` → no matches.
- **The schema is ready** (`JournalLine.metadata` Json forward-compat field for "reversal markers" — `billing.prisma:553`), but no service builds a reversing entry for an existing JournalEntry. Header comment in `journal-entry-service.js:96-97` says "corrections must be posted as a REVERSING entry … not by editing lines" — but there is no `recordReversingEntry()` function.

#### P1-11. Petty cash / vendor payments — MISSING
- **Evidence**: `Grep "petty.cash|pettyCash|vendor.payment|รายจ่าย"` → no matches in services.
- **CoA has `2110 เจ้าหนี้การค้า` and `5110 ค่าใช้จ่ายในการดำเนินงาน`** (`chart-of-accounts-service.js:147-152, 251-257`) ready, but no flow for finance to (a) record a vendor invoice, (b) approve payment, (c) post Dr Expense / Cr Cash. ผู้ตรวจประเมิน (auditors), วิทยากร (trainers), suppliers cannot be paid through the system.

#### P1-12. Withholding Tax 3% (WHT) — INTENTIONALLY DEFERRED — still deferred
- **Evidence**:
    - `invoice-issuers.js:181-198` explicitly states WHT is NOT implemented (owner directive verbatim: "ถ้าหัก 3% แล้วเสี่ยงผิดกฎหมาย หรือเราไม่ได้นำส่ง เอาออกก็ได้")
    - `audit-trail.js:448-455, 564, 615, 618` stamps `withholdingTaxApplicable: false` on every payment event (forward-compat — flag can flip without re-keying historical rows)
    - `Invoice` schema has NO `withholdingTax` field (confirmed in `billing.prisma:3-113`)
- **Status**: This is a documented deferred decision, not an oversight. Re-evaluate if/when corporate (JURISTIC) customer volume justifies the ภ.ง.ด.53 monthly pipeline + ทบ.50 ทวิ certificate handling.

#### P1-13. Input VAT tracking (ภาษีซื้อ) — KNOWN TODO
- **Evidence**: `vat-report-service.js:22-29` explicitly emits `inputVat: { tracked: false, todo: '...' }` on every monthly report. Reference: ป.รัษฎากร ม.82/3 — input-tax credit needs the original ใบกำกับภาษีซื้อ on file.
- **Impact**: ภ.พ.30 filing today understates the input-tax-credit side. Finance compiles input VAT manually. Acceptable when expenses are small; non-trivial as the platform scales OpEx.

#### P1-14. Bank statement import / auto-matching — MISSING
- **Evidence**: `Grep "bank.statement.import|MT940|csvImport"` → no matches.
- **Today only slip-flow ledger** (`bank-reconciliation-service.js` reads from `PaymentSlip` table, NOT from a bank statement file). The reconciliation report is comparing platform records to themselves; the actual bank statement diff is done manually by finance.

#### P1-15. WHT certificate (ทบ.50 ทวิ) — MISSING (paired with P1-12)
- **Evidence**: `Grep "ทบ.50|WHT certificate"` → no matches.
- Tied to P1-12; same deferred status.

### P2 — Nice to have

#### P2-16. Recurring billing / auto-renew subscription — MISSING
- **Evidence**: `Grep "autoRenew|subscription.renew|recurringBilling"` → no matches.
- **Today**: Subscription cron (`subscriptions` model `endDate` index, `billing.prisma:197`) probably flips ACTIVE → EXPIRED, but doesn't auto-mint a new invoice for the next cycle. `subscription-order-service.js:15-18` comment explicitly says "ACTIVE → endDate hit → EXPIRED (cron)". No re-billing path.

#### P2-17. Multi-currency — INTENTIONAL (THB only)
- **Evidence**: `Invoice.currency` not exposed; `PaymentTransaction.currency String @default("THB")` (`billing.prisma:276`). `JournalLine.metadata` has forward-compat slot for `currency, fxRate` (lines 506-509 schema comment) but no service writes to it.
- **Status**: Confirmed THB-only and acceptable today. Not a gap.

#### P2-18. Customer credit limit / Net terms — MISSING
- **Evidence**: `Grep "credit.limit|net30|netTerms"` → no matches.
- Tied to AR Aging (P0-4). Cash-basis only today.

#### P2-19. Inter-team approval workflow (e.g. ADMIN approves > 100k transactions) — MISSING
- **Evidence**: `Grep "approve.*100k|approvalThreshold"` → no matches.
- **Today** ACCOUNT_DTAM / ACCOUNT_PLATFORM approve any amount within their side. ADMIN can override with `[admin-override]` audit marker. No amount-based escalation.

#### P2-20. PDPA masking of applicant identifiers in finance reports — PARTIAL
- **Evidence**: `Grep "PDPA.*mask|maskedApplicant"` → no matches in finance routes.
- **vat-report-service.js `classifyBuyer`** (lines 175-219) already chooses dash (`'-'`) for INDIVIDUAL buyers per ม.86/4 RD e-Filing convention — that is incidental masking, not a PDPA-driven workflow. No documented reveal-on-need or staff-level scrubbing across the five finance reports.

---

## Section 3 — Cross-cutting risks

### R-1. Decimal type chaos — single biggest risk (also P0-3)
Already enumerated above. Money in the same row of the same invoice can be inferred from THREE different unit systems (Float baht in `Invoice`, Decimal baht in `Quotation`, Int satang in `PaymentSlip`). Every cross-table aggregate (revenue summary, reconciliation, journal sum vs invoice total) crosses these boundaries.

### R-2. Test coverage is GOOD on services, THIN on routes
- Unit tests exist for: `journal-entry-service.test.js`, `trial-balance-service.test.js`, `financial-statements-service.test.js`, `general-ledger-service.test.js`, `vat-report-service.test.js`, `bank-reconciliation-service.test.js`, `chart-of-accounts-service.test.js`, `receipt-numbering-service.test.js`, `receipt-auto-sign-service.test.js`, `quotation-service.test.js`, `payment-slip-service-role-filter.test.js`, `phase-invoice-vat-split.test.js`, `invoice-vat-audit-report.test.js`, `backfill-platform-invoice-vat.test.js`, `payment-service.test.js`
- **No integration tests** found for: full slip→approve→journal→signature happy path; cross-side approval denial; refund flow (because no flow); credit note (because no entity)
- Confirmed by `Glob apps/backend/__tests__/**/*credit-note*.test.js` → none

### R-3. Org-scoping IS enforced consistently in finance routes
`Grep "req.user.organizationId"` returns hits across the route files. Trial balance, P&L, BS, GL, VAT report, reconciliation all `requireOrganization`. No leak surfaces found in this audit.

### R-4. Audit logging IS consistent for finance routes
`logSlipEvent`, `logExport`, `auditLogger.log({ category: AuditCategory.PAYMENT, ... })` are wrapped around every state-changing action. Hash-chain integrity verified at read-time (`audit-trail.js:506-528`).

### R-5. API casing: mostly camelCase, no snake_case JSON found in finance routes
`Grep "snake_case"` in routes returns only analytics files. Finance JSON shapes use camelCase (`invoiceNumber`, `totalAmount`, `slipSide`).

### R-6. Thai date formatting consistent (BE year on DTAM, CE on PLATFORM)
- `receipt-numbering-service.js:138-171` (`toBuddhistYear`, `toChristianYear`, idempotent)
- `formatReceiptVariablesForIssuer` (lines 361-407) returns `'๑๖ พฤษภาคม พุทธศักราช ๒๕๖๙'` for DTAM, compact Thai BE for PLATFORM. Consistent.

### R-7. Satang vs baht — INCONSISTENT (R-1 + same)
Already covered. Schema comment (`billing.prisma:269-274`) is explicit: `PaymentTransaction.amount` in satang vs `Application.phase1Amount` / `phase2Amount` in baht. Bridging writers must `* 100` or `/ 100` — easy to miss.

### R-8. PLATFORM bank account still PENDING in config defaults
`invoice-issuers.js:403-404` `PLATFORM_BANK_ACCOUNT.bankName`, `accountNo` default to `PENDING_FINANCE_CONFIRMATION`. The validator (`listPendingIssuerFields`) and startup-warning surface this, but if env vars are missed in production the slip-upload UI will render the literal string `PENDING_FINANCE_CONFIRMATION`.

### R-9. Soft-delete on JournalEntry has a sharp edge
`JournalEntry.isDeleted` (`billing.prisma:527`) exists but TFRS for NPAEs forbids deletion. The header comment (`journal-entry-service.js:96-97`) says corrections must be reversing entries — and the trial-balance service correctly excludes `isDeleted: true` rows — but there is no service-level guard preventing a future developer from soft-deleting a JournalEntry to "fix" a mistake. Should be hard-removed or wrapped behind an admin-only route with audit.

### R-10. SLA-breach alerting is UI-only
`SLIP_SLA_HOURS = 24` (`accounting-service.js:41`) drives a visual badge but no cron/notification fires when slips age out. Finance must look at the queue. For an SLA you commit to, you need an active alarm.

---

## Section 4 — Recommended implementation order

**Next batch (B17 / B18 / B19 logical follow-on)** — sequenced for biggest legal exposure first.

### Batch N — Credit Note + Refund (P0-1 + P0-2)
1. Add `CreditNote` Prisma model (mirrors `Invoice` shape; `originalInvoiceId` FK; `Decimal(15,2)` from day one).
2. Add `receipt_sequences.documentType='CREDIT_NOTE'` bucket; numbering `CN-PRD-2026-000001` (PLATFORM only — DTAM state-fee refunds flow through กรมบัญชีกลาง's own system, NOT this codebase).
3. Add `services/credit-note-service.js` with `issueCreditNote(invoiceId, lines, reason, actor)`. Posts REVERSING `JournalEntry` (Dr Revenue / Cr Cash — refund or Dr Revenue / Cr AR — adjustment), atomically with the credit-note row.
4. Add `services/refund-service.js` covering: subscription cancel-with-refund, applicant withdrawal after payment, finance-initiated reversal. Splits into "money to return" vs "no money flow, only document".
5. Tests: every refund/credit-note path posts a balanced reversing entry; the original entry remains untouched (preserves audit trail).
6. PDF template + ม.86/10 fields (original invoice number, original tax invoice date, reduction reason).
7. UI: applicant sees credit note in their statement; finance has "issue credit note" button on paid invoices.

### Batch N+1 — Decimal type unification (P0-3, R-1, R-7)
1. Migration: `Invoice.subtotal/vat/totalAmount` Float → `Decimal(15,2)`. `Quote.*` same. `Subscription.priceTHB` same. `PaymentReconciliation.totalAmount` same.
2. **Pick one unit**: recommend baht with `Decimal(15,2)` everywhere; convert `PaymentSlip.amountClaimed/amountVerified` and `PaymentTransaction.amount` from Int satang to `Decimal(15,2)` baht.
3. Backfill script with parity checks (Float-to-Decimal must produce identical totals when re-summed; Int satang / 100 must produce identical baht).
4. Add invariant test: `Invoice.totalAmount === sum(JournalLine.debit where issuer=PLATFORM and accountCode startsWith '1110')` for every PLATFORM-side paid invoice.

### Batch N+2 — Manual Journal + Period Close + Reversing Entry (P1-8, P1-9, P1-10)
1. `services/manual-journal-service.js` — finance-only endpoint, requires balanced lines, posts via existing `persistEntry` infrastructure.
2. `PeriodClose` Prisma model + `services/period-close-service.js` — locks `JournalEntry.entryDate <= closedThrough`; rejects new entries; admin-only reopen with audit reason.
3. `recordReversingEntry(originalEntryId, reason, actor)` — flips Dr/Cr of every line of the original; references original entry; persists `metadata.reversalOf = originalEntryId`.
4. Wire to UI on the reports page (admin button to close month).

### Batch N+3 — Daily Cash, AR Aging, Customer Statement (P1-7, P0-4, P1-6)
1. `services/daily-cash-report-service.js` — by-issuer-side intraday summary; CSV export.
2. `services/ar-aging-service.js` — buckets, configurable; depends on AR account 1130 being used (today it's "future use"). May need accrual switch first.
3. `services/customer-statement-service.js` — applicant-facing consolidated view; PDF export per period.

### Batch N+4 — Vendor payments + petty cash (P1-11)
Lower urgency until vendor volume justifies it. Add `VendorInvoice` model, `vendor-payment-service.js`, AP queue.

### Optional / later
- Input VAT tracking (depends on vendor-payment module — Batch N+4)
- Bank statement import (depends on banking API access)
- Recurring billing auto-renew (depends on payment-method tokenization)
- Approval thresholds (P2-19) — small lift; can ride with manual-journal batch
- SLA-breach cron alerting (R-10) — small lift; can ride with notification module

---

## Section 5 — Verification commands

A future engineer can re-run these to verify every claim above. All paths are relative to repo root.

### Confirm missing entities
```bash
# Credit Note (expect: no matches)
Glob "**/credit-note*"
Grep -r "CREDIT_NOTE|ใบลดหนี้" .

# Debit Note (expect: no matches)
Glob "**/debit-note*"
Grep -r "DEBIT_NOTE|ใบเพิ่มหนี้" .

# Refund flow (expect: no service file)
Glob "**/refund-service*"
Grep -r "refund-service|RefundService" apps/backend/services

# WHT (expect: deferred per invoice-issuers.js header §"Withholding tax")
Grep "withholdingTax|WHT" apps/backend/services
# Should hit only audit-trail.js stamping `withholdingTaxApplicable: false`

# Customer Statement
Grep "customer.statement|customer-statement|สรุปยอดลูกค้า" apps/backend
# Expect: no matches

# AR Aging
Grep "ar.aging|aged.receivables|ลูกหนี้ค้างชำระ" apps/backend
# Expect: no matches

# Daily Cash Report
Grep "daily.cash|cash.report|รายงานเงินสดรับ" apps/backend
# Expect: no matches

# Manual journal
Grep "manual.journal|adjusting.entry" apps/backend
# Expect: no matches

# Period close
Grep "period.close|closeBooks|lock.period" apps/backend
# Expect: no matches except routes/api/finance/tax-reports.js#period-closable (READ only)

# Reversing entry
Grep "reversing.entry|reverseEntry|recordReversingEntry" apps/backend
# Expect: no matches

# Vendor payments / petty cash
Grep "petty.cash|vendor.payment|รายจ่าย" apps/backend/services
# Expect: no matches
```

### Confirm decimal inconsistency (P0-3 / R-1 / R-7)
```bash
Grep -n "Float|@db.Decimal|Int.*SATANG" apps/backend/prisma/schema/billing.prisma
# Expected hits: Invoice.subtotal/vat/totalAmount=Float (lines 40-42),
#                Quote.subtotal/vat/totalAmount=Float (lines 218-220),
#                Subscription.priceTHB=Float (line 175),
#                PaymentReconciliation.totalAmount=Float (line 360),
#                Quotation.subtotal/vat/totalAmount=Decimal(15,2) (lines 689-691),
#                JournalLine.debit/credit/taxableAmount=Decimal(15,2) (lines 544-552),
#                PaymentTransaction.amount=Int satang (line 275),
#                PaymentSlip.amountClaimed/amountVerified=Int satang (lines 450, 461)
```

### Confirm test coverage
```bash
Glob "apps/backend/__tests__/**/*journal*.test.js"
Glob "apps/backend/__tests__/**/*trial-balance*.test.js"
Glob "apps/backend/__tests__/**/*chart-of-accounts*.test.js"
Glob "apps/backend/__tests__/**/*receipt*.test.js"
Glob "apps/backend/__tests__/**/*vat*.test.js"
Glob "apps/backend/__tests__/**/*reconciliation*.test.js"
Glob "apps/backend/__tests__/**/*quotation*.test.js"
Glob "apps/backend/__tests__/**/*financial-statements*.test.js"
Glob "apps/backend/__tests__/**/*general-ledger*.test.js"
# Confirm none exist for credit-note / refund / manual-journal / period-close
Glob "apps/backend/__tests__/**/*credit-note*.test.js"
Glob "apps/backend/__tests__/**/*refund*.test.js"
Glob "apps/backend/__tests__/**/*manual-journal*.test.js"
```

### Confirm STATE-fee skip rule
```bash
Grep -n "STATE_FEE_NOT_IN_PLATFORM_BOOKS" apps/backend/services
# Expected: services/journal-entry-service.js line 526-527 (recordPaymentEntry short-circuit)
```

### Confirm two-money-flow PLATFORM bank account still PENDING
```bash
Grep -n "PENDING_FINANCE_CONFIRMATION" apps/backend/config/invoice-issuers.js
# Expected: line 247 (PENDING sentinel), lines 403-404 (PLATFORM_BANK_ACCOUNT defaults)
```

### Confirm Chart of Accounts is in-memory only
```bash
Grep "model Account " apps/backend/prisma/schema
# Expect: no matches (chart-of-accounts-service.js:41 confirms verified 2026-05-16)
```

### Confirm Auto-sign + signing key namespaces
```bash
Grep -n "rsa:dtam-receipt|rsa:platform-receipt" apps/backend/services/receipt-auto-sign-service.js
# Expected: lines 67-70 KEY_NAMESPACE
```

### Confirm SLA detection is UI-only
```bash
Grep -n "SLIP_SLA_HOURS" apps/backend
# Expected: only services/accounting-service.js:41 (constant) — no cron sender
Glob "apps/backend/services/**/*sla*"
# Expect: no SLA service files
```

### Confirm WHT note in invoice-issuers
```bash
Grep -n "WHT|withholding" apps/backend/config/invoice-issuers.js
# Expected: lines 181-198, header §"Withholding tax (WHT 3%) — NOT implemented"
```

---

## Appendix — TFRS for NPAEs + ป.รัษฎากร + ISO 27799 anchors used in this audit

- **TFRS for NPAEs ch.2** — chart of accounts; basic accounting framework
- **TFRS for NPAEs ch.5** — accounting cycle (trial balance → close); referenced in `trial-balance-service.js:11-21`
- **TFRS for NPAEs ch.6** — financial reporting framework
- **TFRS for NPAEs ch.18 (รายได้)** — revenue recognition; cash-basis basis cited in `journal-entry-service.js:62-64`, `vat-report-service.js:58`
- **TFRS for NPAEs ch.19 (ค่าใช้จ่าย)** — expense recognition
- **TFRS for NPAEs ch.21** — income tax (links to ภ.ง.ด.50)
- **TAS 1 (Presentation of Financial Statements) §54** — line ordering, natural-side display; referenced in `trial-balance-service.js:14-21`
- **ป.รัษฎากร ม.77/1 (10)** — state revenue VAT-exempt; cornerstone of two-money-flow
- **ป.รัษฎากร ม.79** — taxable amount definition; `JournalLine.taxableAmount` schema comment
- **ป.รัษฎากร ม.82/3** — input-tax credit requires original ใบกำกับภาษีซื้อ on file (P1-13)
- **ป.รัษฎากร ม.83/8** — monthly e-filing deadline (15th of next month); `vat-report-service.js:10-12`
- **ป.รัษฎากร ม.86/4** — full tax invoice field requirements; PLATFORM invoice basis
- **ป.รัษฎากร ม.86/9** — debit note (ใบเพิ่มหนี้); P1-5 gap
- **ป.รัษฎากร ม.86/10** — credit note (ใบลดหนี้); P0-1 gap
- **ป.รัษฎากร ม.87** — 7-year accounting-record retention; reflected in `Invoice.retainUntil` default `now() + '7 years'::interval`
- **ประกาศกรมสรรพากร ฉบับที่ 200/2562** — ภ.พ.30 e-Filing CSV column spec; `vat-report-service.js:57`
- **กฎกระทรวงการคลังเรื่องเงินรายได้แผ่นดิน** — Treasury cash flow rules; cornerstone of two-money-flow
- **พ.ร.บ.วินัยการเงินการคลังของรัฐ พ.ศ.2561 ม.34** — state revenue must enter Treasury directly, not through private agents
- **พ.ร.บ.การอำนวยความสะดวกในการพิจารณาอนุญาตของทางราชการ พ.ศ.2558** — private collection-agent legal basis
- **พ.ร.บ.ธุรกรรมทางอิเล็กทรอนิกส์ พ.ศ.2544 §12, §26, §31** — Thai e-Transactions Act; integrity + traceability of electronic evidence
- **ISO 27799:2016 §7.2.3** — cryptographic key separation per legal entity (DTAM vs PRD signing keys)
- **ISO 27799:2016 §7.10.2** — cryptographic integrity controls (slip SHA-256)
- **ISO 27799:2016 §7.10.4** — audit log integrity verification (hash-chain at read)

---

*End of audit. This document is the input to the next implementation batch. No source code was modified during this audit.*
