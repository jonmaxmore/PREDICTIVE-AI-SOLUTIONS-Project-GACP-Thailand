'use strict';

/**
 * @module services/onsite-evidence-gate
 *
 * cert-integrity fix (Phase A2, 2026-08-16) — see the change log.
 *
 * Shared fail-closed gate: is there sufficient, VERIFIABLE onsite-audit
 * evidence (a recorded audit + enough photos + a completed checklist) for an
 * application before a PASS decision or a certificate mint may proceed?
 *
 * Phase A (submitDecision) closed this hole in exactly ONE of the paths that
 * can transition an application to AUDIT_PASSED. Three others remained open
 * because they never went through submitDecision at all:
 *   - routes/api/audit/audits.js POST /:id/result
 *   - routes/api/provider/handlers/auditor-audit-decision-handler.js
 *   - routes/api/provider/auditor.js final-approvals (direct generateCertificate call)
 * Every one of those — and submitDecision — ultimately funnels through
 * certificate-service.generateCertificate to actually mint a Certificate row.
 * Extracting the check here and calling it from INSIDE generateCertificate
 * (before any mint/DB write) closes all paths at the one place they all
 * cross, instead of chasing each call site individually.
 *
 * FAIL-CLOSED: any inability to VERIFY evidence — no onsite audit row at all
 * for the application, or the photo/checklist-item models not provisioned
 * (even if only ONE of the two is missing) — REFUSES rather than skips. A
 * certificate must never issue on unverifiable evidence.
 *
 * "Sufficient" means answers, not artifacts. Each round of adversarial review
 * has found the same shape of hole: something the gate counted turned out to be
 * satisfiable without the evidence it stood for. Photos became DISTINCT photos;
 * checklist ROWS became answered template items, and a critical item recorded
 * FAIL now refuses the mint outright (2026-08-26).
 *
 * CHECKLIST_TEMPLATE_2026 / DEFAULT_MIN_PHOTOS stay single-sourced in
 * audit-onsite-service.js; that module is required lazily (inside the
 * function body, not at module load) so this file has no load-time
 * dependency on it — audit-onsite-service.js requires THIS module at its own
 * top level to delegate submitDecision's evidence check here, and a
 * module-load-time require in both directions would be a cycle.
 */

const { resolveCurrentOnsiteAuditId } = require('./onsite-audit-resolver');

/**
 * The verdicts submitChecklistItem accepts (audit-onsite-service.js:533) and
 * therefore the only strings that mean "the auditor answered this item".
 *
 * FarmAuditChecklistItem.response is a plain String column, not an enum
 * (prisma/schema/audit-onsite-evidence.prisma), so the DB itself will hold
 * whatever a writer puts there — '', 'PENDING', a typo from some future
 * importer. A row is not an answer; only a recognised verdict is.
 */
const ANSWERED_RESPONSES = Object.freeze(['PASS', 'FAIL', 'NA']);

/**
 * Answers on a CRITICAL item that leave the inspection's own verdict intact.
 *
 * CHECKLIST_TEMPLATE_2026's contract (audit-onsite-service.js:159) is "a single
 * FAIL on a critical item forces overall FAIL". NA is not FAIL — a critical item
 * can be genuinely inapplicable to a farm — so NA does not block issuance here.
 */
const CRITICAL_UPHELD_RESPONSES = Object.freeze(['PASS', 'NA']);

/**
 * Canonical form of a stored FarmAuditPhoto.fileHash, or null when the row
 * carries nothing that can identify the bytes it was made from.
 *
 * Lower-cased because computePhotoHash emits lower-case hex and the rest of
 * the platform canonicalises before comparing: a row holding the same digest
 * in upper case is the SAME photograph, and counting it as a second one would
 * reopen the hole this function exists to close.
 */
function _canonicalPhotoHash(value) {
    if (typeof value !== 'string') { return null; }
    const trimmed = value.trim().toLowerCase();
    return trimmed || null;
}

