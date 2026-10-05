'use strict';

/**
 * Document pre-check — the wiring between an upload and its flags.
 *
 * `extract.js` (file → text) and `evaluate.js` (text + on-file data → flags)
 * are pure of the database; this module is the part that owns the
 * `document_prechecks` row's life:
 *
 *   upload ──enqueueForUpload──▶ PENDING ──runPrecheck──▶ DONE | FAILED
 *                                   │
 *                                   ├─ a later upload into the same slot ──▶ SUPERSEDED
 *                                   └─ the file deleted (retireForDocument) ─▶ SUPERSEDED, text cleared
 *
 * Warn-only: nothing here blocks an upload or a submission. The officer
 * decides; a FAILED row says so in its one flag (status.js FAILURE_FLAG, the
 * shared PRECHECK_FAILED_TH wording) instead of pretending the document is fine.
 *
 * SLOT IDS. CATALOG (catalog.js) is keyed by the 7 slot ids of
 * constants/document-slots.js (`land_deed`, `id_card`, ...). The upload door
 * canonicalises what it receives through the shared fold
 * (@gacp/validation/upload-rules `getCanonicalSlotId`) — and that fold maps
 * five of those seven onto the กทล.1 v2 ids (`land_deed` → `land_rights`,
 * `id_card` → `id_house_reg`, `company_reg` → `juristic_reg_6m`,
 * `land_consent` → `landlord_consent`, `previous_cert` →
 * `prev_cert_original`). So a row stores the CANONICAL id — the vocabulary
 * ApplicationDocumentReview.slotId and the supersede rule use, so two
 * spellings of one slot supersede each other — and the CATALOG key is found
 * by folding both sides through that same one canonicaliser. No second alias
 * table is written here.
 *
 * RETRY (Task 6 decision 3). An error thrown by extraction — the
 * PRECHECK_TIMEOUT, an OCR failure, the PDF child dying — is worth one more
 * try: on a non-final attempt `runPrecheck` leaves the row PENDING and
 * rethrows so the queue (attempts: 2) runs it again; on the final attempt it
 * writes FAILED plus the failure flag. Every other error (reference load,
 * evaluate, the write itself) writes FAILED at once and is not retried.
 * A job that dies without ever reaching those branches (a crashed worker,
 * the queue's own timeout, a stall past Bull's maxStalledCount) is caught by
 * the queue's `failed` handler, which calls `failPrecheck` once Bull holds
 * the job as failed for good (`job.isFailed()` — not the attempt count: Bull
 * fails a stalled-past-limit job without counting an attempt). What that
 * handler never sees — a job lost with Redis, or the database down inside
 * `markFailed` — is reaped by jobs/document-precheck-stale-sweep.js: a row
 * PENDING past its cutoff becomes FAILED through the same `failPrecheck`.
 *
 * TENANCY. Every read and write goes through the shared, tenant-extended
 * client (`prisma-database`). The processor runs outside any request, so
 * `runPrecheck` reads its row under `withoutTenantScope` (the deliberate
 * system bypass the other jobs use) and then does everything else inside
 * `runWithTenantContext({ organizationId: row.organizationId })`. Every
 * create also carries `organizationId` explicitly.
 *
 * PRIVACY. The national ID of an INDIVIDUAL applicant is read in exactly one
 * query that selects nothing else, reduced to its last four digits at once,
 * and never logged or stored. `evaluate` masks any id it quotes.
 *
 * @module services/document-precheck/service
 */

const { prisma } = require('../prisma-database');

/**
 * The holder fragment for a health caller's scope, or null (staff, the processor).
 */
function holderFragmentOf(holderScope) {
    if (!holderScope || typeof holderScope !== 'object' || !Array.isArray(holderScope.readIds)) { return null; }
    // Lazy: holder-access loads farm-access and the permission engine.
    return require('../holder-access').holderReadWhere(holderScope, 'DocumentPrecheck');
}
const { runWithTenantContext, withoutTenantScope } = require('../tenant-context');
const { getCanonicalSlotId } = require('@gacp/validation/upload-rules');
const { createLogger } = require('../../shared/logger');
const { extractDocument } = require('./extract');
const { evaluate } = require('./evaluate');
const { CATALOG } = require('./catalog');
const { maskId, thaiDigitsToArabic } = require('./normalize');
const { clearTextOf } = require('./clear-text');
const { PRECHECK_STATUS, FAILURE_FLAG } = require('./status');

