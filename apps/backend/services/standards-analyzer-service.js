'use strict';

/**
 * Standards Analyzer Service — สัญญา C05F680149 ต้นแบบที่ 1
 * "ระบบวิเคราะห์มาตรฐาน GACP (3 ระบบ)": WHO (1.1) · Thai FDA (1.2) · ASEAN (1.3)
 *
 * Gap-analysis engine over the seeded CertificationStandard/StandardRequirement
 * tables (prisma/seed-standards.js): each requirement is evaluated against the
 * application's real signals and returns MET / NOT_MET / NEEDS_REVIEW with Thai
 * evidence + recommendation. Deterministic precedence per requirement:
 *
 *   1. platform capability            → MET
 *   2. primary document slot present  → MET
 *   3. certifiedStates && workflow ∈ {AUDIT_PASSED, APPROVED, CERTIFIED} → MET
 *   4. secondary doc / formData path  → NEEDS_REVIEW
 *   5. mapped but zero evidence       → NOT_MET (+ recommendation)
 *   6. no mapping                     → NEEDS_REVIEW (expert/onsite assessment)
 *
 * The engine never invents compliance: an unmapped requirement is a manual
 * check, not a pass. Errors carry .statusCode/.code at the throw site so every
 * route error path maps correctly (bug-hunt 7.4 lesson).
 */

const { prisma } = require('./prisma-database');
const logger = require('../shared/logger');
const { normalizeRole, CANONICAL_ROLES } = require('../shared/canonical-rbac');
const { SIGNAL_MAP } = require('../data/standards/standards-signal-map');
const { ASEAN_COMPARISON } = require('../data/standards/asean-gacp-comparison');
const { getCanonicalSlotId } = require('../routes/api/applications/validation-slot-utils');

const STATUS = Object.freeze({
    MET: 'MET',
    NOT_MET: 'NOT_MET',
    NEEDS_REVIEW: 'NEEDS_REVIEW',
});

/**
 * One slot id, written the one way, on BOTH sides of the document comparison.
 *
 * `application_documents.documentType` is the upper-cased canonical slot id AS OF
 * THE DAY THE ROW WAS WRITTEN (application-document-sync.js:48-52), and the signal
 * map below is a hand-written list of slot names. When the กทล.1 v2 fold renamed
 * six slots, the two drifted apart in silence: an upload of the title deed started
 * arriving as LAND_RIGHTS while the map still said LAND_DEED, so the requirement
 * it was evidence for fell to NOT_MET for the applicant who attached it, and rows
 * written before the rename kept matching. Folding both sides means the map may
 * name a slot by any of its spellings, past or present, and a future rename cannot
 * quietly unhook a signal.
 */
function canonicalDocumentType(value) {
    return getCanonicalSlotId(value).toUpperCase();
}

/**
 * Canonical ids that more than one DIFFERENT paper of this map now shares.
 *
 * Derived from SIGNAL_MAP itself rather than hand-listed, so the next fold that merges two
 * mapped papers is handled without anyone remembering this file exists. Today the set holds
 * exactly SOP_MANUAL: the platform used to ask for an SOP per activity (cultivation, harvest,
 * storage, pest, processing) and now asks for ONE manual, so a row saying SOP_MANUAL cannot
 * tell you which of the five topics it covers.
 */
const MERGED_SIGNAL_CANONS = (() => {
    const namesByCanon = new Map();
    Object.values(SIGNAL_MAP).forEach((mapping) => {
        [...(mapping.docs || []), ...(mapping.docsSecondary || [])].forEach((slot) => {
            const canonical = canonicalDocumentType(slot);
            if (!canonical) { return; }
            const names = namesByCanon.get(canonical) || new Set();
            names.add(String(slot).toUpperCase());
            namesByCanon.set(canonical, names);
        });
    });
    const merged = new Set();
    namesByCanon.forEach((names, canonical) => {
        if (names.size > 1) { merged.add(canonical); }
    });
    return merged;
})();

