/**
 * Journal Entry Service — double-entry bookkeeping for paid invoices.
 *
 * System deep-dive Tier 14 — Backend + Compliance + Accounting.
 * Revised 2026-05-16 (B16-B owner correction) to reflect the TWO-CHANNEL
 * money-flow model below. Further reinforced 2026-05-16 (B16-C):
 * recordPaymentEntry now short-circuits with `{ skipped: true }` for
 * STATE invoices so the no-platform-side-cash invariant is enforced at
 * the service-call boundary (not only inside `buildPaymentEntryLines`).
 *
 * Two-channel money flow (correct business reality — owner-confirmed 2026-05-16)
 * ─────────────────────────────────────────────────────────────────────────────
 * Owner clarification (Thai, verbatim):
 *   - "DTAM ในฐานะหน่วยงาน — ไม่ใช่ผู้รับเงินจริง แต่เป็นกรมบัญชีกลาง"
 *     → DTAM the department is NOT the actual money receiver;
 *       กรมบัญชีกลาง (Comptroller General's Department / Treasury) is.
 *   - "ส่วนบริษัท platform ก็เก็บแค่ค่า fee platform เท่านั้น"
 *     → The platform company collects ONLY the platform fee. The state
 *       fee (5,000 / 25,000 THB) is paid by the applicant DIRECTLY to
 *       กรมบัญชีกลาง and NEVER touches the platform's bank account.
 *
 * Implication for the platform's books:
 *   - STATE invoices document the state-fee transaction so the applicant
 *     has a Government Revenue Receipt (ใบเสร็จเงินรายได้แผ่นดิน) in
 *     DTAM's name — but the cash itself flows applicant → Treasury via a
 *     separate banking channel. The platform NEVER receives this cash,
 *     so it MUST NOT record a journal entry for STATE invoices in its
 *     own books. Doing so would (a) fabricate a Dr Cash entry against
 *     money the platform doesn't hold, and (b) create a phantom Payable
 *     liability against a debt the platform never owed (Treasury is the
 *     collecting authority, not a creditor of the platform).
 *   - PLATFORM invoices document the platform-fee transaction (500 /
 *     2,500 THB + VAT 7%). This cash DOES land in the platform's bank
 *     account and IS recognised as revenue per TFRS for NPAEs ch. 18.
 *
 *   STATE invoice — RETIRED (2026-09-05). Split STATE/PLATFORM invoicing is
 *     gone: the company sells ONE service and books the whole ค่าบริการ as revenue.
 *     What the company pays DTAM is settled OFFLINE and booked in the company's
 *     own accounts (operator 2026-09-29) — this ledger holds no DTAM payable, no
 *     DTAM cost and no remittance entry. A STATE invoice reaching this layer is
 *     a defect and raises RETIRED_STATE_INVOICE. It used to return
 *     { skipped: true }, which under the live model means cash arrived and no
 *     entry was written, reported to the caller as success.
 *
 *   PLATFORM invoice (own revenue, VAT 7% — unchanged)
 *     Dr. Cash                                535.00
 *       Cr. Revenue — Platform Fee                  500.00
 *       Cr. Output VAT 7%                            35.00
 *
 * Why this is NOT collection-agent accounting: under the collection-agent
 * model the platform would receive the cash and book a Payable. But the
 * platform's bank account never sees the state fee — Treasury collects
 * directly through its own channel (per กฎกระทรวงการคลังเรื่องเงินรายได้
 * แผ่นดิน and พ.ร.บ.วิธีการงบประมาณ). Therefore the correct accounting
 * treatment is "not on the platform's books at all" — the state fee
 * belongs in DTAM's books (revenue) and Treasury's books (cash), not
 * ours. Legal references:
 *   - ป.รัษฎากร ม.77/1 (10) — state revenue VAT-exempt
 *   - กฎกระทรวงการคลังเรื่องเงินรายได้แผ่นดิน — Treasury cash flow
 *   - พ.ร.บ.วินัยการเงินการคลังของรัฐ พ.ศ.2561 ม.34 — state revenue
 *     deposited with Treasury, not via private agents
 *   - TFRS for NPAEs ch. 18 (รายได้) — recognise only revenue actually
 *     received or receivable by the entity
 *
 * Schema (committed in batches 16 + 16-A — see apps/backend/prisma/schema/billing.prisma)
 * ──────────────────────────────────────────────────────────────────────────
 *
 * Migrations:
 *   - prisma/migrations/20260516000000_add_journal_entries_receipt_sequence/
 *     (B16-original: journal_entries / journal_lines / receipt_sequences
 *     with legacy (prefix, year, counter) shape)
 *   - prisma/migrations/20260516010000_add_journal_quotation_receipt_seq_bank_accounts/
 *     (B16-A: adds taxableAmount on journal_lines, extends receipt_sequences
 *     with (issuerType, documentType, yearBE, yearAD, nextNumber), adds
 *     quotations + issuer_bank_accounts. Added in migration
 *     `add_journal_quotation_receipt_seq_bank_accounts` (2026-05-16) —
 *     formerly tagged "NOT yet in prisma/schema".)
 *
 * Five tables back this service / its sibling allocators:
 *   - journal_entries        — aggregate root (one row per posted entry)
 *   - journal_lines          — balanced debit/credit lines (CASCADE on entry)
 *   - receipt_sequences      — per-(issuer, document, year) monotonic counter
 *   - quotations             — DTAM-side / PLATFORM-side quote stream
 *   - issuer_bank_accounts   — canonical destination per issuer
 *
 * Schema notes:
 *   - totalDebit / totalCredit / debit / credit / taxableAmount use
 *     Decimal(15,2) — NOT Float — because TFRS for NPAEs requires exact
 *     decimal math. Round at the application boundary (round2 helper)
 *     before persistence.
 *   - JournalLine.taxableAmount holds the per-line VAT base (Revenue
 *     Code §79) for ภ.พ.30 monthly remittance.
 *   - JournalLine.metadata Json? is forward-compat for withholding tax,
 *     foreign-currency amounts, multi-entity splits, and reversal markers.
 *   - JournalEntry.isDeleted is soft-delete only; corrections must be
 *     posted as a REVERSING entry (preserves audit trail).
 *
 * @module services/journal-entry-service
 */

'use strict';

const logger = require('../shared/logger');
const { PAYMENT_FEES } = require('../config/payment-fees');
const { getInvoiceIssuer } = require('../config/invoice-issuers');

// Lazy-require the Prisma helper so the service stays loadable in
// environments where @prisma/client hasn't been generated (CI bootstrap,
// some Jest runs). `prisma-database` itself returns a Proxy stub when
// NODE_ENV=test and the client is missing — `resolvePrisma` below treats
// both cases as "no DB available" and the service falls back to log-only.
let prismaModule;
try {
    prismaModule = require('./prisma-database');
} catch (_e) {
    prismaModule = { prisma: null };
}

// Iter 24 — Period-close guard (inversion-of-dependency interceptor).
// Called from every entry writer below before any DB write — blocks posts into
// a CLOSED period unless `meta.allowClosedPeriod === true` (ADMIN recovery).
// Loaded at CALL time and FAILS CLOSED (controller ruling 2026-09-26): a guard
// that cannot load refuses the post with PERIOD_CHECK_UNAVAILABLE instead of
// being skipped (services/period-guard-loader.js).
const { loadPeriodGuardOrRefuse } = require('./period-guard-loader');