const logger = createLogger('document-precheck');

/** Version of CATALOG + rules a row was evaluated against (DocumentPrecheck.rulesVersion). */
const RULES_VERSION = 1;

/**
 * Passed to `extractDocument`. `timeoutMs` stays well under the queue job's
 * own 120 s timeout (services/queue-service.js) so extraction's timeout —
 * which kills its child process and OCR worker — always fires first.
 */
const EXTRACT_OPTIONS = Object.freeze({ maxPages: 10, timeoutMs: 60000 });

/**
 * Fix round 1 (task-6-review.md Important 2): how long the upload waits for
 * Bull's `add`. With Redis unreachable (a blackholed host) Bull held the add
 * for ~40 s — past the web app's 30 s timeout — so the upload's response
 * changed. Past this bound the row is FAILED with the failure flag and the
 * upload answers as usual; if the add lands later after all, that job finds
 * a FAILED row and exits at the PENDING guard.
 */
const ENQUEUE_TIMEOUT_MS = 2000;

/** canonical upload slot id → CATALOG key, built once from the one canonicaliser. */
const CATALOG_KEY_BY_CANONICAL = new Map(Object.keys(CATALOG).map((key) => [getCanonicalSlotId(key), key]));

/**
 * Any spelling of a slot id (old document-slots key, กทล.1 v2 canonical id,
 * alias) → its CATALOG key, or null outside the 7 in-scope slots. Exported
 * (fix round 1, Minor 1) so Tasks 7/8 reach CATALOG through this one mapping.
 *
 * @param {string} slotId
 * @returns {string|null}
 */
function catalogKeyFor(slotId) {
    if (!slotId) {
        return null;
    }
    return CATALOG_KEY_BY_CANONICAL.get(getCanonicalSlotId(slotId)) || null;
}

/**
 * Fix round 1 (Minor 3): Postgres text columns refuse U+0000, and a text-layer
 * PDF can carry it — the DONE write then failed and the row ended FAILED.
 */
const NUL = String.fromCharCode(0);

function stripNul(value) {
    return typeof value === 'string' ? value.split(NUL).join('') : value;
}

function withoutNul(extraction) {
    const pages = Array.isArray(extraction.pages) ? extraction.pages : [];
    return { ...extraction, pages: pages.map((p) => ({ ...p, text: stripNul((p && p.text) || '') })) };
}

/** Rejects after `ms`; the timer is cleared by the caller's `finally`. */
function timeoutAfter(ms, holder) {
    return new Promise((_resolve, reject) => {
        holder.timer = setTimeout(() => reject(new Error(`document-precheck queue add did not settle within ${ms}ms`)), ms);
    });
}

function refuse(code, message) {
    return Object.assign(new Error(message), { code });
}

/** Loaded lazily: queue-service pulls in Bull and the SLA job, which the rule layer never needs. */
function precheckQueue() {
    const { getPrecheckQueue } = require('../queue-service');
    return getPrecheckQueue();
}

/**
 * Called by POST /draft-documents right after the upload is stored.
 *
 * @param {{applicationId: string, organizationId: string, documentId: string, slotId: string, absPath: string, mimeType: string}} args
 * @returns {Promise<{precheckId: string} | null>} null when the slot is outside CATALOG
 */
async function enqueueForUpload({ applicationId, organizationId, documentId, slotId, absPath, mimeType }) {
    if (!catalogKeyFor(slotId)) {
        return null;
    }
    const canonicalSlotId = getCanonicalSlotId(slotId);

    const created = await prisma.$transaction(async (tx) => {
        // Fix round 1 (Minor 2): serialise supersede+insert per (application,
        // slot). Under READ COMMITTED two concurrent uploads never saw each
        // other's insert and both rows stayed PENDING. Released at commit.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${applicationId}::text || ':' || ${canonicalSlotId}::text))`;
        await tx.documentPrecheck.updateMany({
            where: { applicationId, slotId: canonicalSlotId, status: { not: PRECHECK_STATUS.SUPERSEDED } },
            data: { status: PRECHECK_STATUS.SUPERSEDED },
        });
        return tx.documentPrecheck.create({
            data: {
                organizationId,
                applicationId,
                documentId,
                slotId: canonicalSlotId,
                status: PRECHECK_STATUS.PENDING,
                rulesVersion: RULES_VERSION,
            },
            select: { id: true },
        });
    });
    const precheckId = created.id;

    try {
        const queue = precheckQueue();
        if (!queue) {
            throw new Error('document-precheck queue is not initialised');
        }
        const holder = { timer: null };
        // jobId = precheckId (fix round 1, I1): the stale sweep asks Bull by
        // this id whether the row's job is still waiting before failing it.
        const adding = Promise.resolve(queue.add({ precheckId, absPath, mimeType }, { jobId: precheckId }));
        adding.catch(() => {}); // a late rejection after the timeout is already handled
        try {
            await Promise.race([adding, timeoutAfter(ENQUEUE_TIMEOUT_MS, holder)]);
        } finally {
            clearTimeout(holder.timer);
        }
    } catch (error) {
        logger.warn(`[document-precheck] could not queue ${precheckId}; marking it FAILED: ${error.message}`);
        await markFailed(precheckId, organizationId);
    }
    return { precheckId };
}