/**
 * The application's documents, keyed by canonical slot, holding what the rows REALLY say.
 *
 * documentType is the canonical slot id as of the day the row was written, so an application
 * open since before the กทล.1 v2 fold and one opened today can hold two different strings for
 * one paper. Indexing by canon lets a renamed slot still be found; keeping the raw string is
 * what lets the evidence line name the document that is actually attached.
 */
function indexDocuments(documentTypes) {
    const index = new Map();
    (documentTypes || []).forEach((raw) => {
        const named = String(raw || '').toUpperCase();
        if (!named) { return; }
        const canonical = canonicalDocumentType(named);
        const rows = index.get(canonical) || new Set();
        rows.add(named);
        index.set(canonical, rows);
    });
    return index;
}

/**
 * How strongly the uploaded documents answer one slot the map names.
 *
 *   'exact'  — a row carries this slot id, or the id this slot was RENAMED to. Same paper,
 *              full strength: a rename must not cost an applicant the evidence they filed.
 *   'merged' — a row matches only because several distinct papers now share one slot id.
 *              That is "the combined manual is on file", not "this topic is covered", so it
 *              may support NEEDS_REVIEW and may never on its own report MET. The fold says
 *              the same thing in its own words: whether the one file covers every activity
 *              is a question for the officer's per-slot review, not for a fold.
 *   null     — nothing uploaded answers it.
 */
function matchSlot(slot, index) {
    const named = String(slot || '').toUpperCase();
    if (!named) { return null; }
    const canonical = canonicalDocumentType(named);
    const rows = index.get(canonical);
    if (!rows || rows.size === 0) { return null; }
    const strength = rows.has(named) || !MERGED_SIGNAL_CANONS.has(canonical) ? 'exact' : 'merged';
    return { slot, uploaded: [...rows], strength };
}

/** Name the documents that are really in the application, each one once. */
function describeHits(hits) {
    return [...new Set(hits.flatMap((hit) => hit.uploaded))].join(', ');
}

// Workflow states that mean the onsite auditor has already verified the farm
// (single-auditor PASS auto-issues the certificate — owner canon #298).
const ONSITE_VERIFIED_STATES = new Set(['AUDIT_PASSED', 'APPROVED', 'CERTIFIED']);

function httpError(statusCode, code, message) {
    const err = new Error(message);
    err.statusCode = statusCode;
    err.code = code;
    return err;
}

/**
 * Resolve a dot path against canonical formData. `plots[].x` means "any array
 * element at `plots` has truthy x". Returns the first truthy hit or undefined.
 */