// ──────────────────────────────────────────────────────────────────────────
// Chart of accounts — declared in the leaf module services/journal-accounts.js
// (no requires) so vat-report-service can read it without loading this file;
// see that file for the require cycle it breaks. Re-exported below unchanged.
// ──────────────────────────────────────────────────────────────────────────

const { ACCOUNTS } = require('./journal-accounts');

const ISSUER = Object.freeze({
    DTAM: 'DTAM',
    PLATFORM: 'PLATFORM',
});

// ──────────────────────────────────────────────────────────────────────────
// Pure helpers (no I/O — easy to unit-test)
// ──────────────────────────────────────────────────────────────────────────

/**
 * Round to 2 decimal places (THB satang) using banker-safe rounding.
 * Currency math in JS must always round at the boundary — never compare
 * floats directly.
 */
function round2(n) {
    return Math.round((Number(n) || 0) * 100) / 100;
}

/**
 * Determine the issuer (DTAM vs PLATFORM) from a service type string.
 * Lazy normalisation so callers can pass either canonical or legacy types.
 */
function resolveIssuerType(serviceType) {
    const normalized = String(serviceType || '').toUpperCase();
    if (normalized.includes('STATE_FEE')) {
        return ISSUER.DTAM;
    }
    if (normalized.includes('PLATFORM_FEE')) {
        return ISSUER.PLATFORM;
    }
    // Application fee + Audit fee are legacy single-line invoices that
    // historically aggregated state + platform; treat as PLATFORM-issued
    // so VAT is recorded. There is no state portion to book any more — the
    // platform keeps no DTAM payable (operator 2026-09-29).
    if (normalized.includes('APPLICATION') || normalized.includes('AUDIT')) {
        return ISSUER.PLATFORM;
    }
    // Subscription orders are pure platform revenue with VAT.
    if (normalized.startsWith('SUBSCRIPTION_')) {
        return ISSUER.PLATFORM;
    }
    return ISSUER.PLATFORM;
}

/**
 * Build the balanced journal-entry lines for a paid invoice.
 *
 * `components` lets the caller pass the explicit breakdown the checkout order
 * froze (the service fee + its VAT). If omitted, we infer from the service
 * type and totalAmount (VAT back-out).
 *
 * One fee, one company (operator 2026-09-29): the entry is
 *     Dr Cash / Cr Revenue (ค่าบริการ) / Cr Output VAT
 * and nothing else. The company settles with DTAM offline and books that in
 * its own accounts, so no line here names DTAM — no payable, no cost. A
 * caller that still passes a `stateFee` gets no line for it: the cash then
 * exceeds revenue + VAT, the entry is unbalanced, and every recorder refuses
 * it (UNBALANCED_ENTRY) instead of booking a DTAM portion.
 *
 * @param {object} args
 * @param {string} args.invoiceId
 * @param {string} args.invoiceNumber
 * @param {string} args.serviceType
 * @param {number} args.totalAmount       full cash captured
 * @param {Date}   [args.paidAt=new Date()]
 * @param {object} [args.components]
 * @param {number} [args.components.platformFee] the service fee (excl. VAT) — the
 *                                               checkout_orders.platform_fee_net column
 * @param {number} [args.components.vat]         VAT portion (7% of platformFee)
 * @returns {{ totalDebit:number, totalCredit:number, balanced:boolean, lines:object[] }}
 */
function buildPaymentEntryLines({
    invoiceId,
    invoiceNumber,
    serviceType,
    totalAmount,
    paidAt = new Date(),
    components,
}) {
    const issuerType = resolveIssuerType(serviceType);
    const cashAmount = round2(totalAmount);

    // A STATE invoice has nowhere to go: the account it used to credit (the
    // DTAM payable, 2151-001) is gone from this ledger (operator 2026-09-29).
    // recordPaymentEntry refuses these before building; this keeps the pure
    // builder from returning a half-entry with a cash line and no credit.
    if (!components && issuerType === ISSUER.DTAM) {
        throw Object.assign(
            new Error(
                `STATE invoice ${invoiceNumber || invoiceId} has no journal shape — the platform `
                + 'keeps no DTAM payable; DTAM is settled offline in the company\'s own accounts.',
            ),
            { code: 'RETIRED_STATE_INVOICE', invoiceId, serviceType: serviceType || null, amount: cashAmount },
        );
    }

    let platformFee = round2(components?.platformFee || 0);
    let vat = round2(components?.vat || 0);

    // Infer from the total when components are omitted (VAT inclusive).
    if (!components) {
        const rate = PAYMENT_FEES.VAT_RATE; // 0.07
        vat = round2(cashAmount * (rate / (1 + rate)));
        platformFee = round2(cashAmount - vat);
    }

    const lines = [];
    let lineNumber = 1;

    // 1) Debit Cash — the platform's bank account received the transfer.
    //    The issuer tag stays on the cash line so the journal browser can
    //    filter by issuer; it does not imply DTAM owns the cash.
    lines.push({
        lineNumber: lineNumber++,
        accountCode: ACCOUNTS.CASH_BANK.code,
        accountName: ACCOUNTS.CASH_BANK.name,
        debit: cashAmount,
        credit: 0,
        issuer: issuerType,
        memo: `Cash received — invoice ${invoiceNumber}`,
    });

    // 2) Revenue — the whole ค่าบริการ (excl. VAT). Operator 2026-09-05: the
    //    company is the PRINCIPAL and sells one service; 2026-09-11: there is
    //    one fee and no state portion; 2026-09-29: what the company pays DTAM
    //    is settled offline, in its own accounts — not on this ledger.
    if (platformFee > 0) {
        lines.push({
            lineNumber: lineNumber++,
            accountCode: ACCOUNTS.REVENUE_PLATFORM_FEE.code,
            accountName: ACCOUNTS.REVENUE_PLATFORM_FEE.name,
            debit: 0,
            credit: platformFee,
            issuer: ISSUER.PLATFORM,
            memo: `Service fee — ${serviceType}`,
        });
    }

    // 3) Output VAT (own liability to Revenue Department, ภ.พ.30 monthly)
    if (vat > 0) {
        lines.push({
            lineNumber: lineNumber++,
            accountCode: ACCOUNTS.VAT_PAYABLE_OUTPUT.code,
            accountName: ACCOUNTS.VAT_PAYABLE_OUTPUT.name,
            debit: 0,
            credit: vat,
            issuer: ISSUER.PLATFORM,
            memo: `Output VAT 7% — ${invoiceNumber}`,
        });
    }

    const totalDebit = round2(lines.reduce((s, l) => s + l.debit, 0));
    const totalCredit = round2(lines.reduce((s, l) => s + l.credit, 0));
    // Floats may differ by sub-satang — accept anything within 0.005 THB.
    const balanced = Math.abs(totalDebit - totalCredit) < 0.005;

    return {
        invoiceId,
        invoiceNumber,
        entryDate: paidAt,
        reference: invoiceNumber,
        description: `Payment received for invoice ${invoiceNumber}`,
        totalDebit,
        totalCredit,
        balanced,
        lines,
    };
}

