'use strict';

/**
 * PDPA ม.30 — the farmer's right to read what an auditor wrote about them.
 *
 * §5.2 of the T&T scope ruling (2026-09-05) settled the question with the operator's own
 * words, *"อ้างอิงตามกฎหมาย PDPA ได้เลย"*: ม.30 วรรคหนึ่ง gives a data subject the right to
 * access and obtain a copy of their personal data, and an auditor's checklist verdict and
 * free-text `notes` about a farm are that farmer's personal data.
 *
 * Until this file existed the right was decided and unusable — the only door reading
 * `farmAuditChecklistItem` was routes/api/audit/onsite.js behind requireRole(AUDIT_STAFF),
 * so a farmer could not reach one row about their own farm.
 *
 * TWO HALVES, and the second is why a plain read door would have been the wrong fix.
 * ม.30 วรรคสอง lets the controller refuse where the law or a court order requires it, or
 * where disclosure would affect ANOTHER person's rights and freedoms — an auditor's note
 * can name a neighbour, an employee, or a complainant. That is a judgement about one ROW,
 * so the switch lives on the row, and setting it requires a recorded reason: a refusal
 * nobody has to justify is not a lawful refusal, it is just a hidden field.
 *
 * A WITHHELD ROW IS STILL RETURNED. It says it was withheld, keeps its criterion and its
 * verdict, and drops only the free text. Dropping the whole row would leave the applicant
 * unable to tell a refusal from an absence, and a right to access that cannot be checked
 * is not one — the same reason the totals below count what was held back.
 */

const { normalizeRole, CANONICAL_ROLES } = require('../shared/canonical-rbac');

/** Long enough that "ไม่ให้" cannot pass for a justification under ม.30 วรรคสอง. */
const WITHHOLD_REASON_MIN = 10;

function refuse(code, messageTh, statusCode) {
    const err = new Error(messageTh);
    err.code = code;
    err.messageTh = messageTh;
    err.statusCode = statusCode;
    return err;
}

/**
 * What one checklist row looks like to the person it is about.
 *
 * `notes` is the only field the switch touches. The criterion, the section, the verdict
 * and whether it was critical are the FINDING, not the free text, and a farmer told
 * "criterion 1.1 failed" without being told why can at least ask — a farmer told nothing
 * cannot even do that.
 */
function toApplicantView(row) {
    const withheld = Boolean(row.disclosureWithheld);
    return {
        id: row.id,
        itemCode: row.itemCode,
        section: row.section,
        response: row.response,
        isCritical: Boolean(row.isCritical),
        recordedAt: row.recordedAt || null,
        submittedAt: (row.audit && row.audit.submittedAt) || null,
        withheld,
        // Absent rather than empty-string: a caller that prints `notes` must show nothing,
        // and a caller that branches on it must see the difference between "no note was
        // written" and "a note was written and withheld" — which `withheld` answers.
        notes: withheld ? null : (row.notes || null),
        withholdReason: withheld ? (row.withholdReason || null) : null,
    };
}

/**
 * Every checklist note recorded against an application, as its own applicant may read it.
 *
 * @param {object} args
 * @param {object} args.prisma
 * @param {string} args.applicationId
 * @param {{ userId: string, readIds: string[] }} args.holderScope  the caller's holder
 *        scope (holder-access.holderScope(req)) — the ownership check (spec 2026-09-30 §3.1)
 * @param {string} args.healthId  R1-legacy-pin: removed in Task 12 — the pre-R1 filer pin
 */
async function listAuditNotesForApplicant({ prisma, applicationId, holderScope, healthId } = {}) {
    // Ownership first, and a filing that is not this applicant's is a 404 rather than a
    // 403: telling a stranger that an application exists is itself a disclosure. No
    // scope reads nothing and is the same 404.
    // Required here, not at the top: routes/api/audit/onsite.js loads this module for
    // the staff-side writers, and holder-access pulls in the membership service.
    const { r1ApplicationHolderOrPin } = require('./holder-access');
    const application = holderScope && Array.isArray(holderScope.readIds)
        ? await prisma.application.findFirst({
            where: {
                id: String(applicationId || ''),
                // R1-legacy-pin: removed in Task 12 (→ ...holderReadWhere(holderScope, 'Application')).
                // OR form: neutral also when no entity context is bound (final review C1).
                ...r1ApplicationHolderOrPin(holderScope, { healthId: String(healthId || '') }),
                isDeleted: false,
            },
            select: { id: true },
        })
        : null;
    if (!application) {
        throw refuse('APPLICATION_NOT_FOUND', 'ไม่พบคำขอนี้ในบัญชีของคุณ', 404);
    }

    const rows = await prisma.farmAuditChecklistItem.findMany({
        where: { audit: { applicationId: application.id, isDeleted: false } },
        orderBy: [{ section: 'asc' }, { itemCode: 'asc' }],
        select: {
            id: true,
            itemCode: true,
            section: true,
            response: true,
            notes: true,
            isCritical: true,
            recordedAt: true,
            disclosureWithheld: true,
            withholdReason: true,
            audit: { select: { id: true, applicationId: true, submittedAt: true } },
        },
    });

    const items = rows.map(toApplicantView);
    return {
        applicationId: application.id,
        items,
        total: items.length,
        // Counted, not inferred from the list: a surface that shows only disclosed rows
        // must still be able to say how many were held back.
        withheldCount: items.filter((item) => item.withheld).length,
    };
}