/**
 * PENDING → FAILED plus the failure flag, in one transaction, only while the
 * row is still PENDING (a SUPERSEDED or DONE row is never overwritten).
 */
async function markFailed(precheckId, organizationId) {
    return prisma.$transaction(async (tx) => {
        const { count } = await tx.documentPrecheck.updateMany({
            where: { id: precheckId, status: PRECHECK_STATUS.PENDING },
            data: { status: PRECHECK_STATUS.FAILED, completedAt: new Date() },
        });
        if (count === 0) {
            return false;
        }
        await tx.documentPrecheckFlag.create({ data: { ...FAILURE_FLAG, precheckId, organizationId } });
        return true;
    });
}

/**
 * The last resort for a row nobody finished: the queue's `failed` handler (a
 * job whose final attempt died without `runPrecheck` writing an outcome —
 * crashed/stalled worker, the queue's own timeout) and the stale PENDING
 * sweep (jobs/document-precheck-stale-sweep.js — a job lost with Redis, or
 * the database down inside `markFailed`). No-op unless the row is still
 * PENDING; the write runs in the row's own tenant.
 *
 * @param {string} precheckId
 * @returns {Promise<boolean>} true when this call moved the row to FAILED
 */
async function failPrecheck(precheckId) {
    // Awaited INSIDE the bypass: a Prisma query is a lazy thenable, and returned
    // un-awaited it runs outside withoutTenantScope (see the stale sweep's note).
    const row = await withoutTenantScope(async () =>
        await prisma.documentPrecheck.findUnique({ where: { id: precheckId }, select: { id: true, organizationId: true, status: true } }),
    );
    if (!row || row.status !== PRECHECK_STATUS.PENDING) {
        return false;
    }
    return runWithTenantContext({ organizationId: row.organizationId }, () => markFailed(row.id, row.organizationId));
}

/**
 * The file is gone (DELETE /draft-documents/:documentId): its pre-check goes
 * with it. Every row of that document becomes SUPERSEDED — so neither side is
 * shown observations about an empty slot and no verdict binds to it — and
 * its page text and every observation's quoted snippet are cleared in the
 * same transaction (clear-text.js `clearTextOf`), the text's retention
 * following the file's. A job still queued for it finds a row that is no
 * longer PENDING and discards its result (`runPrecheck` / the DONE write).
 *
 * Bound to the caller's application AND organisation: the where clause
 * names both (updateMany is not narrowed by the tenant extension), and
 * either one missing is refused rather than read as "any".
 *
 * @param {string} documentId
 * @param {{applicationId: string, organizationId: string}} owner
 * @returns {Promise<number>} rows that were still current and are now SUPERSEDED
 */
async function retireForDocument(documentId, { applicationId, organizationId } = {}) {
    if (!documentId || !applicationId || !organizationId) {
        throw refuse('INVALID_ARGUMENT', 'retireForDocument needs documentId, applicationId and organizationId');
    }
    const ofThisDocument = { documentId, applicationId, organizationId };
    return prisma.$transaction(async (tx) => {
        const { count } = await tx.documentPrecheck.updateMany({
            where: { ...ofThisDocument, status: { not: PRECHECK_STATUS.SUPERSEDED } },
            data: { status: PRECHECK_STATUS.SUPERSEDED },
        });
        await clearTextOf(tx, ofThisDocument);
        return count;
    });
}

function meanConfidence(pages) {
    if (!pages.length) {
        return null;
    }
    return pages.reduce((sum, p) => sum + (Number(p.confidence) || 0), 0) / pages.length;
}