/**
 * Resolve the current Prisma client (or null if the client is stubbed in
 * tests / not generated yet). Keeps the recorders resilient to
 * environments without DB access — they fall back to log-only behaviour.
 *
 * When a transaction client `tx` is supplied the caller is operating
 * inside a `prisma.$transaction(async (tx) => …)` block (see
 * `payment-slip-service.approveSlip`). In that case we route the write
 * through `tx` so the JournalEntry insert is atomic with the
 * paid-invoice update — no committed paid invoice can exist without its
 * balanced journal entry, and vice versa. TFRS for NPAEs ch.2 requires
 * the chronological record to be created within the same accounting
 * event as the underlying transaction.
 */
function resolvePrisma(tx) {
    // Prefer the caller-supplied transaction handle. The Prisma
    // transactional client exposes the same delegate surface as the
    // top-level client, so the duck-type below works identically for
    // both. Tests can also pass a mock object here.
    const candidate = tx || (prismaModule && prismaModule.prisma);
    if (!candidate) {
        return null;
    }
    const journal = candidate.journalEntry;
    // The Proxy stub in prisma-database returns "anything" for missing
    // models — typeof a Proxy-wrapped function is 'function', and calling
    // it returns Promise<null>. We detect a real client by the presence
    // of `create` AS A FUNCTION on the real journalEntry delegate.
    if (!journal || typeof journal !== 'object' || typeof journal.create !== 'function') {
        return null;
    }
    return candidate;
}

/**
 * Persist an in-memory journal entry to the JournalEntry / JournalLine
 * tables. Returns the persisted entry (with DB-generated id) or null when
 * the Prisma client is unavailable / stubbed.
 *
 * Throws on real DB errors so the caller can decide whether to fall back
 * to log-only behaviour with a [journal-fallback] marker.
 *
 * @param {object} args
 * @param {object} args.entry            balanced entry from buildPaymentEntryLines / buildAdjustmentEntryLines
 * @param {string} args.kind             entry class (e.g. 'PAYMENT') — stamped on each line's metadata
 * @param {string} [args.invoiceId]      FK back to invoices.id
 * @param {string} [args.organizationId] tenant scope (ADR-014)
 * @param {string} [args.createdBy]      canonical user id of the actor
 * @param {object} [args.tx]             optional Prisma transaction handle. When supplied the
 *                                       create runs through `tx.journalEntry.create`, making the
 *                                       insert atomic with the caller's $transaction (B19-A wire-in).
 */
async function persistEntry({ entry, kind, invoiceId, organizationId, createdBy, tx, sourceType, sourceId }) {
    const prisma = resolvePrisma(tx);
    if (!prisma) {
        return null;
    }
    // Per-line metadata: memo (free-form), kind (PAYMENT, …), and
    // an issuer marker that the trial-balance + VAT report services
    // (B19-B / B19-C) can filter on without re-parsing accountCode.
    const created = await prisma.journalEntry.create({
        data: {
            entryDate: entry.entryDate,
            reference: entry.reference,
            invoiceId: invoiceId || null,
            description: entry.description,
            totalDebit: entry.totalDebit,
            totalCredit: entry.totalCredit,
            organizationId: organizationId || null,
            createdBy: createdBy || null,
            // Settlement provenance (Task 3, settlement-resilience): the
            // idempotency class + business key for this entry. Only
            // CHECKOUT_SETTLEMENT callers populate these today; the
            // partial unique index journal_entries_settlement_once
            // requires sourceId non-null to actually guard concurrent
            // settles (Postgres unique indexes treat NULL as distinct).
            sourceType: sourceType || null,
            sourceId: sourceId || null,
            lines: {
                create: entry.lines.map((line) => ({
                    lineNumber: line.lineNumber,
                    accountCode: line.accountCode,
                    accountName: line.accountName,
                    debit: line.debit,
                    credit: line.credit,
                    issuer: line.issuer || null,
                    // VAT base for ภ.พ.30 monthly remittance — only the
                    // VAT-bearing platform-fee line carries it. Non-VAT
                    // lines leave it null (per Revenue Code ม.79).
                    taxableAmount: line.taxableAmount != null ? line.taxableAmount : null,
                    metadata: { memo: line.memo || null, kind },
                })),
            },
        },
        include: { lines: true },
    });
    return created;
}

/**
 * Record a payment journal entry.
 *
 * Persists via Prisma when the JournalEntry / JournalLine tables exist
 * (B16-A schema). The structured log line is kept as a BACKUP — the
 * accounting log-shipping pipeline also reads the log stream, and on DB
 * failure the log carries a `[journal-fallback]` marker so finance can
 * reconcile manually.
 *
 * The B16-C two-money-flow short-circuit is REMOVED (operator 2026-09-05).
 *
 *   It skipped the journal layer for any invoice whose serviceType resolved to
 *   the DTAM issuer, on the 2026-05-16 premise that the applicant wired the
 *   state fee straight to กรมบัญชีกลาง and the company never held it. W14 ended
 *   that premise: the farmer buys one service from the company, the company
 *   charges VAT on all of it, and pays DTAM afterwards. Skipping now means cash
 *   in the bank with nothing on the books — and the skip returned as a success
 *   value, so no caller could tell.
 *
 *   A STATE invoice raises RETIRED_STATE_INVOICE instead. It should be
 *   unreachable — the minting path is retired in phase-billing-service — but
 *   "unreachable" describes today's callers, and money deserves a backstop.
 *
 *   Every settlement now takes the balanced path:
 *     Dr Cash / Cr Revenue (whole ค่าบริการ) / Cr Output VAT
 *   and nothing on DTAM's side — settled offline in the company's own
 *   accounts (operator 2026-09-29).
 *
 * @param {string} invoiceId
 * @param {number} amount        full cash received (must equal invoice.totalAmount)
 * @param {object} [components]  see `buildPaymentEntryLines`
 * @param {object} [meta]        invoiceNumber, serviceType, paidAt, organizationId, createdBy,
 *                               sourceType, sourceId
 * @param {string} [meta.sourceType] idempotency class (e.g. 'CHECKOUT_SETTLEMENT'), forwarded
 *                               onto JournalEntry.sourceType
 * @param {string} [meta.sourceId]   business key (e.g. order.id); MUST be non-null whenever
 *                               sourceType is set — the settlement-once partial unique index
 *                               keys off (sourceId) and Postgres treats NULL as distinct
 * @param {object} [meta.tx]     Prisma transaction handle. When the caller is already
 *                               inside a `prisma.$transaction(async (tx) => …)` block
 *                               (e.g., payment-slip-service.approveSlip's inline
 *                               wire-in from batch B15), passing `tx` makes the
 *                               journal entry persist atomically with the rest of
 *                               the transaction — no committed paid invoice can
 *                               ever exist without its balanced journal entry,
 *                               and vice versa. Matches TFRS for NPAEs ch.2:
 *                               the chronological record must be created within
 *                               the same accounting event as the source
 *                               transaction.
 * @returns {Promise<object>}   the persisted entry, in-memory entry when DB
 *                              unavailable, OR { skipped: true, reason, ... }
 *                              for STATE invoices. Persisted shape carries
 *                              `persisted: true, journalEntryId, lines, totalDebit, totalCredit`.
 */
