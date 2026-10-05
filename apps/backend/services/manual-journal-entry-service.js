/**
 * Manual Journal Entry Service — workflow for non-slip-driven entries.
 *
 * Batch B20-C (2026-05-16). Finance staff need to record entries that
 * aren't tied to a slip approval — bank charges, FX gain/loss, accrual
 * reversals, manual corrections after appropriate approval. This service
 * owns the draft → approval → posting workflow with strict separation
 * of duties.
 *
 * State machine:
 *
 *   ┌─────────┐  approve   ┌──────────┐   post   ┌────────┐
 *   │ DRAFT   │ ─────────▶ │ APPROVED │ ───────▶ │ POSTED │
 *   └────┬────┘            └─────┬────┘          └────────┘
 *        │                       │                    │
 *        │ reject                │ reject             │ (terminal)
 *        ▼                       ▼                    ▼
 *   ┌──────────┐            ┌──────────┐         (immutable)
 *   │ REJECTED │            │ REJECTED │
 *   └──────────┘            └──────────┘
 *
 *   - POSTED is terminal — TFRS for NPAEs forbids editing a posted entry.
 *     Corrections must be entered as a SEPARATE reversing entry.
 *   - Separation of duties: the approver MUST NOT be the same user as
 *     the creator. Enforced in approveManualEntry below.
 *
 * Compliance basis:
 *   - TFRS for NPAEs ch.2 — internal controls require segregation of
 *     incompatible functions: the staff member who creates a journal
 *     entry cannot be the one who approves it. This service enforces
 *     that gate (approverId !== createdBy).
 *   - TFRS for NPAEs ch.18 — once posted, a journal entry is part of
 *     the chronological accounting record and is immutable. Corrections
 *     are made via reversing entries.
 *   - TAS 1 (Presentation of Financial Statements) — manual entries
 *     must reference the same chart of accounts as auto entries
 *     (chart-of-accounts-service.js).
 *   - ป.รัษฎากร ม.86/4 — sequential numbering on tax-bearing documents;
 *     `draftNumber` (MJE-yyyy-nnnnnn) preserves the audit trail even
 *     when an entry is rejected (gap is meaningful — auditor can see
 *     "MJE-2026-000005 was rejected" rather than not knowing it existed).
 *   - ป.รัษฎากร ม.87/3 — 7-year retention; the draft row survives the
 *     full window with rejectedAt / rejectionReason populated.
 *
 * Schema (see prisma/schema/billing.prisma — model ManualJournalEntryDraft):
 *   - Draft row carries linesJson (validated per-line debit/credit + CoA
 *     account code).
 *   - When POSTED, a JournalEntry + JournalLine cascade is written; the
 *     resulting journalEntryId is back-stamped on the draft row so the
 *     auditor can hop from manual-entry list → posted GL entry.
 *
 * Boundary:
 *   - READS chart-of-accounts-service for CoA validation.
 *   - WRITES ManualJournalEntryDraft (this service owns the table).
 *   - WRITES JournalEntry + JournalLine on `postManualEntry` only.
 *   - Does NOT call journal-entry-service.recordPaymentEntry — that's
 *     the slip-flow path. This service writes directly via prisma
 *     inside a $transaction with description prefix '[MANUAL]' so a
 *     trial-balance dump can filter manual vs auto rows even before
 *     the dedicated entryType discriminator column lands.
 *
 * @module services/manual-journal-entry-service
 */

'use strict';

let prismaModule;
try {
    prismaModule = require('./prisma-database');
} catch (_e) {
    prismaModule = { prisma: null };
}

const logger = require('../shared/logger');
const chartOfAccounts = require('./chart-of-accounts-service');
const { localYear } = require('../utils/working-days');

// Iter 24 — Period-close guard, loaded at CALL time and FAILING CLOSED
// (controller ruling 2026-09-26): a guard that cannot load refuses the post
// with PERIOD_CHECK_UNAVAILABLE instead of being skipped.
const { loadPeriodGuardOrRefuse } = require('./period-guard-loader');

