'use strict';

/**
 * Tell the certificate approvers that a file has reached their queue.
 *
 * A file that reaches AUDIT_PASSED waits for a certificate_approver (ISO/IEC 17065 §7.6,
 * F-CERT-SOD 2026-09-10). Nothing told them: the only way to learn there was something to
 * decide was to open /provider/certification-decisions and look. This puts one in-app
 * notification in the mailbox of every ACTIVE approver of the application's organisation,
 * pointing at the read-only file view.
 *
 * Called from the canonical status writer at toStatus === AUDIT_PASSED, so every door that
 * writes AUDIT_PASSED notifies the same way. Best-effort by contract: a notification is a
 * courtesy and the queue page is the source of truth, so a failure here must never undo
 * the inspector's recorded decision.
 */

const { prisma } = require('./prisma-database');
const { withoutTenantScope } = require('./tenant-context');
const { CANONICAL_ROLES } = require('../shared/canonical-rbac');
const { createNotification } = require('./notification-service');

const CERTIFICATE_APPROVER_DB_ROLES = Object.freeze([CANONICAL_ROLES.CERTIFICATE_APPROVER]);

/** ACTIVE, non-deleted certificate approvers of one organisation. */
async function listCertificateApproverIds(organizationId) {
    if (!organizationId) { return []; }
    const rows = await withoutTenantScope(() => prisma.user.findMany({
        where: {
            role: { in: [...CERTIFICATE_APPROVER_DB_ROLES] },
            organizationId,
            status: 'ACTIVE',
            isDeleted: false,
        },
        select: { id: true },
    }));
    return rows.map((r) => r.id);
}

/**
 * @param {object} args
 * @param {string} args.applicationId
 * @param {string} args.applicationNumber
 * @param {string} args.organizationId
 * @returns {Promise<number>} how many approvers were notified
 */
async function notifyCertificateApproversOfPassedFile({ applicationId, applicationNumber, organizationId } = {}) {
    const approverIds = await listCertificateApproverIds(organizationId);
    let notified = 0;
    for (const userId of approverIds) {
        const row = await createNotification({
            userId,
            type: 'INFO',
            title: 'มีคำขอรอตัดสินให้การรับรอง',
            message: `คำขอ ${applicationNumber || applicationId} ผ่านการตรวจประเมินแปลงแล้ว รอท่านตัดสินให้การรับรอง เปิดดูแฟ้มทั้งหมดได้ที่หน้าตัดสินให้การรับรอง`,
            data: { applicationId, applicationNumber: applicationNumber || null },
            actionUrl: `/provider/certification-decisions/${applicationId}`,
        });
        if (row) { notified += 1; }
    }
    return notified;
}

module.exports = {
    CERTIFICATE_APPROVER_DB_ROLES,
    listCertificateApproverIds,
    notifyCertificateApproversOfPassedFile,
};