async function recordPaymentEntry(invoiceId, amount, components, meta = {}) {
    if (!invoiceId) {
        throw Object.assign(new Error('invoiceId is required'), { code: 'VALIDATION_ERROR' });
    }
    if (!Number.isFinite(amount) || amount <= 0) {
        throw Object.assign(new Error('amount must be a positive number'), { code: 'VALIDATION_ERROR' });
    }

    // B16-C — STATE-fee short-circuit. Owner-confirmed: the platform never
    // receives the state fee, so it MUST NOT book a journal entry for it.
    // ป.รัษฎากร ม.77/1 (10) + กฎกระทรวงการคลังเรื่องเงินรายได้แผ่นดิน +
    // พ.ร.บ.วินัยการเงินการคลังของรัฐ ม.34 are the legal anchors; TFRS
    // for NPAEs ch.18 is the accounting anchor.
    const issuerType = resolveIssuerType(meta.serviceType || 'PHASE_1_PLATFORM_FEE');
    if (issuerType === ISSUER.DTAM) {
        // A STATE invoice must not exist any more, and if one appears it is a
        // defect — so this is loud, not silent.
        //
        // Until 2026-09-05 this branch returned `{ skipped: true, reason:
        // 'STATE_FEE_NOT_IN_PLATFORM_BOOKS' }` on the 2026-05-16 reasoning that
        // the applicant wired the state fee straight to กรมบัญชีกลาง and the
        // company never touched it. W14 ended that: the farmer buys one service
        // from the company and the company pays DTAM afterwards. Under the model
        // that is actually live, a skip here means cash arrived in the bank and
        // no journal entry was written — and a `skipped` return reads as success
        // to every caller, so nothing surfaces it.
        //
        // The path that minted these invoices is retired too
        // (phase-billing-service.isPhaseSplitInvoicingRetired), so this should be
        // unreachable. It refuses rather than being deleted because "unreachable"
        // is a claim about today's callers, and money deserves a backstop.
        throw Object.assign(
            new Error(
                `STATE invoice ${meta.invoiceNumber || invoiceId} reached the journal layer. `
                + 'Split STATE/PLATFORM invoicing is retired — the company sells one service '
                + 'and books the whole ค่าบริการ as revenue. Nothing may be settled against a '
                + 'STATE invoice.',
            ),
            {
                code: 'RETIRED_STATE_INVOICE',
                invoiceId,
                serviceType: meta.serviceType || null,
                amount: round2(amount),
            },
        );
    }

    const entry = buildPaymentEntryLines({
        invoiceId,
        invoiceNumber: meta.invoiceNumber || invoiceId,
        serviceType: meta.serviceType || 'PHASE_1_PLATFORM_FEE',
        totalAmount: amount,
        paidAt: meta.paidAt || new Date(),
        components,
    });

    // Iter 24 — Period-close guard. Reject entries whose entryDate lands
    // inside a CLOSED PeriodClose row unless the caller supplies
    // meta.allowClosedPeriod = true (ADMIN recovery path, audit-logged).
    // Throws Error{code: 'PERIOD_CLOSED', year, month, organizationId} so
    // the caller can surface 409 to the API consumer. Fails CLOSED when the
    // guard cannot load (PERIOD_CHECK_UNAVAILABLE, 503).
    await loadPeriodGuardOrRefuse().checkPeriodOpen({
        entryDate: entry.entryDate,
        organizationId: meta.organizationId || null,
        allowClosedPeriod: meta.allowClosedPeriod === true,
    });

    if (!entry.balanced) {
        // Defensive — should never happen with correct inputs. Surface
        // loudly so accounting catches it during UAT.
        logger.error(
            `[journal-entry] UNBALANCED entry for invoice ${invoiceId}: `
            + `debit=${entry.totalDebit} credit=${entry.totalCredit}`,
        );
        throw Object.assign(
            new Error(`Unbalanced journal entry: Dr ${entry.totalDebit} != Cr ${entry.totalCredit}`),
            { code: 'UNBALANCED_ENTRY' },
        );
    }

    // Try DB persistence — fall back to log-only on failure so accounting
    // never loses the trail. The log line below always runs.
    //
    // B19-A: when `meta.tx` is supplied we MUST NOT swallow the error.
    // Inside a $transaction the caller expects an atomic
    // invoice-paid ↔ journal-entry write; if the journal insert blows up
    // the caller needs the throw to roll back the invoice update. The
    // outer try/catch in payment-slip-service is the legacy safety net
    // for callers that DON'T pass `tx` (no transaction = the legacy
    // log-only behaviour is preferred over crashing the slip-approval
    // path).
    let persisted = null;
    let fallbackReason = null;
    try {
        persisted = await persistEntry({
            entry,
            kind: 'PAYMENT',
            invoiceId,
            organizationId: meta.organizationId,
            createdBy: meta.createdBy,
            tx: meta.tx,
            sourceType: meta.sourceType,
            sourceId: meta.sourceId,
        });
    } catch (err) {
        fallbackReason = err && err.message ? err.message : String(err);
        logger.error(
            `[journal-entry][journal-fallback] DB write failed for invoice ${invoiceId} — ${fallbackReason}. `
            + 'Entry is preserved in the log stream below for manual reconciliation.',
            { invoiceId, invoiceNumber: entry.invoiceNumber },
        );
        // Re-throw inside a transaction so the surrounding $transaction
        // rolls back — invoice paid status + journal entry must commit
        // together or not at all (TFRS for NPAEs ch.2 atomicity).
        if (meta.tx) {
            throw err;
        }
    }

    // Backup log — runs even after a successful DB write so the log-
    // shipping export captures the same row. Marker differs by outcome.
    const marker = persisted ? '[journal-entry]' : '[journal-entry][journal-fallback]';
    logger.info(
        `${marker} balanced entry for invoice ${entry.invoiceNumber} `
        + `Dr=${entry.totalDebit} Cr=${entry.totalCredit} lines=${entry.lines.length}`,
        {
            invoiceId,
            invoiceNumber: entry.invoiceNumber,
            entryId: persisted ? persisted.id : null,
            entry,
            fallbackReason,
        },
    );

    // B19-A: on the persisted path return the canonical shape the
    // caller can use to populate audit logs:
    //   { persisted, journalEntryId, lines, totalDebit, totalCredit, ... }
    // On the fallback path return the in-memory entry shape verbatim so
    // existing call sites that read `.balanced`, `.lines`, `.totalDebit`
    // (slip-service log line, reconciliation jobs) keep working.
    if (persisted) {
        return {
            ...entry,
            persisted: true,
            journalEntryId: persisted.id,
            id: persisted.id,
            lines: persisted.lines || entry.lines,
            totalDebit: entry.totalDebit,
            totalCredit: entry.totalCredit,
        };
    }
    return {
        ...entry,
        persisted: false,
        fallback: true,
        fallbackReason: fallbackReason || null,
    };
}

/**
 * Build balanced lines for a credit-/debit-note adjustment against a PLATFORM
 * invoice. Pure helper (no I/O) — mirrors `buildPaymentEntryLines`.
 *
 *   CREDIT_NOTE (reverses the original sale):
 *     Dr. Revenue — Platform Fee (4110-001)  <subtotal>
 *     Dr. Output VAT 7%          (2131-001)  <vat>
 *       Cr. Cash / Bank          (1110-001)        <total>
 *
 *   DEBIT_NOTE (additional charge — same direction as the sale):
 *     Dr. Cash / Bank            (1110-001)  <total>
 *       Cr. Revenue — Platform Fee (4110-001)      <subtotal>
 *       Cr. Output VAT 7%          (2131-001)      <vat>
 *
 * @param {'CREDIT_NOTE'|'DEBIT_NOTE'} kind
 */