function getFormSignal(formData, path) {
    if (!formData || typeof formData !== 'object') { return undefined; }
    const arrayMatch = path.match(/^([^[]+)\[\]\.(.+)$/);
    if (arrayMatch) {
        const list = formData[arrayMatch[1]];
        if (!Array.isArray(list)) { return undefined; }
        for (const item of list) {
            const hit = getFormSignal(item, arrayMatch[2]);
            if (hit !== undefined) { return hit; }
        }
        return undefined;
    }
    let node = formData;
    for (const segment of path.split('.')) {
        if (node === null || node === undefined || typeof node !== 'object') { return undefined; }
        node = node[segment];
    }
    if (node === undefined || node === null) { return undefined; }
    if (typeof node === 'string' && node.trim() === '') { return undefined; }
    return node;
}

/**
 * Evaluate one StandardRequirement against the application's signals.
 * Pure function — exported for unit tests.
 */
function evaluateRequirement(requirement, standardCode, context) {
    const { documentTypes, formData, status } = context;
    const mapping = SIGNAL_MAP[`${standardCode}:${requirement.name}`];

    const base = {
        id: requirement.id,
        category: requirement.category,
        name: requirement.name,
        nameTH: requirement.nameTH,
        description: requirement.description || null,
        isRequired: requirement.isRequired !== false,
    };

    if (!mapping) {
        return {
            ...base,
            status: STATUS.NEEDS_REVIEW,
            evidence: 'ยังไม่มีสัญญาณอัตโนมัติสำหรับข้อกำหนดนี้ ต้องประเมินโดยผู้เชี่ยวชาญ/ผู้ตรวจ ณ แปลง',
            recommendation: 'เตรียมหลักฐานประกอบสำหรับการประเมินโดยผู้เชี่ยวชาญ',
        };
    }

    if (mapping.platform) {
        return {
            ...base,
            status: STATUS.MET,
            evidence: mapping.platform.evidence,
            recommendation: null,
        };
    }

    const documentIndex = indexDocuments(documentTypes);
    const primaryMatches = (mapping.docs || [])
        .map(slot => matchSlot(slot, documentIndex))
        .filter(Boolean);
    const primaryHits = primaryMatches.filter(hit => hit.strength === 'exact');
    if (primaryHits.length > 0) {
        return {
            ...base,
            status: STATUS.MET,
            evidence: `พบเอกสารหลักฐานหลักในคำขอ: ${describeHits(primaryHits)}`,
            recommendation: null,
        };
    }

    if (mapping.certifiedStates && ONSITE_VERIFIED_STATES.has(status)) {
        return {
            ...base,
            status: STATUS.MET,
            evidence: `ผ่านการตรวจประเมิน ณ แปลงแล้ว (สถานะคำขอ: ${status}) checklist ผู้ตรวจครอบข้อกำหนดหมวดนี้`,
            recommendation: null,
        };
    }

    // A primary slot matched only through a merged id is not proof of THIS paper; it is
    // "the operation's combined manual is on file", which is exactly secondary evidence.
    const secondaryHits = [
        ...(mapping.docsSecondary || []).map(slot => matchSlot(slot, documentIndex)).filter(Boolean),
        ...primaryMatches.filter(hit => hit.strength === 'merged'),
    ];
    const formHits = (mapping.form || [])
        .map(path => ({ path, value: getFormSignal(formData, path) }))
        .filter(hit => hit.value !== undefined);

    if (secondaryHits.length > 0 || formHits.length > 0) {
        const parts = [];
        if (secondaryHits.length > 0) { parts.push(`เอกสารรอง: ${describeHits(secondaryHits)}`); }
        if (formHits.length > 0) { parts.push(`ข้อมูลในคำขอ: ${formHits.map(h => h.path).join(', ')}`); }
        return {
            ...base,
            status: STATUS.NEEDS_REVIEW,
            evidence: `พบหลักฐานบางส่วน (${parts.join(' · ')}) ยังต้องยืนยันหลักฐานหลัก`,
            recommendation: mapping.recommendation || null,
        };
    }

    if (mapping.certifiedStates) {
        return {
            ...base,
            status: STATUS.NEEDS_REVIEW,
            evidence: 'ข้อกำหนดนี้ยืนยันโดยการตรวจประเมิน ณ แปลง คำขอยังไม่ถึงขั้นตอนตรวจประเมิน',
            recommendation: mapping.recommendation || null,
        };
    }

    return {
        ...base,
        status: STATUS.NOT_MET,
        evidence: 'ยังไม่พบหลักฐานสำหรับข้อกำหนดนี้ในคำขอ',
        recommendation: mapping.recommendation || null,
    };
}

/**
 * Analyze one application against one certification standard.
 *
 * @param {string} applicationId
 * @param {string} standardCode  'WHO' | 'THAI_GACP' | 'ASEAN' | 'FDA'
 * @param {{actor: {role?: string, canonicalRole?: string, canonicalId?: string}}} options
 *        actor.role/canonicalRole = canonical role; HEALTH actors may only
 *        analyze applications they own (Application.healthId is the detokenized
 *        canonicalId TOKEN — compare against req.user.canonicalId, never a raw
 *        national id). Non-owner HEALTH → 404 (anti-probe, matches canSeeSlip).
 */
async function analyzeApplication(applicationId, standardCode, { actor, holderScope = null } = {}) {
    const normalizedCode = String(standardCode || '').trim().toUpperCase();

    const standard = await prisma.certificationStandard.findUnique({
        where: { code: normalizedCode },
        include: { requirements: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!standard || standard.isActive === false) {
        throw httpError(404, 'STANDARD_NOT_FOUND', `Unknown certification standard: ${normalizedCode}`);
    }

    const application = await prisma.application.findFirst({
        where: {
            id: applicationId,
            isDeleted: false,
            // R1-legacy-pin: removed in Task 12 — a health caller passes its holder scope;
            // the id decides the row and the healthId compare below decides ownership.
            ...require('./holder-access').r1HolderOrLegacyWhenScoped(holderScope, 'Application', { id: applicationId }),
        },
        include: { documents: true },
    });
    if (!application) {
        throw httpError(404, 'APPLICATION_NOT_FOUND', 'Application not found');
    }

    // normalizeRole so the compare works whether the caller passes a raw role
    // ('HEALTH') or the canonical value ('health'). The route passes
    // normalizeRole(...) output (lowercase) — comparing against the literal
    // 'HEALTH' made this ownership gate dead in production (PR-666 review).
    const actorRole = normalizeRole(actor?.canonicalRole || actor?.role);
    if (actorRole === CANONICAL_ROLES.HEALTH && application.healthId !== actor?.canonicalId) {
        // Same 404 as not-found: a HEALTH user must not learn that someone
        // else's application id exists.
        throw httpError(404, 'APPLICATION_NOT_FOUND', 'Application not found');
    }

    const context = {
        // Raw, as stored. indexDocuments() does the folding, in one place, so the
        // evidence line can still name the string the row actually carries.
        documentTypes: new Set(
            (application.documents || [])
                .map(doc => String(doc.documentType || '').toUpperCase())
                .filter(Boolean),
        ),
        formData: application.formData || {},
        status: application.status,
    };

    const requirements = (standard.requirements || []).map(
        requirement => evaluateRequirement(requirement, normalizedCode, context),
    );

    const met = requirements.filter(r => r.status === STATUS.MET).length;
    const notMet = requirements.filter(r => r.status === STATUS.NOT_MET).length;
    const needsReview = requirements.filter(r => r.status === STATUS.NEEDS_REVIEW).length;
    const required = requirements.filter(r => r.isRequired);

    logger.info(
        `[StandardsAnalyzer] ${normalizedCode} × ${applicationId}: ` +
        `${met} MET / ${notMet} NOT_MET / ${needsReview} NEEDS_REVIEW`,
    );

    return {
        standard: {
            code: standard.code,
            name: standard.name,
            nameTH: standard.nameTH,
            version: standard.version,
            targetMarket: standard.targetMarket || null,
        },
        application: {
            id: application.id,
            applicationNumber: application.applicationNumber || null,
            status: application.status,
        },
        requirements,
        summary: {
            total: requirements.length,
            met,
            notMet,
            needsReview,
            requiredTotal: required.length,
            requiredMet: required.filter(r => r.status === STATUS.MET).length,
            readinessPct: requirements.length === 0
                ? 0
                : Math.round((met / requirements.length) * 100),
        },
        analyzedAt: new Date().toISOString(),
    };
}

/**
 * ต้นแบบ 1.3 — ตารางเปรียบเทียบมาตรฐาน 10 ประเทศอาเซียน (reference content;
 * static, no PII — SSRU research team reviews content before the final report).
 */
function getAseanComparison() {
    return ASEAN_COMPARISON;
}

module.exports = {
    analyzeApplication,
    evaluateRequirement,
    getAseanComparison,
    STATUS,
};