// Status state-machine values. Frozen so callers can't mutate.
const STATUS = Object.freeze({
    DRAFT: 'DRAFT',
    APPROVED: 'APPROVED',
    POSTED: 'POSTED',
    REJECTED: 'REJECTED',
});

// Audit action names — kept centralised so audit-logger callers + tests
// can import the canonical strings.
const ACTIONS = Object.freeze({
    DRAFT_CREATED: 'MANUAL_JE_DRAFT_CREATED',
    APPROVED: 'MANUAL_JE_APPROVED',
    POSTED: 'MANUAL_JE_POSTED',
    REJECTED: 'MANUAL_JE_REJECTED',
});

function round2(n) {
    return Math.round((Number(n) || 0) * 100) / 100;
}

/**
 * Resolve the current Prisma client (or null in stubbed/test envs).
 */
function resolvePrisma(tx) {
    const candidate = tx || (prismaModule && prismaModule.prisma);
    if (!candidate) {
        return null;
    }
    const model = candidate.manualJournalEntryDraft;
    if (!model || typeof model !== 'object' || typeof model.create !== 'function') {
        return null;
    }
    return candidate;
}

/**
 * Validate the lines array — each must have accountCode (existing in
 * canonical CoA), and exactly one of debit / credit > 0. Sum of debits
 * MUST equal sum of credits (TFRS for NPAEs ch.2 — double-entry
 * invariant).
 *
 * Returns { totalDebit, totalCredit, normalizedLines } on success;
 * throws { code: 'VALIDATION_ERROR' } on failure.
 */
function validateLines(lines) {
    if (!Array.isArray(lines) || lines.length < 2) {
        throw Object.assign(
            new Error('lines must be an array with at least 2 entries (one debit + one credit)'),
            { code: 'VALIDATION_ERROR' },
        );
    }

    let totalDebit = 0;
    let totalCredit = 0;
    const normalizedLines = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineNumber = Number(line.lineNumber || (i + 1));
        const accountCode = String(line.accountCode || '').trim();
        const debit = round2(line.debit || 0);
        const credit = round2(line.credit || 0);

        if (!accountCode) {
            throw Object.assign(
                new Error(`line ${lineNumber}: accountCode is required`),
                { code: 'VALIDATION_ERROR' },
            );
        }

        if (!chartOfAccounts.accountExists(accountCode)) {
            throw Object.assign(
                new Error(`line ${lineNumber}: accountCode '${accountCode}' is not in the canonical chart of accounts`),
                { code: 'UNKNOWN_ACCOUNT_CODE' },
            );
        }

        if (debit < 0 || credit < 0) {
            throw Object.assign(
                new Error(`line ${lineNumber}: debit/credit cannot be negative`),
                { code: 'VALIDATION_ERROR' },
            );
        }

        if (debit > 0 && credit > 0) {
            throw Object.assign(
                new Error(`line ${lineNumber}: cannot have both debit and credit on a single line`),
                { code: 'VALIDATION_ERROR' },
            );
        }

        if (debit === 0 && credit === 0) {
            throw Object.assign(
                new Error(`line ${lineNumber}: at least one of debit/credit must be > 0`),
                { code: 'VALIDATION_ERROR' },
            );
        }

        const account = chartOfAccounts.getAccountByCode(accountCode);
        normalizedLines.push({
            lineNumber,
            accountCode,
            accountName: account.name,
            debit,
            credit,
        });

        totalDebit = round2(totalDebit + debit);
        totalCredit = round2(totalCredit + credit);
    }

    if (Math.abs(totalDebit - totalCredit) >= 0.005) {
        throw Object.assign(
            new Error(`unbalanced entry: Dr ${totalDebit} != Cr ${totalCredit}`),
            { code: 'UNBALANCED_ENTRY' },
        );
    }

    return { totalDebit, totalCredit, normalizedLines };
}

