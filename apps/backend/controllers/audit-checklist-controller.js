const { prisma } = require('../services/prisma-database');
const attachmentService = require('../services/attachment-service');
const logger = require('../shared/logger');
const { resolveCurrentOnsiteAuditId } = require('../services/onsite-audit-resolver');
const { armOnsiteEvidence } = require('../services/audit/arm-onsite-evidence');
const { ERROR_CODES } = require('../shared/error-codes');

/**
 * Audit Checklist Controller
 * CRUD for audit checklists with GACP criteria templates.
 * Used by: Auditor
 */

/**
 * Wave A Phase 38 — extract file pointers embedded in checklist
 * `sections[*].items[*].evidence`. Permissive about shape: null skips,
 * a single object becomes one entry, an array becomes N entries. Each
 * entry must have at least `fileUrl`. Other metadata is optional.
 *
 * Returns a flat list of { sectionIdx, itemIdx, fileIdx, fileName,
 * fileUrl, fileSize, mimeType, fileHash } so the dual-write can use a
 * stable per-position field key. The shape contract is best-effort
 * because the table is empty in prod (Wave A Phase 18 verified) and
 * the frontend evidence shape is still evolving.
 */
function extractEvidenceFiles(sections) {
    const out = [];
    if (!Array.isArray(sections)) {
        return out;
    }
    sections.forEach((section, sectionIdx) => {
        const items = Array.isArray(section?.items) ? section.items : [];
        items.forEach((item, itemIdx) => {
            const ev = item?.evidence;
            if (ev === null || ev === undefined) {
                return;
            }
            const candidates = Array.isArray(ev) ? ev : [ev];
            candidates.forEach((entry, fileIdx) => {
                if (!entry || typeof entry !== 'object') {
                    return;
                }
                const fileUrl = entry.fileUrl || entry.url || null;
                if (!fileUrl) {
                    return;
                }
                out.push({
                    sectionIdx,
                    itemIdx,
                    fileIdx,
                    fileName: entry.fileName || entry.name || 'evidence',
                    fileUrl,
                    fileSize: Number(entry.fileSize || entry.size || 0) || 0,
                    mimeType: entry.mimeType || null,
                    fileHash: entry.fileHash || entry.checksum || null,
                });
            });
        });
    });
    return out;
}

// Default GACP Checklist template sections
const GACP_GENERAL_TEMPLATE = {
    templateName: 'GACP_GENERAL',
    sections: [
        {
            sectionName: '1. สถานที่ผลิตและสิ่งแวดล้อม',
            items: [
                { criteria: 'พื้นที่ปลูกอยู่ห่างจากแหล่งมลพิษ', result: null, evidence: null, notes: '' },
                { criteria: 'มีการจัดการสิ่งแวดล้อมที่เหมาะสม', result: null, evidence: null, notes: '' },
                { criteria: 'มีระบบจัดการน้ำทิ้งและของเสีย', result: null, evidence: null, notes: '' },
            ],
        },
        {
            sectionName: '2. การเพาะปลูกและการดูแลรักษา',
            items: [
                { criteria: 'ใช้พันธุ์พืชที่มีเอกสารรับรอง', result: null, evidence: null, notes: '' },
                { criteria: 'มีการบันทึกการใส่ปุ๋ยและสารเคมี', result: null, evidence: null, notes: '' },
                { criteria: 'มีระบบควบคุมศัตรูพืชที่เหมาะสม', result: null, evidence: null, notes: '' },
                { criteria: 'มีการจัดการน้ำอย่างเพียงพอและปลอดภัย', result: null, evidence: null, notes: '' },
            ],
        },
        {
            sectionName: '3. การเก็บเกี่ยวและแปรรูป',
            items: [
                { criteria: 'มีกระบวนการเก็บเกี่ยวที่ถูกสุขอนามัย', result: null, evidence: null, notes: '' },
                { criteria: 'มีสถานที่ตากแห้งที่สะอาด', result: null, evidence: null, notes: '' },
                { criteria: 'มีการควบคุมอุณหภูมิและความชื้นในการตาก', result: null, evidence: null, notes: '' },
            ],
        },
        {
            sectionName: '4. การจัดเก็บและขนส่ง',
            items: [
                { criteria: 'สถานที่จัดเก็บสะอาดและแห้ง', result: null, evidence: null, notes: '' },
                { criteria: 'มีระบบป้องกันสัตว์และแมลง', result: null, evidence: null, notes: '' },
                { criteria: 'บรรจุภัณฑ์เป็น food-grade', result: null, evidence: null, notes: '' },
            ],
        },
        {
            sectionName: '5. บุคลากรและสุขอนามัย',
            items: [
                { criteria: 'บุคลากรผ่านการอบรม GACP', result: null, evidence: null, notes: '' },
                { criteria: 'มีการตรวจสุขภาพประจำปี', result: null, evidence: null, notes: '' },
                { criteria: 'มีอุปกรณ์ป้องกันส่วนบุคคล', result: null, evidence: null, notes: '' },
            ],
        },
        {
            sectionName: '6. เอกสารและการบันทึก',
            items: [
                { criteria: 'มี SOP ครบถ้วน', result: null, evidence: null, notes: '' },
                { criteria: 'มีบันทึกการผลิตย้อนกลับได้', result: null, evidence: null, notes: '' },
                { criteria: 'มีระบบ Traceability', result: null, evidence: null, notes: '' },
            ],
        },
    ],
};