function buildAdjustmentEntryLines({ kind, invoiceId, invoiceNumber, _serviceType, subtotal, vat, total, entryDate = new Date() }) {
    const isCredit = kind === 'CREDIT_NOTE';
    const sub = round2(subtotal || 0);
    const tax = round2(vat || 0);
    const cash = round2(total || 0);

    const lines = [];
    let lineNumber = 1;
    const noteWord = isCredit ? 'Credit note' : 'Debit note';

    if (isCredit) {
        // Reverse revenue + VAT, return cash.
        if (sub > 0) {
            lines.push({ lineNumber: lineNumber++, accountCode: ACCOUNTS.REVENUE_PLATFORM_FEE.code, accountName: ACCOUNTS.REVENUE_PLATFORM_FEE.name, debit: sub, credit: 0, issuer: ISSUER.PLATFORM, memo: `${noteWord} — reverse platform fee, invoice ${invoiceNumber}` });
        }
        if (tax > 0) {
            lines.push({ lineNumber: lineNumber++, accountCode: ACCOUNTS.VAT_PAYABLE_OUTPUT.code, accountName: ACCOUNTS.VAT_PAYABLE_OUTPUT.name, debit: tax, credit: 0, issuer: ISSUER.PLATFORM, memo: `${noteWord} — reverse Output VAT 7%, invoice ${invoiceNumber}` });
        }
        if (cash > 0) {
            lines.push({ lineNumber: lineNumber++, accountCode: ACCOUNTS.CASH_BANK.code, accountName: ACCOUNTS.CASH_BANK.name, debit: 0, credit: cash, issuer: ISSUER.PLATFORM, memo: `${noteWord} — refund/settle, invoice ${invoiceNumber}` });
        }
    } else {
        // Additional charge — same direction as the original sale.
        if (cash > 0) {
            lines.push({ lineNumber: lineNumber++, accountCode: ACCOUNTS.CASH_BANK.code, accountName: ACCOUNTS.CASH_BANK.name, debit: cash, credit: 0, issuer: ISSUER.PLATFORM, memo: `${noteWord} — additional charge, invoice ${invoiceNumber}` });
        }
        if (sub > 0) {
            lines.push({ lineNumber: lineNumber++, accountCode: ACCOUNTS.REVENUE_PLATFORM_FEE.code, accountName: ACCOUNTS.REVENUE_PLATFORM_FEE.name, debit: 0, credit: sub, issuer: ISSUER.PLATFORM, memo: `${noteWord} — additional platform fee, invoice ${invoiceNumber}` });
        }
        if (tax > 0) {
            lines.push({ lineNumber: lineNumber++, accountCode: ACCOUNTS.VAT_PAYABLE_OUTPUT.code, accountName: ACCOUNTS.VAT_PAYABLE_OUTPUT.name, debit: 0, credit: tax, issuer: ISSUER.PLATFORM, memo: `${noteWord} — additional Output VAT 7%, invoice ${invoiceNumber}` });
        }
    }

    const totalDebit = round2(lines.reduce((s, l) => s + l.debit, 0));
    const totalCredit = round2(lines.reduce((s, l) => s + l.credit, 0));
    const balanced = Math.abs(totalDebit - totalCredit) < 0.005;

    return {
        invoiceId,
        invoiceNumber,
        entryDate,
        reference: invoiceNumber,
        description: `${noteWord} adjustment for invoice ${invoiceNumber}`,
        totalDebit,
        totalCredit,
        balanced,
        lines,
    };
}

/**
 * Shared persistence flow for credit-/debit-note GL entries. Mirrors
 * `recordPaymentEntry` exactly (DTAM short-circuit, period-close guard,
 * balance assertion, persist-with-fallback, tx re-throw, backup log, canonical
 * return shape) so the adjustment entries behave identically to the payment
 * entries they offset.
 *
 * @param {'CREDIT_NOTE'|'DEBIT_NOTE'} kind
 * @param {string} invoiceId   the ORIGINAL invoice being adjusted
 * @param {number} total       cash amount of the adjustment (positive)
 * @param {{subtotal:number, vat:number}} components
 * @param {object} meta        { invoiceNumber, serviceType, organizationId, createdBy, tx, creditNoteNumber|debitNoteNumber, ... }
 */
async function _recordAdjustmentEntry(kind, invoiceId, total, components, meta = {}) {
    if (!invoiceId) {
        throw Object.assign(new Error('invoiceId is required'), { code: 'VALIDATION_ERROR' });
    }
    if (!Number.isFinite(total) || total <= 0) {
        throw Object.assign(new Error('total must be a positive number'), { code: 'VALIDATION_ERROR' });
    }

    // PLATFORM-only — STATE-fee invoices never post to the platform ledger
    // (same two-money-flow rule as recordPaymentEntry). Defensive: callers
    // already enforce eligibility upstream, but a STATE invoice would have no
    // platform revenue to adjust anyway.
    const issuerType = resolveIssuerType(meta.serviceType || 'PHASE_1_PLATFORM_FEE');
    if (issuerType === ISSUER.DTAM) {
        // A STATE invoice must not exist any more, and if one appears it is a
        // defect — so this is loud, not silent.
        //
        // Until 2026-09-05 this branch returned `{ skipped: true, reason:
        // 'STATE_FEE_NOT_IN_PLATFORM_BOOKS' }` on the 2026-05-16 reasoning that
        // the applicant wired the state fee straight to กรมบัญชีกลาง and the
        // company never touched it. W14 ended that: the farmer buys one service
        // from the company and the company pays DTAM afterwards. Under the model
        // that is actually live, a skip here means cash arrived in the bank and
        // no journal entry was written — and a `skipped` return reads as success
        // to every caller, so nothing surfaces it.
        //
        // The path that minted these invoices is retired too
        // (phase-billing-service.isPhaseSplitInvoicingRetired), so this should be
        // unreachable. It refuses rather than being deleted because "unreachable"
        // is a claim about today's callers, and money deserves a backstop.
        throw Object.assign(
            new Error(
                `STATE invoice ${meta.invoiceNumber || invoiceId} reached the journal layer. `
                + 'Split STATE/PLATFORM invoicing is retired — the company sells one service '
                + 'and books the whole ค่าบริการ as revenue. Nothing may be settled against a '
                + 'STATE invoice.',
            ),
            {
                code: 'RETIRED_STATE_INVOICE',
                invoiceId,
                serviceType: meta.serviceType || null,
                // `_recordAdjustmentEntry` names its amount `total`; the copy of
                // this refusal in recordPaymentEntry uses `amount`. Referencing
                // the wrong one threw a ReferenceError instead of the refusal —
                // caught by credit-debit-note-gl-entry.test.js.
                amount: round2(total),
            },
        );
    }

    const entry = buildAdjustmentEntryLines({
        kind,
        invoiceId,
        invoiceNumber: meta.invoiceNumber || invoiceId,
        serviceType: meta.serviceType || 'PHASE_1_PLATFORM_FEE',
        subtotal: components?.subtotal,
        vat: components?.vat,
        total,
        entryDate: meta.entryDate || new Date(),
    });

    // Period-close guard — same policy as recordPaymentEntry.
    await loadPeriodGuardOrRefuse().checkPeriodOpen({
        entryDate: entry.entryDate,
        organizationId: meta.organizationId || null,
        allowClosedPeriod: meta.allowClosedPeriod === true,
    });

    if (!entry.balanced) {
        logger.error(
            `[journal-entry] UNBALANCED ${kind} for invoice ${invoiceId}: `
            + `debit=${entry.totalDebit} credit=${entry.totalCredit}`,
        );
        throw Object.assign(
            new Error(`Unbalanced ${kind} entry: Dr ${entry.totalDebit} != Cr ${entry.totalCredit}`),
            { code: 'UNBALANCED_ENTRY' },
        );
    }

    let persisted = null;
    let fallbackReason = null;
    try {
        persisted = await persistEntry({
            entry,
            kind,
            invoiceId,
            organizationId: meta.organizationId,
            createdBy: meta.createdBy,
            tx: meta.tx,
        });
    } catch (err) {
        fallbackReason = err && err.message ? err.message : String(err);
        logger.error(
            `[journal-entry][journal-fallback] DB write failed for ${kind} on invoice ${invoiceId} — ${fallbackReason}. `
            + 'Entry is preserved in the log stream below for manual reconciliation.',
            { invoiceId, invoiceNumber: entry.invoiceNumber, kind },
        );
        // Inside a $transaction the adjustment must commit atomically with the
        // note row — re-throw so the caller's $transaction rolls back.
        if (meta.tx) {
            throw err;
        }
    }

    const marker = persisted ? '[journal-entry]' : '[journal-entry][journal-fallback]';
    logger.info(
        `${marker} balanced ${kind} for invoice ${entry.invoiceNumber} `
        + `Dr=${entry.totalDebit} Cr=${entry.totalCredit} lines=${entry.lines.length}`,
        {
            invoiceId,
            invoiceNumber: entry.invoiceNumber,
            kind,
            noteNumber: meta.creditNoteNumber || meta.debitNoteNumber || null,
            entryId: persisted ? persisted.id : null,
            entry,
            fallbackReason,
        },
    );

    if (persisted) {
        return {
            ...entry,
            persisted: true,
            journalEntryId: persisted.id,
            id: persisted.id,
            lines: persisted.lines || entry.lines,
            totalDebit: entry.totalDebit,
            totalCredit: entry.totalCredit,
        };
    }
    return {
        ...entry,
        persisted: false,
        fallback: true,
        fallbackReason: fallbackReason || null,
    };
}

