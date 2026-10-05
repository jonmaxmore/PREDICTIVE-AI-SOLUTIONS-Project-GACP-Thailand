'use strict';

/**
 * The file a certificate approver reads before deciding — READ ONLY.
 *
 * Until now the approver decided on a row: number, name, status, date. The evidence the
 * decision rests on (the filing, the onsite checklist answers, the photographs and where
 * and when they were taken, the inspector's own words, the correction history) sat behind
 * doors the approver is deliberately not given — the inspector's job sheet and the onsite
 * API, whose WRITE routes must stay closed to this role (ISO/IEC 17065 §7.6: the decider
 * is not the evaluator). So the decision was made blind, and the first sign that the
 * evidence was missing was an English 500 at the moment of pressing อนุมัติ.
 *
 * This assembles exactly what the decision needs, and nothing that writes, from the same
 * services the inspector's screens use — it re-derives nothing:
 *   - documents       the requirement engine's slots joined with the officer's verdicts
 *   - onsite.checklist  the canonical template joined with the recorded answers
 *   - onsite.photos   reviewPhotoProvenance (hash, GPS, capture time, near-duplicate flags)
 *   - onsite.gps      the check-in position measured against the farm
 *   - onsite.evidenceGate  the SAME gate generateCertificate will ask, answered now
 *   - inspectorSummary / carHistory   what was written, and every round of correction
 *
 * The caller proves the file is in the decision queue (status AUDIT_PASSED) and that the
 * caller is a certificate approver; this module trusts neither and writes nothing.
 */

const { resolveApplicationRequirements } = require('./application-requirements-service');
const onsite = require('./audit-onsite-service');
const { resolveCurrentOnsiteAuditId } = require('./onsite-audit-resolver');
const { assertOnsiteEvidenceForPass } = require('./onsite-evidence-gate');
const { onsiteEvidenceRefusal } = require('./audit-decision-error-response');

const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const arr = (v) => (Array.isArray(v) ? v : []);

function composeName(person) {
    const name = `${String(person?.firstName || '')} ${String(person?.lastName || '')}`.trim();
    return name || null;
}

/** Latest-round verdict per slot, from every review row of the application. */
function latestVerdictBySlot(reviews) {
    const bySlot = new Map();
    for (const r of arr(reviews)) {
        const held = bySlot.get(r.slotId);
        if (!held || Number(r.round) >= Number(held.round)) { bySlot.set(r.slotId, r); }
    }
    return bySlot;
}

async function loadDocuments({ prisma, application }) {
    const rows = await prisma.applicationDocument.findMany({
        where: { applicationId: application.id },
        select: {
            documentType: true, fileUrl: true, fileName: true,
            createdAt: true, currentForSlot: true, supersededAt: true,
        },
    });
    const requirements = await resolveApplicationRequirements(application, rows);
    const reviews = await prisma.applicationDocumentReview.findMany({
        where: { applicationId: application.id },
        orderBy: { createdAt: 'asc' },
    });
    const verdicts = latestVerdictBySlot(reviews);
    return arr(requirements?.slots).map((slot) => {
        const review = verdicts.get(slot.slotId) || null;
        return {
            slotId: slot.slotId,
            labelTH: slot.labelTH || slot.slotId,
            required: Boolean(slot.required),
            satisfied: Boolean(slot.satisfied),
            fileUrl: slot.fileUrl || null,
            fileName: slot.fileName || null,
            verdict: review ? review.verdict : null,
            reviewReason: review ? review.reason || null : null,
        };
    });
}

/** The audit this file's evidence rests on: the pin the decision stamped, else the current one. */
async function resolveAuditId({ prisma, application }) {
    const pin = obj(application.formData).onsiteAuditId;
    if (pin) {
        const live = await prisma.auditChecklist.findFirst({
            where: { id: pin, isDeleted: false, applicationId: application.id },
            select: { id: true },
        });
        if (live) { return live.id; }
    }
    return resolveCurrentOnsiteAuditId(prisma, application.id);
}

async function loadChecklist({ prisma, auditId }) {
    const answers = await prisma.farmAuditChecklistItem.findMany({
        where: { auditId },
        orderBy: { recordedAt: 'asc' },
    });
    const byCode = new Map(arr(answers).map((a) => [a.itemCode, a]));
    return onsite.CHECKLIST_TEMPLATE_2026.map((item) => {
        const a = byCode.get(item.itemCode) || null;
        return {
            itemCode: item.itemCode,
            section: item.section,
            prompt: item.prompt,
            isCritical: item.isCritical === true,
            response: a ? a.response : null,
            notes: a ? a.notes || null : null,
        };
    });
}

async function loadPhotos({ prisma, auditId }) {
    const review = await onsite.reviewPhotoProvenance({ auditId, prisma });
    const stored = await prisma.farmAuditPhoto.findMany({
        where: { auditId },
        select: { id: true, attachmentId: true, caption: true },
    });
    const byPhoto = new Map(arr(stored).map((p) => [p.id, p]));
    const attachmentIds = arr(stored).map((p) => p.attachmentId).filter(Boolean);
    const attachments = attachmentIds.length
        ? await prisma.attachment.findMany({
            where: { id: { in: attachmentIds }, isDeleted: false },
            select: { id: true, fileUrl: true, fileName: true },
        })
        : [];
    const urlByAttachment = new Map(arr(attachments).map((a) => [a.id, a]));
    return {
        photos: review.photos.map((p) => {
            const row = byPhoto.get(p.photoId) || {};
            const att = urlByAttachment.get(row.attachmentId) || null;
            return { ...p, caption: row.caption || null, fileUrl: att ? att.fileUrl : null, fileName: att ? att.fileName : null };
        }),
        nearDuplicatePairs: review.nearDuplicatePairs,
        notRecorded: review.notRecorded,
        needsAttention: review.needsAttention,
        toleranceMeters: review.toleranceMeters,
    };
}