/** DocumentPrecheck columns that describe the extraction itself. */
function extractionColumns(extraction) {
    const pages = Array.isArray(extraction.pages) ? extraction.pages : [];
    let ocrConfidence = null;
    if (extraction.method === 'TEXT_LAYER') {
        ocrConfidence = 100;
    } else if (extraction.method === 'OCR') {
        ocrConfidence = meanConfidence(pages);
    }
    const text = pages.map((p) => (p && p.text) || '').join('\n');
    return {
        extractMethod: extraction.method,
        ocrConfidence,
        pageCount: Number.isInteger(extraction.pageCount) ? extraction.pageCount : pages.length,
        // Full text; its retention is Task 10's rule.
        extractedText: text.trim() ? text : null,
    };
}

/**
 * The processor body (jobs/document-precheck-processor.js).
 *
 * @param {string} precheckId
 * @param {{absPath?: string, mimeType?: string, isFinalAttempt?: boolean}} [job]
 *        the uploaded file (it is not on the row) and whether the queue has
 *        a retry left. Called directly, it is the final attempt.
 * @returns {Promise<void>}
 */
async function runPrecheck(precheckId, { absPath, mimeType, isFinalAttempt = true } = {}) {
    const row = await withoutTenantScope(async () =>
        await prisma.documentPrecheck.findUnique({
            where: { id: precheckId },
            select: { id: true, status: true, applicationId: true, slotId: true, organizationId: true },
        }),
    );
    if (!row) {
        logger.warn(`[document-precheck] ${precheckId} not found; nothing to run`);
        return;
    }
    if (row.status !== PRECHECK_STATUS.PENDING) {
        logger.info(`[document-precheck] ${precheckId} is ${row.status}; skipped`);
        return;
    }
    await runWithTenantContext({ organizationId: row.organizationId }, () => runPending(row, { absPath, mimeType, isFinalAttempt }));
}

async function runPending(row, { absPath, mimeType, isFinalAttempt }) {
    let extraction;
    try {
        extraction = withoutNul(await extractDocument(absPath, mimeType, EXTRACT_OPTIONS));
    } catch (error) {
        if (!isFinalAttempt) {
            logger.warn(`[document-precheck] ${row.id} extraction failed (${error.code || error.message}); the queue retries it`);
            throw error;
        }
        logger.warn(`[document-precheck] ${row.id} extraction failed on the final attempt (${error.code || error.message}); FAILED`);
        await markFailed(row.id, row.organizationId);
        return;
    }

    try {
        const reference = await loadReference(row.applicationId);
        const flags = evaluate({ extraction, reference, slotId: catalogKeyFor(row.slotId), now: new Date() });
        const written = await prisma.$transaction(async (tx) => {
            const { count } = await tx.documentPrecheck.updateMany({
                where: { id: row.id, status: PRECHECK_STATUS.PENDING },
                data: { status: PRECHECK_STATUS.DONE, completedAt: new Date(), ...extractionColumns(extraction) },
            });
            if (count === 0) {
                return false;
            }
            await tx.documentPrecheckFlag.createMany({
                data: flags.map((flag) => ({
                    precheckId: row.id,
                    organizationId: row.organizationId,
                    check: flag.check,
                    result: flag.result,
                    reasonTH: stripNul(flag.reasonTH),
                    confidence: flag.confidence,
                    evidenceSnippet: stripNul(flag.evidenceSnippet ?? null),
                })),
            });
            return true;
        });
        if (!written) {
            logger.info(`[document-precheck] ${row.id} was superseded while it ran; its flags are discarded`);
        }
    } catch (error) {
        logger.error(`[document-precheck] ${row.id} failed after extraction: ${error.message}`);
        await markFailed(row.id, row.organizationId);
    }
}

function trimmed(value) {
    const s = typeof value === 'string' ? value.trim() : '';
    return s || undefined;
}

/**
 * The applicant's on-file data `evaluate` compares a document against.
 * Explicit selects only.
 *
 * @param {string} applicationId
 * @returns {Promise<{entityType?: string, entityName?: string, juristicId?: string, directorName?: string, applicantName?: string, citizenIdLast4?: string}>}
 */