/**
 * Post the REVERSING GL entry for a credit note (Dr Revenue / Dr VAT / Cr Cash).
 * Called by credit-note-service `_postReversingJournalEntry`. Signature mirrors
 * `recordPaymentEntry`: (invoiceId, total, components, meta).
 */
async function recordCreditNoteEntry(invoiceId, total, components, meta = {}) {
    return _recordAdjustmentEntry('CREDIT_NOTE', invoiceId, total, components, meta);
}

/**
 * Post the ADDITIONAL-CHARGE GL entry for a debit note (Dr Cash / Cr Revenue /
 * Cr VAT). Called by debit-note-service `_postAdditionalChargeJournalEntry`.
 */
async function recordDebitNoteEntry(invoiceId, total, components, meta = {}) {
    return _recordAdjustmentEntry('DEBIT_NOTE', invoiceId, total, components, meta);
}

/**
 * Pure-function helper for tests / accounting export — get the inferred
 * components for an invoice without recording anything.
 */
function previewPaymentEntry({ invoiceId, invoiceNumber, serviceType, totalAmount, components }) {
    return buildPaymentEntryLines({
        invoiceId,
        invoiceNumber,
        serviceType,
        totalAmount,
        components,
    });
}

// ──────────────────────────────────────────────────────────────────────────
// Reversing-entry primitive (Iter 24, 2026-05-16)
// ──────────────────────────────────────────────────────────────────────────
//
// TFRS for NPAEs ch.18 + ป.รัษฎากร ม.86/10 require posted journal entries
// to be IMMUTABLE — corrections / adjustments are made by posting a
// REVERSING entry that swaps debit ↔ credit on every line and references
// the original entry. The pair (original + reversal) nets to zero on
// every account, preserving the chronological audit trail.
//
// Until Iter 24 only credit-note-service emitted reversing entries inline.
// recordReversingEntry generalises that primitive so any caller (credit
// notes, refunds, manual JE reversals, cron back-outs) can reverse an
// existing posted entry through a single canonical helper.
//
// Idempotency: a reversal is keyed by the original entry id. The original
// entry's metadata.reversedByEntryId records the reversal id so a second
// call returns `{ skipped: true, reason: 'ALREADY_REVERSED', reversingEntryId }`
// rather than minting a second reversal. The check also queries for any
// JournalEntry whose metadata.reversalOf matches the original id, so
// concurrent callers cannot race a duplicate reversal in.

/**
 * Swap debit ↔ credit on a set of source lines, preserving accountCode /
 * accountName / issuer / taxableAmount. Pure helper — no I/O.
 *
 * Per ม.86/10 + TFRS for NPAEs ch.18 the reversal must hit the SAME
 * accounts that the original entry touched — a swap, not a re-derivation.
 */
function buildReversalLines(originalLines) {
    return originalLines.map((src, idx) => ({
        lineNumber: idx + 1,
        accountCode: src.accountCode,
        accountName: src.accountName,
        debit: round2(Number(src.credit) || 0),
        credit: round2(Number(src.debit) || 0),
        issuer: src.issuer || null,
        taxableAmount: src.taxableAmount != null ? round2(Number(src.taxableAmount)) : null,
        memo: `Reversal of line ${src.lineNumber || idx + 1} (${src.accountCode})`,
    }));
}

/**
 * Persist a reversing entry (without going through `persistEntry`'s payment
 * shape — reversals already have explicit lines, no inference needed).
 * Returns the persisted row or null when no real Prisma client is available.
 *
 * @private
 */
async function persistReversingEntry({ entry, originalEntryId, organizationId, createdBy, tx }) {
    const prisma = resolvePrisma(tx);
    if (!prisma) {
        return null;
    }
    return prisma.journalEntry.create({
        data: {
            entryDate: entry.entryDate,
            reference: entry.reference,
            invoiceId: entry.invoiceId || null,
            description: entry.description,
            totalDebit: entry.totalDebit,
            totalCredit: entry.totalCredit,
            organizationId: organizationId || null,
            createdBy: createdBy || null,
            lines: {
                create: entry.lines.map((line) => ({
                    lineNumber: line.lineNumber,
                    accountCode: line.accountCode,
                    accountName: line.accountName,
                    debit: line.debit,
                    credit: line.credit,
                    issuer: line.issuer || null,
                    taxableAmount: line.taxableAmount != null ? line.taxableAmount : null,
                    metadata: {
                        memo: line.memo || null,
                        kind: 'REVERSAL',
                        reversalOf: originalEntryId,
                    },
                })),
            },
        },
        include: { lines: true },
    });
}

/**
 * Look up an existing reversal of the given original entry id. Returns
 * `{ entryId, persistedRow }` when one exists, or null otherwise.
 *
 * Idempotency strategy (two parallel checks):
 *   1. Inspect the original entry's metadata.reversedByEntryId marker —
 *      written by a previous successful recordReversingEntry call.
 *   2. Scan JournalEntry rows whose reference ends in `-REV` and whose
 *      first line's metadata.reversalOf matches — protects against races
 *      where the marker write was rolled back but the reversal committed
 *      (extremely rare, but cheap to defend against).
 *
 * @private
 */