/** The check-in position, measured against the farm — null check-in means nobody recorded one. */
async function loadGps({ prisma, auditId }) {
    if (typeof prisma.gpsVerificationLog?.findFirst !== 'function') { return { checkIn: null }; }
    const start = await prisma.gpsVerificationLog.findFirst({
        where: { entityType: 'AUDIT_INSPECTION_START', entityId: auditId },
        orderBy: { verifiedAt: 'asc' },
    });
    if (!start) { return { checkIn: null }; }
    const verdict = await onsite.verifyGpsAgainstFarm({
        auditId, gpsLat: start.reportedLatitude, gpsLng: start.reportedLongitude, prisma,
    });
    return {
        checkIn: {
            latitude: start.reportedLatitude,
            longitude: start.reportedLongitude,
            accuracy: start.gpsAccuracy ?? null,
            at: start.verifiedAt,
        },
        ...verdict,
    };
}

/** Would generateCertificate accept this evidence? Answered now, so the approver is not the first to find out. */
async function loadEvidenceGate({ prisma, application }) {
    try {
        const out = await assertOnsiteEvidenceForPass({ prisma, application });
        return { sufficient: true, photoCount: out.photoCount, itemCount: out.itemCount };
    } catch (error) {
        const refusal = onsiteEvidenceRefusal(error);
        if (!refusal) { throw error; }
        return { sufficient: false, code: refusal.body.code, messageTh: refusal.body.messageTh };
    }
}

function buildInspectorSummary(application) {
    const formData = obj(application.formData);
    const decision = obj(formData.auditDecision);
    return {
        inspectorName: composeName(application.auditor),
        decision: decision.decision || formData.auditResult || null,
        notes: decision.notes || application.auditNotes || formData.auditNotes || null,
        reasonCode: decision.reasonCode || null,
        decidedAt: decision.decidedAt || formData.auditedAt || null,
    };
}

async function loadCarHistory({ prisma, application }) {
    const formData = obj(application.formData);
    const rounds = await prisma.correctionRound.findMany({
        where: { applicationId: application.id, stage: 'FIELD_AUDIT' },
        orderBy: { roundNo: 'asc' },
    });
    return {
        rounds: arr(rounds).map((r) => ({ roundNo: r.roundNo, decidedAt: r.decidedAt, dueAt: r.dueAt })),
        decisions: arr(formData.auditDecisions)
            .filter((d) => d && d.decision && d.decision !== 'PASS')
            .map((d) => ({
                decision: d.decision,
                notes: d.notes || null,
                reasonCode: d.reasonCode || null,
                decidedAt: d.decidedAt || null,
                findings: arr(d.findings).map((f) => ({
                    nonConformity: f.nonConformity || '',
                    correctiveAction: f.correctiveAction || '',
                    category: f.category || null,
                })),
            })),
        applicantDocuments: arr(formData.carDocuments).map((d) => ({
            name: d.originalName || d.filename || null,
            path: d.path || null,
            uploadedAt: d.uploadedAt || null,
        })),
    };
}

function buildApplicationSummary(application) {
    const formData = obj(application.formData);
    const location = obj(formData.locationData || formData.location);
    return {
        id: application.id,
        applicationNumber: application.applicationNumber,
        status: application.status,
        applicantName: composeName(application.applicant) || '-',
        submittedAt: application.createdAt,
        updatedAt: application.updatedAt,
        scheduledDate: application.scheduledDate || null,
        farmAddress: typeof location.farmAddress === 'string' ? location.farmAddress
            : (typeof location.address === 'string' ? location.address : ''),
        farmLatitude: typeof location.latitude === 'number' ? location.latitude : null,
        farmLongitude: typeof location.longitude === 'number' ? location.longitude : null,
    };
}

/**
 * @param {object} args
 * @param {object} args.prisma
 * @param {object} args.application  AUDIT_PASSED application row with `applicant`, `auditor`, `entity`
 */
async function buildDecisionFile({ prisma, application }) {
    const [documents, auditId, inspectorSummary, carHistory] = await Promise.all([
        loadDocuments({ prisma, application }),
        resolveAuditId({ prisma, application }),
        Promise.resolve(buildInspectorSummary(application)),
        loadCarHistory({ prisma, application }),
    ]);

    const evidenceGate = await loadEvidenceGate({ prisma, application });
    let onsiteBlock = {
        audit: null, checklist: [], photos: [], nearDuplicatePairs: [], notRecorded: null, needsAttention: 0,
        gps: { checkIn: null }, evidenceGate,
    };
    if (auditId) {
        const [checklist, photoBlock, gps] = await Promise.all([
            loadChecklist({ prisma, auditId }),
            loadPhotos({ prisma, auditId }),
            loadGps({ prisma, auditId }),
        ]);
        onsiteBlock = { audit: { id: auditId }, checklist, ...photoBlock, gps, evidenceGate };
    }

    return {
        application: buildApplicationSummary(application),
        documents,
        onsite: onsiteBlock,
        inspectorSummary,
        carHistory,
    };
}

module.exports = { buildDecisionFile };