/**
 * Allocate the next draft number — MJE-{yearAD}-{seq6}. Uses a simple
 * count+1 pattern; in production the receipt-sequence-service would
 * own this so concurrency is serializable, but for manual entries
 * the volume is low enough (single-digit per day) that count-and-go
 * is acceptable. Tests stub this via the prisma mock.
 */
async function allocateDraftNumber(prismaClient) {
    const yearAD = localYear(); // Bangkok year
    const prefix = `MJE-${yearAD}-`;
    const existing = await prismaClient.manualJournalEntryDraft.count({
        where: { draftNumber: { startsWith: prefix } },
    });
    const seq = String(existing + 1).padStart(6, '0');
    return `${prefix}${seq}`;
}

/**
 * Create a DRAFT manual journal entry.
 *
 * @param {object} args
 * @param {string} args.description       free-form (becomes [MANUAL] + description on the posted entry)
 * @param {Array}  args.lines             [{ accountCode, debit, credit }]
 * @param {string} [args.organizationId]  tenant scope
 * @param {string} args.actorId           creator user id (mandatory for segregation-of-duties)
 * @param {string|Date} args.postingDate  accounting date (defaults to today)
 * @param {string} args.reason            business reason (e.g. "Bank charge 2026-05-15")
 * @returns {Promise<object>}             persisted draft row
 */
async function createDraftManualEntry(args = {}) {
    const {
        description,
        lines,
        organizationId = null,
        actorId,
        postingDate,
        reason,
    } = args;

    if (!description || typeof description !== 'string') {
        throw Object.assign(new Error('description is required'), { code: 'VALIDATION_ERROR' });
    }
    if (!actorId) {
        throw Object.assign(new Error('actorId is required (creator user id)'), { code: 'VALIDATION_ERROR' });
    }
    if (!reason || typeof reason !== 'string') {
        throw Object.assign(new Error('reason is required'), { code: 'VALIDATION_ERROR' });
    }

    const { totalDebit, totalCredit, normalizedLines } = validateLines(lines);

    const prisma = resolvePrisma();
    if (!prisma) {
        throw Object.assign(new Error('Prisma client not available'), { code: 'DB_UNAVAILABLE' });
    }

    const draftNumber = await allocateDraftNumber(prisma);
    const postingDateValue = postingDate
        ? (postingDate instanceof Date ? postingDate : new Date(postingDate))
        : new Date();

    const draft = await prisma.manualJournalEntryDraft.create({
        data: {
            draftNumber,
            description: description.trim(),
            postingDate: postingDateValue,
            reason: reason.trim(),
            status: STATUS.DRAFT,
            linesJson: normalizedLines,
            totalDebit,
            totalCredit,
            createdBy: actorId,
            organizationId,
        },
    });

    logger.info(`[manual-je] DRAFT created ${draftNumber} (Dr=${totalDebit} Cr=${totalCredit})`, {
        draftId: draft.id,
        actorId,
        organizationId,
    });

    return draft;
}

/**
 * Approve a DRAFT manual entry.
 *
 * Separation of duties — TFRS for NPAEs ch.2 internal controls require
 * that the staff member who CREATED the entry cannot be the one who
 * APPROVES it. Enforced here: approverId !== draft.createdBy.
 *
 * @param {string} draftId
 * @param {object} args
 * @param {string} args.approverId       must NOT equal draft.createdBy
 */