async function loadReference(applicationId) {
    const application = await prisma.application.findUnique({
        where: { id: applicationId },
        select: {
            entityId: true,
            applicant: { select: { firstName: true, lastName: true } },
            entity: { select: { type: true, displayName: true, juristicId: true, payload: true } },
        },
    });
    if (!application) {
        throw refuse('NOT_FOUND', `application ${applicationId} not found`);
    }

    const reference = {};
    const { applicant, entity } = application;
    if (entity) {
        reference.entityType = entity.type;
        if (entity.type !== 'INDIVIDUAL') {
            // An INDIVIDUAL entity's name is the person — already the applicant name.
            reference.entityName = trimmed(entity.displayName);
            reference.juristicId = trimmed(entity.juristicId);
            const payload = entity.payload && typeof entity.payload === 'object' ? entity.payload : {};
            reference.directorName = trimmed(payload.director && payload.director.name);
        }
    }
    reference.applicantName = trimmed([applicant && applicant.firstName, applicant && applicant.lastName].filter(Boolean).join(' '));

    if (entity && entity.type === 'INDIVIDUAL' && application.entityId) {
        const idRow = await prisma.entity.findUnique({ where: { id: application.entityId }, select: { thaiCitizenId: true } });
        const digits = String((idRow && idRow.thaiCitizenId) || '').replace(/\D/g, '');
        reference.citizenIdLast4 = digits.length === 13 ? digits.slice(-4) : undefined;
    }

    for (const key of Object.keys(reference)) {
        if (reference[key] === undefined) {
            delete reference[key];
        }
    }
    return reference;
}

/**
 * The applicant has read this pre-check's observations. Owner only — the
 * owner is the applicant the application is filed under (Application.healthId,
 * the same key every applicant read in application-service scopes by).
 * Keeps the first acknowledgement time.
 *
 * @param {string} precheckId
 * @param {string} healthUserId the caller's healthId
 * @param {{ holderScope?: object|null }} [options] the applicant's holder scope (holder-access)
 */
async function acknowledge(precheckId, healthUserId, { holderScope = null } = {}) {
    // The applicant door passes its holder scope (spec 2026-09-30 §3.1): the
    // lookup is then findFirst + the fragment. The healthId check below stays:
    // the acknowledgement is the filer's own act (spec §3.3 names no other rule
    // for it; R2 Task 12 left it unchanged).
    const select = { id: true, application: { select: { healthId: true } } };
    const fragment = holderFragmentOf(holderScope);
    const row = fragment
        ? await prisma.documentPrecheck.findFirst({ where: { id: precheckId, ...fragment }, select })
        : await prisma.documentPrecheck.findUnique({ where: { id: precheckId }, select });
    if (!row) {
        throw refuse('NOT_FOUND', 'pre-check not found');
    }
    if (!healthUserId || !row.application || row.application.healthId !== healthUserId) {
        throw refuse('FORBIDDEN', 'only the applicant may acknowledge this pre-check');
    }
    await prisma.documentPrecheck.updateMany({
        where: { id: precheckId, applicantAcknowledgedAt: null },
        data: { applicantAcknowledgedAt: new Date() },
    });
}

// ── Task 7: what the applicant and the officer are shown ─────────────────────

const PRECHECK_VIEW_SELECT = Object.freeze({
    id: true,
    slotId: true,
    status: true,
    applicantAcknowledgedAt: true,
    createdAt: true,
    // Never extractedText: neither side is shown the page's full text.
    flags: {
        select: { check: true, result: true, reasonTH: true, confidence: true, evidenceSnippet: true },
    },
});

/**
 * The current pre-check of every slot of one application: per canonical slot
 * id, the newest row (createdAt desc) that is not SUPERSEDED, with its flags.
 *
 * Read through the tenant-extended client with no organizationId of its own:
 * inside a request the org scope is the data layer's (tenant-prisma-extension
 * applyReadScopes), so another organisation's rows never come back.
 *
 * @param {string} applicationId
 * @param {{ holderScope?: object|null }} [options] the applicant's holder scope (holder-access)
 * @returns {Promise<Map<string, {id: string, slotId: string, status: string, acknowledgedAt: Date|null, flags: object[]}>>}
 */