/**
 * Number of DISTINCT photographs recorded for an audit.
 *
 * Evidence-integrity fix (2026-08-26): this used to be
 * `farmAuditPhoto.count({ where: { auditId } })` — a ROW count. FarmAuditPhoto
 * stores a SHA-256 over the raw bytes and nothing compared it, and there is no
 * unique constraint on (auditId, fileHash), so "at least N photos" was
 * satisfiable by uploading ONE photograph N times: the same image, N rows, a
 * certificate minted on a single photograph. Counting distinct hashes makes
 * the minimum mean what GACP-PRD §6.5 says it means, and it applies to rows
 * written BEFORE this fix too — which a door-side check alone cannot do.
 *
 * A row whose hash is null/empty counts as ZERO, not as one: an unidentifiable
 * row cannot be shown to be a different photograph from any other row, and the
 * fail-closed answer to "cannot verify" is "does not count" (same reasoning as
 * EVIDENCE_CAPTURE_UNAVAILABLE below). The column is non-nullable in the
 * schema, so this only bites rows written by some future/legacy writer that
 * skipped the hash.
 *
 * Evidence-integrity fix (2026-08-26, second pass): this used to fall back to
 * `farmAuditPhoto.count()` — a ROW count, the very thing the distinct count
 * replaced — whenever the delegate did not expose findMany. Prisma delegates
 * always expose findMany (client AND interactive-transaction handle), so the
 * fallback could only ever serve a hand-written stub; but "if the client looks
 * unusual, count rows instead" is a fail-OPEN branch inside the gate that
 * decides government certificates, and a stub is exactly what an under-tested
 * new caller looks like. The delegate shape is now part of the provisioning
 * check in assertOnsiteEvidenceSufficient (EVIDENCE_CAPTURE_UNAVAILABLE), so
 * an unusual client refuses instead of being counted a laxer way.
 */
async function _countDistinctPhotos(prisma, auditId) {
    const rows = await prisma.farmAuditPhoto.findMany({
        where: { auditId },
        select: { fileHash: true },
    });
    const distinct = new Set();
    for (const row of Array.isArray(rows) ? rows : []) {
        const hash = _canonicalPhotoHash(row?.fileHash);
        if (hash) { distinct.add(hash); }
    }
    return distinct.size;
}

/**
 * @param {object} args
 * @param {object} args.prisma          — prisma client OR tx handle
 * @param {string} args.applicationId   — REQUIRED. The application a certificate is about to
 *   be minted for. See the "unbound call" note in the body: without it the pin cannot be
 *   bound to anything, so the gate answers a question no caller asked
 * @param {string} [args.auditId]       — optional pinned AuditChecklist.id (Task 3); verified
 *   live (isDeleted:false) AND bound to args.applicationId. A pin that fails that check
 *   REFUSES (AUDIT_APPLICATION_MISMATCH) — it never silently falls back to
 *   resolveCurrentOnsiteAuditId, because a decision that named the wrong row is a fact worth
 *   surfacing, not one to paper over with a second guess
 * @param {string} [args.organizationId] — defense-in-depth filter, applied only when truthy
 * @param {number} [args.minPhotos]     — defaults to audit-onsite-service.DEFAULT_MIN_PHOTOS
 * @returns {Promise<{ auditId: string, photoCount: number, itemCount: number }>}
 *   photoCount is the number of DISTINCT photographs (distinct fileHash), not
 *   the number of FarmAuditPhoto rows — see _countDistinctPhotos. itemCount is
 *   the number of template items carrying a RECOGNISED verdict, not the number
 *   of FarmAuditChecklistItem rows.
 * @throws {Error} code one of NO_ONSITE_AUDIT | AUDIT_APPLICATION_MISMATCH |
 *   EVIDENCE_CAPTURE_UNAVAILABLE | INSUFFICIENT_PHOTOS | INCOMPLETE_CHECKLIST |
 *   CRITICAL_CHECKLIST_FAILURE
 */
