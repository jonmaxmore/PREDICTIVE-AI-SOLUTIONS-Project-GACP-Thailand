'use strict';

/**
 * PDPA: clear the text a document pre-check read off a person's papers.
 *
 * `DocumentPrecheck.extractedText` (the whole page) and
 * `DocumentPrecheckFlag.evidenceSnippet` (a short quote per observation) can
 * hold the person's name, address and id numbers. Two rules end a person's
 * data and both call this, with their own client:
 *   - jobs/pdpa-retention-job.js — the user's retention window has passed;
 *   - services/pdpa-erasure-service.js executeErasure — the user asked
 *     (PDPA ม.32), inside that erasure's transaction `tx`.
 *
 * What stays: the rows, status, and each observation's check / result /
 * reasonTH / confidence — the record that a check ran and what it said, with
 * no text off the page. A row still PENDING (its job not yet run) becomes
 * FAILED with the failure flag, so the late job cannot write text back.
 *
 * Legal hold wins (shared/legal-hold-guard.js): an application under legal
 * hold keeps its text. The hold predicate is part of the same UPDATE, so a
 * hold is honoured at the moment of the write.
 *
 * Idempotent: rows already cleared are not matched again.
 *
 * Bound to the caller's client — no prisma import here — so the write joins
 * the caller's transaction and tenant scope (the erasure passes its `tx`; the
 * retention sweep passes its client inside `withoutTenantScope`).
 *
 * @param {object} client a Prisma client or transaction client
 * @param {string} userId User.id of the applicant (Application.applicant)
 * @returns {Promise<number>} pre-checks whose page text was cleared
 */
const { legalHoldExclusion } = require('../../shared/legal-hold-guard');
const { PRECHECK_STATUS, FAILURE_FLAG } = require('./status');

/**
 * Null the page text of every pre-check matching `precheckWhere`, and the
 * quoted snippet of each of their observations. The one clearing both rules
 * below share with the retirement of a deleted file
 * (service.js retireForDocument).
 *
 * @param {object} client a Prisma client or transaction client
 * @param {object} precheckWhere a DocumentPrecheck where clause
 * @returns {Promise<number>} pre-checks whose page text was cleared
 */
async function clearTextOf(client, precheckWhere) {
    await client.documentPrecheckFlag.updateMany({
        where: { precheck: precheckWhere, evidenceSnippet: { not: null } },
        data: { evidenceSnippet: null },
    });
    const cleared = await client.documentPrecheck.updateMany({
        where: { ...precheckWhere, extractedText: { not: null } },
        data: { extractedText: null },
    });
    return (cleared && cleared.count) || 0;
}

/**
 * Final review I3: a job still queued when the text is cleared would write
 * the page text back afterwards. Every matching row still PENDING becomes
 * FAILED with the failure flag instead; the processor's DONE write requires
 * PENDING (service.js runPending), so that late job discards its result.
 * One row at a time, each conditioned on PENDING, so a row whose job wrote
 * DONE in between is left to clearTextOf and never gets a failure flag.
 * Inside the erasure's `tx` this is part of that transaction; on the
 * retention sweep's plain client each row's two writes are separate.
 *
 * @returns {Promise<number>} rows moved PENDING → FAILED
 */
async function failPendingOf(client, precheckWhere) {
    const pending = await client.documentPrecheck.findMany({
        where: { ...precheckWhere, status: PRECHECK_STATUS.PENDING },
        select: { id: true, organizationId: true },
    });
    let failed = 0;
    for (const row of pending) {
        const { count } = await client.documentPrecheck.updateMany({
            // precheckWhere again: the legal-hold predicate holds at the write.
            where: { ...precheckWhere, id: row.id, status: PRECHECK_STATUS.PENDING },
            data: { status: PRECHECK_STATUS.FAILED, completedAt: new Date() },
        });
        if (count === 1) {
            await client.documentPrecheckFlag.create({ data: { ...FAILURE_FLAG, precheckId: row.id, organizationId: row.organizationId } });
            failed += 1;
        }
    }
    return failed;
}

async function clearPrecheckText(client, userId) {
    if (!userId) {
        throw new Error('clearPrecheckText: userId is required');
    }
    const ofThisUser = { application: { applicant: { id: userId }, ...legalHoldExclusion() } };
    await failPendingOf(client, ofThisUser);
    return clearTextOf(client, ofThisUser);
}

module.exports = { clearPrecheckText, clearTextOf };