async function currentForSlots(applicationId, { holderScope = null } = {}) {
    const rows = await prisma.documentPrecheck.findMany({
        // The applicant's requirements door passes its holder scope (spec
        // 2026-09-30 §3.1); the officer surfaces pass none.
        where: { applicationId, ...(holderFragmentOf(holderScope) || {}), status: { not: PRECHECK_STATUS.SUPERSEDED } },
        orderBy: { createdAt: 'desc' },
        select: PRECHECK_VIEW_SELECT,
    });
    const bySlot = new Map();
    for (const row of rows) {
        const slotId = getCanonicalSlotId(row.slotId);
        if (!bySlot.has(slotId)) {
            bySlot.set(slotId, {
                id: row.id,
                slotId,
                status: row.status,
                acknowledgedAt: row.applicantAcknowledgedAt || null,
                flags: Array.isArray(row.flags) ? row.flags : [],
            });
        }
    }
    return bySlot;
}

/**
 * The id of the slot's current pre-check when that pre-check is DONE, else
 * null (none yet, still PENDING, FAILED, or a slot outside CATALOG). Stored on
 * the officer's verdict row as the pre-check the verdict was taken over.
 *
 * @param {string} applicationId
 * @param {string} slotId any spelling
 * @returns {Promise<string|null>}
 */
async function currentDonePrecheckId(applicationId, slotId) {
    if (!catalogKeyFor(slotId)) {
        return null;
    }
    const current = await prisma.documentPrecheck.findFirst({
        where: { applicationId, slotId: getCanonicalSlotId(slotId), status: { not: PRECHECK_STATUS.SUPERSEDED } },
        orderBy: { createdAt: 'desc' },
        select: { id: true, status: true },
    });
    return current && current.status === PRECHECK_STATUS.DONE ? current.id : null;
}

// A full id in Arabic or Thai digits: 13+ in a row, or the printed 1-4-5-2-1
// grouping. Masked on the way out whatever the stored text holds.
const ID_DIGIT = '[0-9๐-๙]';
const RAW_ID_RE = new RegExp(
    `${ID_DIGIT}{13,}|(?<!${ID_DIGIT})${ID_DIGIT}[-\\s]${ID_DIGIT}{4}[-\\s]${ID_DIGIT}{5}[-\\s]${ID_DIGIT}{2}[-\\s]${ID_DIGIT}(?!${ID_DIGIT})`,
    'g',
);

/**
 * The longest evidenceSnippet a door returns (Task 7 review M3). The column has
 * no length limit; the officer needs a quote, not a page. Applied AFTER
 * masking, so a cut can never leave the leading digits of an id unmasked.
 */
const EVIDENCE_SNIPPET_MAX_CHARS = 200;

function capSnippet(text) {
    return typeof text === 'string' && text.length > EVIDENCE_SNIPPET_MAX_CHARS
        ? text.slice(0, EVIDENCE_SNIPPET_MAX_CHARS)
        : text;
}

function maskRawIds(text) {
    if (typeof text !== 'string') {
        return text === undefined ? null : text;
    }
    return text.replace(RAW_ID_RE, (match) => maskId(thaiDigitsToArabic(match)));
}

/**
 * One slot's pre-check as a side may see it, or null when the slot is outside
 * CATALOG or has no current pre-check.
 *
 * applicant: {id, status, flags: [{check, result, reasonTH}], acknowledgedAt}
 * officer:   the same, each flag also carrying confidence and evidenceSnippet
 *            (masked, then cut to EVIDENCE_SNIPPET_MAX_CHARS).
 * Every flag is kept — NOT_FOUND is an observation, never dropped.
 *
 * @param {Map<string, object>} current from currentForSlots
 * @param {string} slotId any spelling
 * @param {'applicant'|'officer'} side
 */
function precheckViewFor(current, slotId, side) {
    if (!catalogKeyFor(slotId) || !current) {
        return null;
    }
    const view = current.get(getCanonicalSlotId(slotId));
    if (!view) {
        return null;
    }
    const flags = view.flags.map((flag) => {
        const shown = { check: flag.check, result: flag.result, reasonTH: maskRawIds(flag.reasonTH) };
        if (side === 'officer') {
            shown.confidence = flag.confidence;
            shown.evidenceSnippet = capSnippet(maskRawIds(flag.evidenceSnippet));
        }
        return shown;
    });
    return { id: view.id, status: view.status, flags, acknowledgedAt: view.acknowledgedAt };
}

module.exports = {
    RULES_VERSION,
    ENQUEUE_TIMEOUT_MS,
    PRECHECK_STATUS,
    catalogKeyFor,
    FAILURE_FLAG,
    enqueueForUpload,
    runPrecheck,
    failPrecheck,
    retireForDocument,
    loadReference,
    acknowledge,
    currentForSlots,
    currentDonePrecheckId,
    precheckViewFor,
};