/**
 * Withhold one note under ม.30 วรรคสอง, or put it back.
 *
 * Not a toggle: the caller states which way, so a double-click cannot flip a lawful
 * refusal into a disclosure nobody decided on.
 *
 * WHO: this is the controller's judgement about one row, so it is made by the field
 * inspector ASSIGNED to that application, or by system_admin_dtam. Every other staff role
 * that can reach the router (dispatcher, document reviewer, ...) is refused; before this the
 * door sat behind the router-wide AUDIT_STAFF gate only. The item must also belong to the
 * audit named in the path, so the path cannot name one audit and edit another's row.
 *
 * @param {object} args
 * @param {string} [args.auditId]  the audit named in the path; the item must belong to it
 * @param {{id: string, role?: string, canonicalRole?: string}} [args.actor]
 */
async function setNoteDisclosure({ prisma, itemId, auditId, withheld, reason, actorId, actor } = {}) {
    const item = await prisma.farmAuditChecklistItem.findUnique({
        where: { id: String(itemId || '') },
        select: {
            id: true,
            auditId: true,
            audit: { select: { id: true, auditorId: true, application: { select: { id: true, auditorId: true } } } },
        },
    });
    if (!item || (auditId && item.auditId !== auditId)) {
        throw refuse('CHECKLIST_ITEM_NOT_FOUND', 'ไม่พบรายการตรวจนี้', 404);
    }

    const who = actor || (actorId ? { id: actorId } : null);
    const role = normalizeRole(who && (who.canonicalRole || who.role));
    const assignedInspector = role === CANONICAL_ROLES.FIELD_INSPECTOR
        && Boolean(who.id)
        && Boolean(item.audit && item.audit.application)
        && item.audit.application.auditorId === who.id;
    if (role !== CANONICAL_ROLES.SYSTEM_ADMIN_DTAM && !assignedInspector) {
        throw refuse(
            'DISCLOSURE_NOT_PERMITTED',
            'เฉพาะผู้ตรวจประเมินที่ได้รับมอบหมายคำขอนี้ หรือผู้ดูแลระบบ DTAM เท่านั้นที่ตั้งค่าการเปิดเผยหรือไม่เปิดเผยบันทึกของผู้ตรวจได้',
            403,
        );
    }

    if (!withheld) {
        // Clear the whole refusal, not just the flag. A stale reason left beside a
        // disclosed row would read, later, as though it were still being withheld.
        return prisma.farmAuditChecklistItem.update({
            where: { id: item.id },
            data: {
                disclosureWithheld: false,
                withholdReason: null,
                withheldBy: null,
                withheldAt: null,
            },
        });
    }

    const text = String(reason || '').trim();
    if (text.length < WITHHOLD_REASON_MIN) {
        throw refuse(
            'WITHHOLD_REASON_REQUIRED',
            'การไม่เปิดเผยบันทึกต้องระบุเหตุผลตาม พ.ร.บ.คุ้มครองข้อมูลส่วนบุคคล มาตรา 30 วรรคสอง '
            + 'เช่น บันทึกอ้างถึงบุคคลอื่นซึ่งจะกระทบสิทธิของเขา — กรุณาเขียนเหตุผลให้ผู้ยื่นอ่านเข้าใจ',
            422,
        );
    }

    return prisma.farmAuditChecklistItem.update({
        where: { id: item.id },
        data: {
            disclosureWithheld: true,
            withholdReason: text,
            withheldBy: actorId || null,
            withheldAt: new Date(),
        },
    });
}

module.exports = {
    listAuditNotesForApplicant,
    setNoteDisclosure,
    toApplicantView,
    WITHHOLD_REASON_MIN,
};