async function findExistingReversal(prisma, originalEntry) {
    if (!originalEntry) {
        return null;
    }
    // Original entries persisted before Iter 24 do not have the marker;
    // those are eligible for a first reversal. The marker, if present,
    // is the canonical source of truth.
    //
    // JournalEntry rows don't carry a top-level metadata column today
    // (lines do). We store the marker on the FIRST line's metadata so
    // the existing schema is sufficient. firstLine.metadata may be null
    // for entries persisted before Iter 24 — that's a valid "not yet
    // reversed" state.
    const lines = Array.isArray(originalEntry.lines) ? originalEntry.lines : [];
    const sortedLines = [...lines].sort(
        (a, b) => (a.lineNumber || 0) - (b.lineNumber || 0),
    );
    const firstLine = sortedLines[0] || null;
    const markerId = firstLine?.metadata?.reversedByEntryId || null;
    if (markerId) {
        return { entryId: markerId, persistedRow: null };
    }
    // Belt-and-braces: scan for a reversal that references this original
    // via JournalLine.metadata.reversalOf. Skipped silently when prisma is
    // stubbed (tests without DB fall through to the marker path above).
    if (
        prisma
        && prisma.journalEntry
        && typeof prisma.journalEntry.findFirst === 'function'
    ) {
        const existing = await prisma.journalEntry.findFirst({
            where: {
                reference: `${originalEntry.reference}-REV`,
                isDeleted: false,
            },
            include: { lines: true },
        });
        if (existing) {
            return { entryId: existing.id, persistedRow: existing };
        }
    }
    return null;
}

/**
 * Mark the original entry as reversed by writing the reversal id onto its
 * first line's metadata. We piggy-back on JournalLine.metadata (Json?)
 * because JournalEntry itself does not carry a metadata column — adding
 * one would conflict with the schema-owner batches (B24-A / B24-B). The
 * first-line marker is queryable via Prisma JSON path filters and is
 * already the convention used for `kind`, `memo`, etc.
 *
 * @private
 */
async function markOriginalAsReversed({ prisma, originalEntry, reversingEntryId, reason, actorId }) {
    if (!prisma || !originalEntry) {
        return;
    }
    const lines = Array.isArray(originalEntry.lines) ? originalEntry.lines : [];
    const firstLine = [...lines].sort(
        (a, b) => (a.lineNumber || 0) - (b.lineNumber || 0),
    )[0];
    if (!firstLine || !firstLine.id) {
        return;
    }
    const existingMeta = (firstLine.metadata && typeof firstLine.metadata === 'object')
        ? firstLine.metadata
        : {};
    if (
        prisma.journalLine
        && typeof prisma.journalLine.update === 'function'
    ) {
        await prisma.journalLine.update({
            where: { id: firstLine.id },
            data: {
                metadata: {
                    ...existingMeta,
                    reversedByEntryId: reversingEntryId,
                    reversedAt: new Date().toISOString(),
                    reversedReason: reason,
                    reversedBy: actorId || null,
                },
            },
        });
    }
}

/**
 * Record a reversing entry for an existing posted journal entry.
 *
 * Per TFRS for NPAEs ch.18 + ป.รัษฎากร ม.86/10: posted journal entries
 * are IMMUTABLE. Errors / adjustments are corrected by posting a
 * REVERSING entry that swaps debit ↔ credit on every line and references
 * the original. The pair (original + reversal) nets to zero on every
 * account, preserving the chronological audit trail.
 *
 * Idempotency: a second call against the same originalEntryId returns
 * `{ skipped: true, reason: 'ALREADY_REVERSED', reversingEntryId }`
 * rather than minting a duplicate reversal. The check inspects the
 * original entry's first-line metadata marker (canonical) and falls back
 * to scanning for a JournalEntry with reference `<original>-REV`.
 *
 * @param {string} originalEntryId  id of the JournalEntry being reversed
 * @param {object} [options]
 * @param {string} options.reason   required — audit trail; written onto the
 *                                  reversal description + original marker
 * @param {string} [options.actorId]  who initiated the reversal
 * @param {Date}   [options.reversalDate=new Date()]  when the reversal posts
 * @param {object} [options.tx]     optional Prisma transaction client; when
 *                                  supplied the reversal commit + marker
 *                                  write run atomically with the caller's
 *                                  $transaction (TFRS for NPAEs ch.2)
 * @param {boolean} [options.partial=false]  when true, use customLines
 *                                  instead of auto-swapping every line
 * @param {object[]} [options.customLines]  partial-reversal lines (debit /
 *                                  credit / accountCode / accountName /
 *                                  issuer / taxableAmount / memo)
 * @returns {Promise<object>}  `{ persisted, journalEntryId, reversingEntryId,
 *                              originalEntryId, lines, totalDebit, totalCredit,
 *                              fallback?, fallbackReason? }` on success, OR
 *                              `{ skipped: true, reason: 'ALREADY_REVERSED',
 *                              reversingEntryId, originalEntryId }` when the
 *                              original is already reversed.
 */