async function assertOnsiteEvidenceSufficient(args) {
    const { prisma, applicationId, auditId: pinnedAuditId, organizationId, minPhotos } = args || {};
    if (!prisma) { throw new TypeError('assertOnsiteEvidenceSufficient: prisma required'); }
    // Evidence-integrity fix (2026-08-26, third pass): applicationId used to be
    // optional ("applicationId or auditId required"), and the application
    // binding added earlier the same day was applied only `if (applicationId)`.
    // So a caller passing an auditId alone got the pre-binding gate back: any
    // live AuditChecklist id satisfied it, for whatever application the caller
    // happened to be minting. That is the exact hole the binding was opened to
    // close, still reachable through the front door.
    //
    // Required, rather than "resolve the application from the audit": resolving
    // it would be vacuous. The audit's own applicationId always equals itself,
    // so there is nothing to compare it against and a wrong pin would still
    // pass — the binding only means something when the CALLER says which
    // application it is about. TypeError, not a coded refusal, because a caller
    // that does not know the application it is certifying is a programming
    // error, not a data condition; it is thrown before any read, and it aborts
    // the mint, which is the safe direction. Both in-repo callers already pass
    // one — audit-onsite-service.submitDecision (audit.application.id) and
    // certificate-service.generateCertificate (its own applicationId argument)
    // — so nothing legitimate loses a path here.
    if (!applicationId) {
        throw new TypeError('assertOnsiteEvidenceSufficient: applicationId required (an auditId alone cannot be bound to the application being certified)');
    }

    // eslint-disable-next-line global-require
    const onsite = require('./audit-onsite-service');
    const requiredPhotos = Number.isInteger(minPhotos) ? minPhotos : onsite.DEFAULT_MIN_PHOTOS;
    const templateItems = Array.isArray(onsite.CHECKLIST_TEMPLATE_2026) ? onsite.CHECKLIST_TEMPLATE_2026 : [];
    const templateCodes = templateItems.map((item) => item.itemCode);
    // Criticality is read from the TEMPLATE, not from the row's denormalized
    // isCritical copy: the row copies the flag at write time, so a row is free
    // to disagree with the template it was written from, and the template is
    // the side that says what GACP-PRD §6 requires.
    const criticalCodes = templateItems.filter((item) => item.isCritical === true).map((item) => item.itemCode);
    const requiredItems = templateCodes.length;

    // Single-sourced resolution (onsite-audit-resolver). When Task 3 pins an
    // auditId (the decision freezes the row), verify that exact row is live;
    // otherwise resolve the current row for the application.
    //
    // Evidence-integrity fix (2026-08-26): the pinned lookup used to be
    // `{ id: auditId, isDeleted: false }` with NO applicationId, even though
    // the pin arrives from `app.formData.onsiteAuditId` — an Application-scoped
    // blob. Any live AuditChecklist id therefore satisfied the gate for ANY
    // application: adversarial review minted a certificate for an application
    // whose own audit had zero photos by pinning it to a DIFFERENT
    // application's audit, and the mint recorded photoCount 5 taken on another
    // farm. An audit is this application's evidence only if it BELONGS to this
    // application; AuditChecklist.applicationId is a direct FK
    // (prisma/schema/system.prisma AuditChecklist), so the binding is one
    // column, not a join through farm/inspection. The filter is now
    // UNCONDITIONAL — applicationId is required above, so there is no longer a
    // call shape that reaches this lookup unbound.
    let auditId = pinnedAuditId || null;
    if (auditId) {
        const pinnedWhere = { id: auditId, isDeleted: false, applicationId };
        if (organizationId) { pinnedWhere.organizationId = organizationId; }
        const live = await prisma.auditChecklist.findFirst({
            where: pinnedWhere,
            select: { id: true },
        });
        if (!live) {
            // Distinct from NO_ONSITE_AUDIT: the application may well have a
            // perfectly good audit of its own. What failed is the pin, and
            // "no audit record found" would send the reader looking in the
            // wrong place.
            const err = new Error(
                `assertOnsiteEvidenceSufficient: pinned audit ${auditId} is not a live onsite audit of application ${applicationId} — refused (fail-closed). Re-record the decision so the pin names this application's own audit.`,
            );
            err.code = 'AUDIT_APPLICATION_MISMATCH';
            throw err;
        }
        auditId = live.id;
    } else {
        auditId = await resolveCurrentOnsiteAuditId(prisma, applicationId, { organizationId });
    }
    if (!auditId) {
        const err = new Error(
            `assertOnsiteEvidenceSufficient: no onsite audit record found for application ${applicationId} — cannot certify an application with no recorded onsite audit.`,
        );
        err.code = 'NO_ONSITE_AUDIT';
        throw err;
    }

    // The check names the EXACT delegate methods this gate calls —
    // farmAuditPhoto.findMany (distinct-hash count) and
    // farmAuditChecklistItem.count. It used to demand `count` on both, which
    // let a client with `count` but no `findMany` through to a laxer row count
    // inside _countDistinctPhotos; a client that cannot answer the question the
    // gate actually asks is an unverifiable client, and unverifiable refuses.
    if (typeof prisma.farmAuditPhoto?.findMany !== 'function'
        || typeof prisma.farmAuditChecklistItem?.count !== 'function') {
        const err = new Error(
            'assertOnsiteEvidenceSufficient: cannot verify onsite evidence — photo/checklist capture is not provisioned; refused (fail-closed). A certificate must never issue on unverifiable evidence.',
        );
        err.code = 'EVIDENCE_CAPTURE_UNAVAILABLE';
        throw err;
    }

    // DISTINCT photographs, not rows — see _countDistinctPhotos.
    const photoCount = await _countDistinctPhotos(prisma, auditId);
    if (photoCount < requiredPhotos) {
        const err = new Error(
            `assertOnsiteEvidenceSufficient: minimum ${requiredPhotos} photos required (got ${photoCount} distinct)`,
        );
        err.code = 'INSUFFICIENT_PHOTOS';
        throw err;
    }

    // ANSWERED template items, not rows.
    //
    // Evidence-integrity fix (2026-08-26, third pass): this used to be
    // `count({ where: { auditId } })` — a bare ROW count with no filter on the
    // verdict the auditor recorded. The checklist half of the gate therefore
    // never read the checklist: a row existed, so the item was "done", whatever
    // it said. Two things got through. A row carrying no recognised verdict
    // (response is a plain String column, so '' or 'PENDING' is storable)
    // counted as an answer; and a row for an itemCode outside
    // CHECKLIST_TEMPLATE_2026 counted toward a total that means "the canonical
    // template was completed".
    //
    // Filtering both in the `where` — rather than reading rows and de-duplicating
    // in memory the way _countDistinctPhotos must — is safe HERE because
    // FarmAuditChecklistItem carries @@unique([auditId, itemCode])
    // (prisma/schema/audit-onsite-evidence.prisma). One row per template item is
    // a database fact, so a filtered count of template codes IS a distinct-answer
    // count and cannot be inflated by repetition. FarmAuditPhoto has no
    // equivalent unique on (auditId, fileHash), which is exactly why photos need
    // the in-memory Set and this does not.
    const itemCount = await prisma.farmAuditChecklistItem.count({
        where: { auditId, itemCode: { in: templateCodes }, response: { in: ANSWERED_RESPONSES } },
    });
    if (itemCount < requiredItems) {
        const err = new Error(
            `assertOnsiteEvidenceSufficient: ${requiredItems} checklist items required (got ${itemCount} answered)`,
        );
        err.code = 'INCOMPLETE_CHECKLIST';
        throw err;
    }

    // A completed inspection that says the farm does not comply.
    //
    // CHECKLIST_TEMPLATE_2026 states the rule at audit-onsite-service.js:159 —
    // "a single FAIL on a critical item forces overall FAIL" — and until now
    // NOTHING in the repo implemented it. The overall decision is not computed
    // from the items at all: submitDecision takes `decision` as an argument and
    // writes it (audit-onsite-service.js:822), and the three other decision
    // doors do the same. So an auditor could record FAIL on every critical item
    // and then submit PASS, and every gate downstream agreed, because each one
    // was counting artifacts rather than reading them.
    //
    // It goes HERE, at the choke point, for the same reason the evidence check
    // itself was moved here in Phase A2 (module header): submitDecision is one
    // of four doors to a mint and the other three never touch it. This does not
    // take the PASS/FAIL judgement away from the auditor — a FAIL decision
    // never calls this gate (it routes to CAR_PENDING) and is unaffected. What
    // it refuses is the contradiction: minting a certificate on top of an
    // inspection whose own critical findings say the farm does not comply.
    //
    // Expressed as "every critical item is upheld" rather than "no critical item
    // failed" so the check is a positive count against a known denominator: the
    // unique constraint bounds it at exactly criticalCodes.length, so a shortfall
    // is unambiguous. It runs AFTER the completeness check, so by this point
    // every template item has an answer and a shortfall can only mean FAIL.
    if (criticalCodes.length > 0) {
        const criticalUpheld = await prisma.farmAuditChecklistItem.count({
            where: { auditId, itemCode: { in: criticalCodes }, response: { in: CRITICAL_UPHELD_RESPONSES } },
        });
        if (criticalUpheld < criticalCodes.length) {
            const err = new Error(
                `assertOnsiteEvidenceSufficient: ${criticalCodes.length - criticalUpheld} of ${criticalCodes.length} critical checklist items are recorded FAIL on audit ${auditId} — refused (fail-closed). A certificate cannot rest on an inspection that found the farm non-compliant.`,
            );
            err.code = 'CRITICAL_CHECKLIST_FAILURE';
            throw err;
        }
    }

    return { auditId, photoCount, itemCount };
}

/**
 * The inspector's PASS, asked the same question certificate issuance will ask later.
 *
 * Until 2026-10-05 the gate only ran when the APPROVER pressed อนุมัติ (it is inside
 * generateCertificate). A PASS written from the job sheet, the audit-result door or the
 * workflow door therefore always succeeded — the file reached the decision queue, and the
 * approver was the first person told the evidence was never there ("Failed to finalize
 * approval"). Every door that writes AUDIT_PASSED now calls this BEFORE the write, with
 * the SAME arguments generateCertificate will use (the pinned audit, when there is one),
 * so what the inspector is allowed to pass is exactly what the approver can later issue.
 *
 * @param {object} args
 * @param {object} args.prisma       client or transaction handle the write will use
 * @param {object} args.application  must carry `id`; `formData.onsiteAuditId` is the pin
 */
async function assertOnsiteEvidenceForPass({ prisma, application } = {}) {
    return assertOnsiteEvidenceSufficient({
        prisma,
        applicationId: application?.id,
        auditId: application?.formData?.onsiteAuditId,
    });
}

module.exports = { assertOnsiteEvidenceSufficient, assertOnsiteEvidenceForPass };