async function approveManualEntry(draftId, args = {}) {
    const { approverId } = args;
    if (!approverId) {
        throw Object.assign(new Error('approverId is required'), { code: 'VALIDATION_ERROR' });
    }

    const prisma = resolvePrisma();
    if (!prisma) {
        throw Object.assign(new Error('Prisma client not available'), { code: 'DB_UNAVAILABLE' });
    }

    const draft = await prisma.manualJournalEntryDraft.findUnique({ where: { id: draftId } });
    if (!draft) {
        throw Object.assign(new Error(`draft ${draftId} not found`), { code: 'NOT_FOUND' });
    }
    if (draft.status !== STATUS.DRAFT) {
        throw Object.assign(
            new Error(`draft ${draftId} is not in DRAFT status (current: ${draft.status})`),
            { code: 'INVALID_STATE' },
        );
    }
    // SEPARATION OF DUTIES — the approver MUST be a different user.
    if (String(approverId) === String(draft.createdBy)) {
        throw Object.assign(
            new Error('approver must be different from the creator (segregation of duties)'),
            { code: 'SELF_APPROVAL_FORBIDDEN' },
        );
    }

    const updated = await prisma.manualJournalEntryDraft.update({
        where: { id: draftId },
        data: {
            status: STATUS.APPROVED,
            approvedBy: approverId,
            approvedAt: new Date(),
        },
    });

    logger.info(`[manual-je] APPROVED ${draft.draftNumber} by ${approverId}`, {
        draftId,
        createdBy: draft.createdBy,
        approverId,
    });

    return updated;
}

/**
 * Post an APPROVED draft to the journal. Writes the JournalEntry +
 * JournalLine rows inside a $transaction alongside the draft status
 * update. After posting, the draft is terminal (POSTED) and corrections
 * must be entered as a separate reversing entry.
 *
 * @param {string} draftId
 * @param {object} [args]
 * @param {string} [args.actorId]        the user clicking POST (audit
 *                                       trail only; doesn't need to be
 *                                       different from approver)
 */
async function postManualEntry(draftId, args = {}) {
    const { actorId = null, allowClosedPeriod = false } = args;
    const prisma = resolvePrisma();
    if (!prisma) {
        throw Object.assign(new Error('Prisma client not available'), { code: 'DB_UNAVAILABLE' });
    }

    const draft = await prisma.manualJournalEntryDraft.findUnique({ where: { id: draftId } });
    if (!draft) {
        throw Object.assign(new Error(`draft ${draftId} not found`), { code: 'NOT_FOUND' });
    }
    if (draft.status !== STATUS.APPROVED) {
        throw Object.assign(
            new Error(`draft ${draftId} is not in APPROVED status (current: ${draft.status})`),
            { code: 'INVALID_STATE' },
        );
    }

    // Iter 24 — Period-close guard. Reject the post when draft.postingDate
    // lands inside a CLOSED PeriodClose row, unless ADMIN supplied
    // allowClosedPeriod=true (recovery flag, audit-logged elsewhere).
    // Throws Error{code: 'PERIOD_CLOSED', year, month, organizationId}.
    await loadPeriodGuardOrRefuse().checkPeriodOpen({
        entryDate: draft.postingDate,
        organizationId: draft.organizationId || null,
        allowClosedPeriod: allowClosedPeriod === true,
    });

    // Re-validate the lines defensively — they were validated at draft
    // time, but the CoA could have changed between create and post.
    const linesArray = Array.isArray(draft.linesJson) ? draft.linesJson : [];
    const { totalDebit, totalCredit, normalizedLines } = validateLines(linesArray);

    // Atomic write — JournalEntry + lines + draft.status update commit
    // together or roll back together.
    const result = await prisma.$transaction(async (tx) => {
        const entry = await tx.journalEntry.create({
            data: {
                entryDate: draft.postingDate,
                reference: draft.draftNumber,
                // entryType discriminator: while a dedicated `entryType`
                // column hasn't been added to JournalEntry yet (DBA
                // change), the `[MANUAL]` description prefix is the
                // wire-format flag that trial-balance + financial-
                // statements aggregators read on (B19-B). Documented in
                // docs/accounting/manual-je-and-daily-cash-2026-05-16.md.
                description: `[MANUAL] ${draft.description}`,
                totalDebit,
                totalCredit,
                organizationId: draft.organizationId,
                createdBy: actorId || draft.createdBy,
                lines: {
                    create: normalizedLines.map((l) => ({
                        lineNumber: l.lineNumber,
                        accountCode: l.accountCode,
                        accountName: l.accountName,
                        debit: l.debit,
                        credit: l.credit,
                        metadata: {
                            kind: 'MANUAL',
                            draftNumber: draft.draftNumber,
                            draftId: draft.id,
                        },
                    })),
                },
            },
            include: { lines: true },
        });

        const updatedDraft = await tx.manualJournalEntryDraft.update({
            where: { id: draftId },
            data: {
                status: STATUS.POSTED,
                postedAt: new Date(),
                postedJournalEntryId: entry.id,
            },
        });

        return { entry, draft: updatedDraft };
    });

    logger.info(`[manual-je] POSTED ${draft.draftNumber} → journalEntryId=${result.entry.id}`, {
        draftId,
        journalEntryId: result.entry.id,
        actorId,
    });

    return result;
}