async function recordReversingEntry(originalEntryId, options = {}) {
    // 1. Validate inputs.
    if (!originalEntryId || typeof originalEntryId !== 'string') {
        throw Object.assign(
            new Error('originalEntryId is required'),
            { code: 'VALIDATION_ERROR' },
        );
    }
    const reason = options.reason != null ? String(options.reason).trim() : '';
    if (!reason || reason.length < 3) {
        throw Object.assign(
            new Error('reason is required (min 3 chars) for reversing entry audit trail mandate (ม.86/10)'),
            { code: 'VALIDATION_ERROR' },
        );
    }
    if (options.partial && (!Array.isArray(options.customLines) || options.customLines.length === 0)) {
        throw Object.assign(
            new Error('customLines must be a non-empty array when partial=true'),
            { code: 'VALIDATION_ERROR' },
        );
    }

    const actorId = options.actorId || null;
    const reversalDate = options.reversalDate instanceof Date
        ? options.reversalDate
        : new Date();
    const tx = options.tx || null;
    const prisma = resolvePrisma(tx);
    // Validate reversalDate after we have it — can only validate against the
    // original entry's date once we fetch the entry (step 2 below).

    // 2. Fetch the original entry + its lines.
    let originalEntry = null;
    if (
        prisma
        && prisma.journalEntry
        && typeof prisma.journalEntry.findUnique === 'function'
    ) {
        originalEntry = await prisma.journalEntry.findUnique({
            where: { id: originalEntryId },
            include: { lines: true },
        });
    }
    if (!originalEntry) {
        throw Object.assign(
            new Error(`Original journal entry ${originalEntryId} not found`),
            { code: 'ORIGINAL_NOT_FOUND' },
        );
    }
    if (originalEntry.isDeleted) {
        throw Object.assign(
            new Error('Cannot reverse a soft-deleted journal entry'),
            { code: 'ORIGINAL_DELETED' },
        );
    }
    if (!Array.isArray(originalEntry.lines) || originalEntry.lines.length === 0) {
        throw Object.assign(
            new Error('Original journal entry has no lines — cannot reverse'),
            { code: 'ORIGINAL_NO_LINES' },
        );
    }

    // TFRS for NPAEs ch.18 / TAS 1 §54: a reversing entry must be dated on or
    // after the original entry. A reversal that precedes its original creates a
    // time-travel GL inconsistency where the reversal appears before the event.
    if (originalEntry.entryDate instanceof Date
        && reversalDate.getTime() < originalEntry.entryDate.getTime()) {
        throw Object.assign(
            new Error(
                `Reversal date ${reversalDate.toISOString()} is before the original entry date `
                + `${originalEntry.entryDate.toISOString()} — TFRS for NPAEs ch.18 requires the `
                + 'reversal to be posted on or after the original.',
            ),
            {
                code: 'REVERSAL_DATE_BEFORE_ORIGINAL',
                reversalDate,
                originalEntryDate: originalEntry.entryDate,
            },
        );
    }

    // 3. Idempotency check.
    const existing = await findExistingReversal(prisma, originalEntry);
    if (existing) {
        const skipPayload = {
            skipped: true,
            reason: 'ALREADY_REVERSED',
            originalEntryId,
            reversingEntryId: existing.entryId,
        };
        logger.info(
            `[journal-entry][reversal] skipped — original ${originalEntryId} already reversed `
            + `by entry ${existing.entryId} (TFRS NPAEs ch.18 immutability + idempotent helper).`,
            skipPayload,
        );
        return skipPayload;
    }

    // 4. Build the reversal lines.
    const reversalLines = options.partial
        ? options.customLines.map((src, idx) => ({
            lineNumber: idx + 1,
            accountCode: src.accountCode,
            accountName: src.accountName,
            debit: round2(Number(src.debit) || 0),
            credit: round2(Number(src.credit) || 0),
            issuer: src.issuer || null,
            taxableAmount: src.taxableAmount != null ? round2(Number(src.taxableAmount)) : null,
            memo: src.memo || `Partial reversal — ${reason}`,
        }))
        : buildReversalLines(originalEntry.lines);

    const totalDebit = round2(reversalLines.reduce((s, l) => s + (Number(l.debit) || 0), 0));
    const totalCredit = round2(reversalLines.reduce((s, l) => s + (Number(l.credit) || 0), 0));
    const balanced = Math.abs(totalDebit - totalCredit) < 0.005;
    if (!balanced) {
        // Defensive — auto-swap can never unbalance a balanced original.
        // A partial reversal CAN unbalance if the caller passes asymmetric
        // customLines; we reject so a torn entry never lands in the GL.
        logger.error(
            `[journal-entry][reversal] UNBALANCED reversal for original ${originalEntryId}: `
            + `Dr=${totalDebit} Cr=${totalCredit}`,
        );
        throw Object.assign(
            new Error(`Unbalanced reversing entry: Dr ${totalDebit} != Cr ${totalCredit}`),
            { code: 'UNBALANCED_ENTRY' },
        );
    }

    // 5. Compose reversal-entry header — reference = `<original>-REV`.
    const reversalReference = `${originalEntry.reference}-REV`;
    const reversalDescription = `Reversal of ${originalEntry.reference} — ${reason}`;
    const reversalEntry = {
        entryDate: reversalDate,
        reference: reversalReference,
        invoiceId: originalEntry.invoiceId || null,
        description: reversalDescription,
        totalDebit,
        totalCredit,
        balanced,
        lines: reversalLines,
    };

    // 6. Persist (with tx if supplied) + mark the original as reversed.
    let persisted = null;
    let fallbackReason = null;
    try {
        persisted = await persistReversingEntry({
            entry: reversalEntry,
            originalEntryId,
            organizationId: originalEntry.organizationId || null,
            createdBy: actorId,
            tx,
        });
        if (persisted) {
            await markOriginalAsReversed({
                prisma,
                originalEntry,
                reversingEntryId: persisted.id,
                reason,
                actorId,
            });
        }
    } catch (err) {
        fallbackReason = err && err.message ? err.message : String(err);
        logger.error(
            `[journal-entry][reversal][journal-fallback] DB write failed for reversal of `
            + `${originalEntryId} — ${fallbackReason}.`,
            { originalEntryId, reason },
        );
        // Inside a transaction we MUST re-throw so the caller rolls back —
        // a partial reversal + missing marker is worse than a clean retry.
        if (tx) {
            throw err;
        }
    }

    // 7. Audit log — REVERSING_ENTRY_POSTED (best-effort; never fails the
    //    primary operation if the audit pipeline is unavailable).
    try {
        // Lazy-require so the journal service stays loadable in environments
        // where the audit middleware (with its own Prisma + tenant context)
        // is not initialised — e.g., Jest unit runs that don't bootstrap the
        // request-scoped tenant ALS.
         
        const auditModule = require('../middleware/audit-logger');
        if (auditModule && auditModule.auditLogger && typeof auditModule.auditLogger.log === 'function') {
            await auditModule.auditLogger.log({
                category: auditModule.AuditCategory.PAYMENT,
                action: 'REVERSING_ENTRY_POSTED',
                severity: auditModule.AuditSeverity.INFO,
                actorId: actorId || 'SYSTEM',
                actorType: 'USER',
                resourceType: auditModule.ResourceType.INVOICE,
                resourceId: originalEntry.invoiceId || originalEntryId,
                organizationId: originalEntry.organizationId || null,
                metadata: {
                    originalEntryId,
                    reversingEntryId: persisted ? persisted.id : null,
                    originalReference: originalEntry.reference,
                    reversalReference,
                    totalDebit,
                    totalCredit,
                    reason,
                    partial: !!options.partial,
                },
            });
        }
    } catch (auditErr) {
        logger.warn(
            `[journal-entry][reversal] audit log failed (non-fatal): ${auditErr?.message}`,
        );
    }

    const marker = persisted
        ? '[journal-entry][reversal]'
        : '[journal-entry][reversal][journal-fallback]';
    logger.info(
        `${marker} reversal of ${originalEntry.reference} — `
        + `Dr=${totalDebit} Cr=${totalCredit} lines=${reversalLines.length} reason=${reason}`,
        {
            originalEntryId,
            originalReference: originalEntry.reference,
            reversingEntryId: persisted ? persisted.id : null,
            reason,
            partial: !!options.partial,
        },
    );

    if (persisted) {
        return {
            persisted: true,
            journalEntryId: persisted.id,
            reversingEntryId: persisted.id,
            id: persisted.id,
            originalEntryId,
            reference: reversalReference,
            description: reversalDescription,
            entryDate: reversalDate,
            totalDebit,
            totalCredit,
            balanced: true,
            lines: persisted.lines || reversalLines,
        };
    }
    return {
        persisted: false,
        fallback: true,
        fallbackReason: fallbackReason || null,
        journalEntryId: null,
        reversingEntryId: null,
        originalEntryId,
        reference: reversalReference,
        description: reversalDescription,
        entryDate: reversalDate,
        totalDebit,
        totalCredit,
        balanced: true,
        lines: reversalLines,
    };
}

module.exports = {
    ACCOUNTS,
    ISSUER,
    resolveIssuerType,
    buildPaymentEntryLines,
    buildAdjustmentEntryLines,
    buildReversalLines,
    recordPaymentEntry,
    recordCreditNoteEntry,
    recordDebitNoteEntry,
    recordReversingEntry,
    previewPaymentEntry,
    // Re-export so callers don't have to reach into the config twice when
    // wiring a journal entry from invoice-issuers metadata.
    getInvoiceIssuer,
};