function countTotalItems(sections) {
    return sections.reduce((sum, section) => sum + (section.items?.length || 0), 0);
}

/**
 * The inspection mode the scheduler actually booked, read off the application.
 *
 * Deliberately returns null when nothing was booked. `resolveAuditSchedule` in
 * routes/api/provider/handlers/queue-utils.js ends the same chain with `|| 'ONSITE'`,
 * which is right for a queue card that has to render something and wrong here: this value
 * decides whether an audit row may exist at all, and an audit row is what a certificate's
 * evidence hangs off. Defaulting an unbooked application to ONSITE would hand a certificate
 * to a farm nobody has even been scheduled to visit. That helper is not imported for the
 * same reason it is not copied wholesale: it lives behind the provider route handlers and
 * pulls the auth middleware in with it, which a controller has no business loading.
 *
 * Nothing here decides whether a mode may produce evidence — this only reports what was
 * booked. armOnsiteEvidence makes the decision, and it recognises exactly one certifiable
 * value, so every unreadable or unexpected shape lands on the refusing side by itself.
 */
function resolveBookedInspectionMode(formData) {
    const fd = (formData && typeof formData === 'object') ? formData : {};
    const schedule = (fd.auditSchedule && typeof fd.auditSchedule === 'object') ? fd.auditSchedule : {};
    const booked = schedule.inspectionMode
        || schedule.auditMode
        || fd.inspectionMode
        || fd.auditMode
        // Legacy rows predate the explicit field; the link that was stored still says
        // which kind of visit it was.
        || (schedule.meetingLink ? 'ONLINE_MEET' : null)
        || (schedule.mapLink || schedule.location ? 'ONSITE' : null);
    const normalized = String(booked || '').trim().toUpperCase();
    return normalized || null;
}

// Wave A Phase 18 — auditorName used to be a denormalized column. After
// the schema cleanup it's computed from the relation each time so admin
// renames propagate without a backfill. We keep the field name in the API
// response for frontend back-compat (HEALTH /certificates view reads
// `cert.audit.auditorName` and provider /coordinator + /calendar views
// read `event.auditorName`).
function withAuditorName(checklist) {
    if (!checklist) {
        return checklist;
    }
    const { auditor, ...rest } = checklist;
    const auditorName = auditor
        ? [auditor.firstName, auditor.lastName].filter(Boolean).join(' ') || null
        : null;
    return { ...rest, auditorName };
}

const AUDITOR_RELATION_SELECT = {
    auditor: { select: { firstName: true, lastName: true } },
};