/**
 * Reject a draft. Valid from DRAFT or APPROVED. Records the rejector +
 * timestamp + reason; the row is preserved (audit trail) but cannot be
 * resurrected — finance must create a fresh draft if needed.
 *
 * @param {string} draftId
 * @param {object} args
 * @param {string} args.reason          ≥ 10 chars
 * @param {string} args.rejectorId
 */
async function rejectManualEntry(draftId, args = {}) {
    const { reason, rejectorId } = args;
    if (!reason || typeof reason !== 'string' || reason.trim().length < 10) {
        throw Object.assign(
            new Error('reason is required and must be at least 10 characters'),
            { code: 'VALIDATION_ERROR' },
        );
    }
    if (!rejectorId) {
        throw Object.assign(new Error('rejectorId is required'), { code: 'VALIDATION_ERROR' });
    }

    const prisma = resolvePrisma();
    if (!prisma) {
        throw Object.assign(new Error('Prisma client not available'), { code: 'DB_UNAVAILABLE' });
    }

    const draft = await prisma.manualJournalEntryDraft.findUnique({ where: { id: draftId } });
    if (!draft) {
        throw Object.assign(new Error(`draft ${draftId} not found`), { code: 'NOT_FOUND' });
    }
    if (draft.status !== STATUS.DRAFT && draft.status !== STATUS.APPROVED) {
        throw Object.assign(
            new Error(`draft ${draftId} cannot be rejected from ${draft.status}`),
            { code: 'INVALID_STATE' },
        );
    }

    const updated = await prisma.manualJournalEntryDraft.update({
        where: { id: draftId },
        data: {
            status: STATUS.REJECTED,
            rejectedAt: new Date(),
            rejectedBy: rejectorId,
            rejectionReason: reason.trim(),
        },
    });

    logger.info(`[manual-je] REJECTED ${draft.draftNumber} by ${rejectorId}`, {
        draftId,
        priorStatus: draft.status,
        reason: reason.trim(),
    });

    return updated;
}

/**
 * List drafts with optional status / org filter.
 */
async function listDrafts(args = {}) {
    const { status = null, organizationId = null, limit = 100 } = args;
    const prisma = resolvePrisma();
    if (!prisma) {
        return [];
    }
    const where = {};
    if (status) {
        where.status = status;
    }
    if (organizationId) {
        where.organizationId = organizationId;
    }
    return prisma.manualJournalEntryDraft.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        take: Math.min(Math.max(1, Math.floor(Number(limit) || 100)), 500),
    });
}

/**
 * Fetch a single draft by id (with full linesJson).
 */
async function getDraftById(draftId) {
    const prisma = resolvePrisma();
    if (!prisma) {
        return null;
    }
    return prisma.manualJournalEntryDraft.findUnique({ where: { id: draftId } });
}

module.exports = {
    STATUS,
    ACTIONS,
    validateLines,
    createDraftManualEntry,
    approveManualEntry,
    postManualEntry,
    rejectManualEntry,
    listDrafts,
    getDraftById,
};
