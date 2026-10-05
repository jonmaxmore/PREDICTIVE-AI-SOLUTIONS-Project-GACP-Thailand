# DTAM Finance Team Training — 2026-05-16

**Audience**: DTAM Finance staff (slip reviewers, accountants, controller)
**Prerequisites**: Active FINANCE role, Finance Console access, training environment account
**Estimated reading**: 60 minutes
**Hands-on lab**: 90 minutes

> This guide covers all daily, monthly, and period-close responsibilities for the Finance role in the GACP platform. Screenshots are referenced as `[FIG-NN]` and stored in the Confluence training space.

---

## 1. Chart of accounts overview

The platform operates on a dual-account ledger.

### 1.1 ACCOUNT_DTAM (กรมการแพทย์แผนไทยฯ)

- **Account number**: 123-4-56789-0 (Krungthai)
- **Purpose**: Collects ALL applicant payments (Phase-1 25,000 THB, Phase-2 5,000 THB, re-audit 5,000 THB)
- **Tax**: Government revenue, NOT VAT-registered (exempt under Section 8 of Revenue Code)
- **Bookkeeper**: Finance team via GACP Finance Console
- **Period close**: Monthly, on day 5 of next month

**Responsibilities**:
- Daily slip review (target SLA: 4 working hours)
- Reconcile bank deposit with platform ledger daily
- Issue payment receipts to applicants (auto-generated)
- Sign off on monthly cash report

### 1.2 ACCOUNT_PLATFORM (บริษัทผู้พัฒนา)

- **Account number**: 987-6-54321-0 (KBank)
- **Purpose**: Internal operating account for platform infrastructure, SaaS license, hosting
- **Tax**: VAT-registered (ทร. 0105560000000), files ภ.พ.30 monthly
- **Bookkeeper**: Platform finance (offline accounting system synced via export)

**Responsibilities**:
- Track infrastructure costs allocated to GACP
- Monthly export to accounting system (CSV from `/admin/finance/export-monthly`)
- ภ.พ.30 filing by day 15 of next month

---

## 2. Daily slip review workflow

[FIG-01: Finance Console > Pending Slips queue]

### 2.1 Accessing the queue

1. Login at https://gacp.dtam.go.th/finance
2. Navigate to "Pending Slips" (left sidebar)
3. Queue sorted by: oldest first, then amount descending
4. Apply filters: phase, date range, applicant name

### 2.2 Review actions

For each slip:

| Action | When to use | Resulting state |
|--------|-------------|-----------------|
| APPROVE | Slip valid, amount matches, ref number unique | Payment marked PAID, applicant notified |
| REJECT | Slip illegible, wrong amount, wrong account | Payment REJECTED, applicant must re-upload |
| FLAG | Suspicious (duplicate ref, edited image) | Held for supervisor review |
| REQUEST_INFO | Missing info but might be valid | Sent back to applicant for clarification |

[FIG-02: Slip review screen with action buttons]

### 2.3 Approval checklist (DO NOT skip)

Before clicking APPROVE:
- [ ] Bank name visible and matches DTAM bank
- [ ] Account number matches (last 4 digits)
- [ ] Transfer date within last 7 days
- [ ] Amount matches expected fee (25,000 / 5,000 THB)
- [ ] Transaction reference number readable
- [ ] No signs of image tampering
- [ ] Reference number not used in any other approved payment (system auto-checks)

### 2.4 Rejection guidelines

Reject with clear reason. Common reasons:
- "Slip image blurry, please re-upload"
- "Amount mismatch: expected 25,000 THB, received 5,000 THB"
- "Transfer to wrong account (please use 123-4-56789-0)"
- "Date older than 7 days, please make new transfer"

---

## 3. Daily cash report

[FIG-03: Daily Cash Report dashboard]

Generated automatically at 17:00 ICT. Review by 18:00.

**Fields**:
- Total deposits (count and THB)
- Approved slips today
- Rejected slips today
- Flagged slips pending supervisor
- Reconciliation status (matched/mismatched)

**Action if mismatch**:
1. Compare with bank statement (Krungthai eStatement)
2. Identify orphan deposits (in bank, not in platform)
3. Identify orphan payments (in platform, not in bank)
4. Create manual journal entry if reconciliation needed
5. Escalate to controller if mismatch > 1,000 THB

---

## 4. Monthly ภ.พ.30 filing (PLATFORM only)

> NOTE: ACCOUNT_DTAM is exempt. This applies only to ACCOUNT_PLATFORM.

### 4.1 Process (day 1–15 of next month)

1. Export VAT summary from Finance Console > Tax > VAT Summary
2. Match with KBank statement
3. Reconcile sales VAT and purchase VAT
4. Login to RD e-Filing (https://efiling.rd.go.th)
5. Complete ภ.พ.30 form
6. Submit + pay any VAT due by day 15
7. Upload acknowledgment PDF to platform: Finance > Tax > Filings > Upload

### 4.2 Common issues

- **Missed input VAT**: Re-check purchase invoices, file ภ.พ.30.1 next month
- **Wrong RD code**: Use 41 (services) for SaaS revenue
- **Penalty**: 2% per month if late — escalate immediately to Controller

---

## 5. Period close procedure (monthly)

[FIG-04: Period Close wizard]

Period close runs on day 5 of next month, after all slips reviewed.

### 5.1 Steps

1. Navigate: Finance > Period Close > New Period
2. Select month
3. System pre-flight checks:
   - All slips reviewed (no pending) ✓
   - Bank reconciliation complete ✓
   - No suspended journal entries ✓
4. Click "Run Pre-Close Audit"
5. Review variance report
6. Submit to Admin for approval (Admin role required to finalize)
7. After Admin approves: period LOCKED, no edits allowed

### 5.2 What gets locked

- All payments in that period
- All journal entries
- All certificate issuance records linked to payments

---

## 6. Manual journal entry

Use only for reconciliation, refunds, or corrections.

[FIG-05: New Journal Entry form]

### 6.1 Allowed scenarios

- Bank fee adjustment
- Refund to applicant (rare, requires controller approval)
- Reclassification between sub-accounts
- Year-end accrual

### 6.2 Process

1. Finance > Journal Entries > New
2. Select transaction date (must be in open period)
3. Add debit and credit lines (must balance)
4. Attach supporting document (slip, refund form, memo)
5. Submit for review (2-eye principle: another Finance staff approves)

---

## 7. Common scenarios

### 7.1 Applicant uploaded wrong slip
- REJECT with reason
- Applicant gets notification (in-app + email)
- Applicant re-uploads correct slip

### 7.2 Duplicate transfer reference
- System auto-FLAGs
- Investigate: was it accidental double-payment?
- If yes: approve original, mark second as DUPLICATE, initiate refund
- If no: contact applicant to clarify

### 7.3 Partial payment
- DO NOT approve partial
- REJECT with reason "amount mismatch"
- Applicant must re-transfer full amount

### 7.4 Slip for previous period after close
- DO NOT post to closed period
- Create journal entry in current period with note "late slip for [period]"
- Notify controller

---

## 8. Quick reference

- Slip SLA: 4 working hours
- Daily report review: 18:00 ICT
- Period close cutoff: day 5 of next month
- ภ.พ.30 deadline: day 15 of next month
- Escalation channel: `#finance-escalation` Slack, or call Controller (ext. 4001)