const auditChecklistController = {
    /**
     * GET /api/provider/checklists/templates
     * List available checklist templates
     */
    listTemplates: async (_req, res) => {
        try {
            const templates = [
                { name: 'GACP_GENERAL', label: 'GACP ทั่วไป', sections: GACP_GENERAL_TEMPLATE.sections.length, totalItems: countTotalItems(GACP_GENERAL_TEMPLATE.sections) },
            ];
            return res.json({ success: true, data: templates });
        } catch (error) {
            logger.error('[Checklist Templates] Error:', error);
            return res.status(500).json({ success: false, error: 'Failed to list templates' });
        }
    },

    /**
     * POST /api/provider/applications/:applicationId/checklist
     * Create a checklist for an application based on template
     */
    create: async (req, res) => {
        try {
            const { applicationId } = req.params;
            const userId = req.user?.id || req.user?.providerId;
            const { templateName } = req.body;

            // Verify application. organizationId + auditorId + formData are selected
            // here (cheap — same row) so the arming branch below never needs a second
            // round-trip for any of them.
            const app = await prisma.application.findUnique({
                where: { id: applicationId },
                select: { id: true, organizationId: true, auditorId: true, formData: true },
            });
            if (!app) {
                return res.status(404).json({ success: false, error: 'Application not found' });
            }

            // cert-integrity follow-up (onsite evidence-capture fix, Task 13,
            // 2026-08-17) — this endpoint is FE-dead but still live-mounted and
            // API-reachable (requireApplicationOwner: reviewer/auditor/admin).
            // Task 1 already creates the canonical AuditChecklist idempotently
            // at auditor-assignment (audit-scheduling-service.js assignAuditor).
            // Without a guard here, a second POST created a DUPLICATE
            // AuditChecklist row for the same application — the cert gate and
            // resolveCurrentOnsiteAuditId both read IN_PROGRESS-first /
            // most-recent, so a duplicate could SHADOW the real audit and
            // defeat the whole fix. Resolve against the SAME shared resolver
            // the gate uses (never a local query) so this creator can't diverge
            // from what the gate will see. Found => return it as-is, same
            // response shape a legitimate create returns, just 200 not 201.
            const existingId = await resolveCurrentOnsiteAuditId(prisma, applicationId);
            if (existingId) {
                const existing = await prisma.auditChecklist.findUnique({
                    where: { id: existingId },
                    include: AUDITOR_RELATION_SELECT,
                });
                return res.status(200).json({ success: true, data: withAuditorName(existing) });
            }

            // THIRD-CREATOR FIX (2026-08-26). Until now this branch ran its own
            // prisma.auditChecklist.create, which made it a creator that knew nothing
            // about inspectionMode. An ONLINE_MEET audit is scheduled, the assigned
            // auditor POSTs here, and an AuditChecklist row appears; photographs and
            // checklist items then attach to it legitimately (they really are this
            // application's, so the application-binding check passes) and the
            // certificate mints for a farm nobody visited. armOnsiteEvidence is the one
            // place that decides whether a mode may produce onsite evidence at all, so
            // this door asks it rather than deciding for itself.
            //
            // The resolver check above still runs FIRST and is not redundant: it looks
            // at rows of ANY status, armOnsiteEvidence only at IN_PROGRESS ones. Arming
            // straight away would mint a fresh IN_PROGRESS row beside a SUBMITTED audit
            // and shadow it — the exact duplicate this endpoint was guarded against in
            // 2026-08-17.
            const inspectionMode = resolveBookedInspectionMode(app.formData);
            const template = GACP_GENERAL_TEMPLATE; // Extensible: lookup by templateName
            const totalItems = countTotalItems(template.sections);

            // A transaction because armOnsiteEvidence writes two tables: the audit row
            // and Application.formData.onsiteAuditId, the pin issuance verifies against.
            // A half-applied arming leaves a pin naming a row that does not exist.
            const { evidence, checklist } = await prisma.$transaction(async (tx) => {
                const armed = await armOnsiteEvidence(tx, {
                    applicationId: app.id,
                    // Prefer the auditor formally assigned to the application
                    // (Application.auditorId — written by assignAuditor via
                    // writeApplicationStatus's additionalData spread) over the
                    // caller, who may be a reviewer/admin hitting this dead
                    // endpoint directly rather than the auditor themselves.
                    // Falls back to the caller only when no auditor is assigned
                    // yet (AuditChecklist.auditorId is a required column).
                    auditorId: app.auditorId || userId,
                    // Tenancy (ADR-014): set explicitly from the APPLICATION's
                    // own org rather than relying solely on
                    // tenantInjectExtension, which would inject the CALLER's
                    // tenant context — wrong here, since a reviewer/auditor/
                    // admin calling this route is not necessarily in the same
                    // org as the provider who owns the application.
                    organizationId: app.organizationId,
                    createdBy: userId,
                    inspectionMode,
                    templateName: templateName || template.templateName,
                });
                if (!armed.canLeadToCertificate) {
                    return { evidence: armed, checklist: null };
                }

                // armOnsiteEvidence arms with `sections: []` because the scheduling
                // doors have no template to seed. This endpoint's whole remaining
                // value is that it hands the auditor a populated GACP form, so seed
                // it here — an update, not a second create. Guarded on emptiness so
                // a re-POST can never overwrite an auditor's answers.
                const row = await tx.auditChecklist.findUnique({
                    where: { id: armed.auditChecklistId },
                    include: AUDITOR_RELATION_SELECT,
                });
                if (Array.isArray(row?.sections) && row.sections.length === 0) {
                    const seeded = await tx.auditChecklist.update({
                        where: { id: armed.auditChecklistId },
                        data: { sections: template.sections, totalItems, completedItems: 0 },
                        include: AUDITOR_RELATION_SELECT,
                    });
                    return { evidence: armed, checklist: seeded };
                }
                return { evidence: armed, checklist: row };
            });

            if (!evidence.canLeadToCertificate) {
                const catalogued = ERROR_CODES.AUDIT_NOT_ONSITE;
                return res.status(catalogued.httpStatus).json({
                    success: false,
                    code: catalogued.code,
                    error: catalogued.messageTh,
                    // The armer's own wording, kept as a separate field: it names the
                    // mode it refused, which the operator needs and the catalogued
                    // sentence deliberately does not carry.
                    reason: evidence.reason,
                });
            }

            return res.status(201).json({ success: true, data: withAuditorName(checklist) });
        } catch (error) {
            logger.error('[Checklist Create] Error:', error);
            return res.status(500).json({ success: false, error: 'Failed to create checklist' });
        }
    },

    /**
     * GET /api/provider/applications/:applicationId/checklist
     * Get checklist for an application
     */
    getByApplication: async (req, res) => {
        try {
            const { applicationId } = req.params;
            const checklist = await prisma.auditChecklist.findFirst({
                where: { applicationId },
                orderBy: { createdAt: 'desc' },
                include: AUDITOR_RELATION_SELECT,
            });
            if (!checklist) {
                return res.status(404).json({ success: false, error: 'Checklist not found' });
            }
            return res.json({ success: true, data: withAuditorName(checklist) });
        } catch (error) {
            logger.error('[Checklist Get] Error:', error);
            return res.status(500).json({ success: false, error: 'Failed to fetch checklist' });
        }
    },

    /**
     * PATCH /api/provider/checklists/:id
     * Update checklist items (save progress)
     */
    update: async (req, res) => {
        try {
            const { id } = req.params;
            const userId = req.user?.id || req.user?.providerId;
            const { sections, status } = req.body;

            const existing = await prisma.auditChecklist.findUnique({ where: { id } });
            if (!existing) {
                return res.status(404).json({ success: false, error: 'Checklist not found' });
            }

            const updateData = { updatedBy: userId };

            if (sections !== undefined) {
                updateData.sections = sections;
                // Auto-count completed items
                let completed = 0;
                let total = 0;
                for (const section of sections) {
                    for (const item of (section.items || [])) {
                        total += 1;
                        if (item.result !== null && item.result !== undefined) {
                            completed += 1;
                        }
                    }
                }
                updateData.completedItems = completed;
                updateData.totalItems = total;
                updateData.score = total > 0 ? Math.round((completed / total) * 100) : 0;
            }

            if (status !== undefined) {
                updateData.status = status;
                if (status === 'SUBMITTED') {
                    updateData.submittedAt = new Date();
                }
            }

            const checklist = await prisma.auditChecklist.update({
                where: { id },
                data: updateData,
                include: AUDITOR_RELATION_SELECT,
            });

            // Wave A Phase 38 (G1 consumer #6) — sync evidence files into
            // the polymorphic Attachment table. The PATCH replaces the
            // entire `sections` JSON, so the simplest correct sync is to
            // detach every existing Attachment for this checklist and
            // attach the current set. Best-effort.
            //
            // The audit_checklists table is empty in production today
            // (verified Wave A Phase 18) so the migration carries no
            // risk to existing data — it sets up the canonical record
            // for any future evidence uploads.
            if (sections !== undefined) {
                try {
                    const oldAtts = await attachmentService.listForResource({
                        prisma,
                        resModel: 'AuditChecklist',
                        resId: checklist.id,
                    });
                    for (const att of oldAtts) {
                        await attachmentService.detach({
                            prisma,
                            attachmentId: att.id,
                            deletedBy: userId,
                            reason: 'Replaced via PATCH /api/provider/checklists/:id',
                        });
                    }
                    const files = extractEvidenceFiles(sections);
                    for (const f of files) {
                        await attachmentService.attach({
                            prisma,
                            resModel: 'AuditChecklist',
                            resId: checklist.id,
                            // Slot key encodes evidence position so reads
                            // can map an Attachment row back to a specific
                            // checklist item.
                            field: `sections.${f.sectionIdx}.items.${f.itemIdx}.evidence.${f.fileIdx}`,
                            fileName: f.fileName,
                            fileUrl: f.fileUrl,
                            fileSize: f.fileSize,
                            mimeType: f.mimeType,
                            fileHash: f.fileHash,
                            uploadedBy: userId,
                            organizationId: checklist.organizationId,
                        });
                    }
                } catch (attErr) {
                    logger.warn(`[Checklist Update] dual-write Attachment failed (non-fatal): ${attErr?.message || attErr}`);
                }
            }

            return res.json({ success: true, data: withAuditorName(checklist) });
        } catch (error) {
            logger.error('[Checklist Update] Error:', error);
            return res.status(500).json({ success: false, error: 'Failed to update checklist' });
        }
    },
};

module.exports = auditChecklistController;
