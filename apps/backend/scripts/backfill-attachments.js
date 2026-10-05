#!/usr/bin/env node
/**
 * Wave A Phase 48 — backfill polymorphic Attachment rows from legacy
 * file-pointer columns and JSON shapes.
 *
 * What it does:
 *   For each model that gained an Attachment dual-write in Phases 33-38,
 *   scan existing rows and create the corresponding Attachment row(s)
 *   when they don't already exist.
 *
 *   - ReportSubmission.attachmentUrl               (text column)
 *   - Lot.labTestReportUrl                         (text column)
 *   - Application.attachments                      (JSON array, slot-keyed)
 *   - PostAuditTask.documents                      (JSON array)
 *   - AuditChecklist.sections[*].items[*].evidence (nested JSON; empty in prod)
 *
 * Idempotent: checks for an existing Attachment row for the same
 * (resModel, resId, field) shape before creating. Re-running the script
 * after partial completion picks up where it left off.
 *
 * Usage on the droplet:
 *   docker exec -it gacp-backend node apps/backend/scripts/backfill-attachments.js
 *
 * Or, if `apps/backend` is the working dir:
 *   docker exec -it gacp-backend node scripts/backfill-attachments.js
 *
 * Exit codes:
 *   0 — success
 *   1 — error (one tenant or one row failed; partial backfill OK to retry)
 *
 * Output:
 *   Per-table progress lines + a final summary {created, skipped, errors}.
 */

'use strict';

const path = require('path');
const { prisma } = require(path.resolve(__dirname, '../services/prisma-database'));
const attachmentService = require(path.resolve(__dirname, '../services/attachment-service'));

function extractFileName(fileUrl) {
    if (!fileUrl) {
        return 'unknown';
    }
    const parts = String(fileUrl).split(/[\\/]/);
    return parts[parts.length - 1] || 'unknown';
}

async function existsAttachment({ resModel, resId, field, fileUrl }) {
    // Check by (resModel, resId, field, fileUrl). Same fileUrl in same
    // slot = same attachment.
    const where = field
        ? { resModel, resId, field, fileUrl }
        : { resModel, resId, fileUrl };
    const found = await prisma.attachment.findFirst({ where, select: { id: true } });
    return !!found;
}

async function createIfMissing(args) {
    const { resModel, resId, field, fileUrl } = args;
    if (await existsAttachment({ resModel, resId, field, fileUrl })) {
        return 'skipped';
    }
    await attachmentService.attach(args);
    return 'created';
}

async function backfillReportSubmissions(stats) {
    console.log('\n--- ReportSubmission ---');
    const rows = await prisma.reportSubmission.findMany({
        where: { NOT: { attachmentUrl: null } },
        select: { id: true, attachmentUrl: true, userId: true, organizationId: true },
    });
    console.log(`  ${rows.length} candidate rows`);
    for (const r of rows) {
        try {
            const result = await createIfMissing({
                prisma,
                resModel: 'ReportSubmission',
                resId: r.id,
                field: 'attachmentUrl',
                fileName: extractFileName(r.attachmentUrl),
                fileUrl: r.attachmentUrl,
                fileSize: 0,
                mimeType: null,
                fileHash: null,
                uploadedBy: r.userId || null,
                organizationId: r.organizationId,
            });
            stats[result] += 1;
        } catch (e) {
            console.warn(`  ERR ReportSubmission ${r.id}: ${e.message}`);
            stats.errors += 1;
        }
    }
}

async function backfillLots(stats) {
    console.log('\n--- Lot ---');
    const rows = await prisma.lot.findMany({
        where: { NOT: { labTestReportUrl: null } },
        select: { id: true, labTestReportUrl: true, organizationId: true },
    });
    console.log(`  ${rows.length} candidate rows`);
    for (const r of rows) {
        try {
            const result = await createIfMissing({
                prisma,
                resModel: 'Lot',
                resId: r.id,
                field: 'labTestReportUrl',
                fileName: extractFileName(r.labTestReportUrl),
                fileUrl: r.labTestReportUrl,
                fileSize: 0,
                mimeType: null,
                fileHash: null,
                uploadedBy: null,
                organizationId: r.organizationId,
            });
            stats[result] += 1;
        } catch (e) {
            console.warn(`  ERR Lot ${r.id}: ${e.message}`);
            stats.errors += 1;
        }
    }
}

async function backfillApplicationAttachments(stats) {
    console.log('\n--- Application.attachments (JSON) ---');
    const rows = await prisma.application.findMany({
        where: { NOT: { attachments: { equals: null } } },
        select: { id: true, attachments: true, organizationId: true },
    });
    console.log(`  ${rows.length} candidate apps`);
    for (const app of rows) {
        const list = Array.isArray(app.attachments) ? app.attachments : [];
        for (const item of list) {
            const fileUrl = item?.fileUrl || item?.url || null;
            if (!fileUrl) {
                continue;
            }
            const slotId = String(item?.slotId || item?.type || 'unknown').trim();
            try {
                const result = await createIfMissing({
                    prisma,
                    resModel: 'Application',
                    resId: app.id,
                    field: `attachments.${slotId}`,
                    fileName: item?.name || item?.fileName || extractFileName(fileUrl),
                    fileUrl,
                    fileSize: Number(item?.size) || 0,
                    mimeType: item?.mimeType || null,
                    fileHash: item?.checksum || item?.sha256 || null,
                    uploadedBy: null,
                    organizationId: app.organizationId,
                });
                stats[result] += 1;
            } catch (e) {
                console.warn(`  ERR Application ${app.id} slot=${slotId}: ${e.message}`);
                stats.errors += 1;
            }
        }
    }
}

async function backfillPostAuditTasks(stats) {
    console.log('\n--- PostAuditTask.documents (JSON) ---');
    const rows = await prisma.postAuditTask.findMany({
        where: { NOT: { documents: { equals: null } } },
        select: { id: true, documents: true, organizationId: true },
    });
    console.log(`  ${rows.length} candidate tasks`);
    for (const task of rows) {
        const docs = Array.isArray(task.documents) ? task.documents : [];
        for (const doc of docs) {
            const fileUrl = doc?.fileUrl || doc?.url || null;
            if (!fileUrl) {
                continue;
            }
            try {
                const result = await createIfMissing({
                    prisma,
                    resModel: 'PostAuditTask',
                    resId: task.id,
                    field: 'documents',
                    fileName: doc?.fileName || extractFileName(fileUrl),
                    fileUrl,
                    fileSize: Number(doc?.size) || 0,
                    mimeType: doc?.mimeType || null,
                    fileHash: null,
                    uploadedBy: doc?.uploadedBy || null,
                    organizationId: task.organizationId,
                });
                stats[result] += 1;
            } catch (e) {
                console.warn(`  ERR PostAuditTask ${task.id}: ${e.message}`);
                stats.errors += 1;
            }
        }
    }
}

async function backfillAuditChecklists(stats) {
    console.log('\n--- AuditChecklist.sections[*].items[*].evidence (JSON) ---');
    const rows = await prisma.auditChecklist.findMany({
        where: { NOT: { sections: { equals: null } } },
        select: { id: true, sections: true, organizationId: true },
    });
    console.log(`  ${rows.length} candidate checklists`);
    for (const cl of rows) {
        const sections = Array.isArray(cl.sections) ? cl.sections : [];
        sections.forEach((section, sectionIdx) => {
            const items = Array.isArray(section?.items) ? section.items : [];
            items.forEach((item, itemIdx) => {
                const ev = item?.evidence;
                if (ev === null || ev === undefined) {
                    return;
                }
                const candidates = Array.isArray(ev) ? ev : [ev];
                candidates.forEach(async (entry, fileIdx) => {
                    if (!entry || typeof entry !== 'object') {
                        return;
                    }
                    const fileUrl = entry.fileUrl || entry.url || null;
                    if (!fileUrl) {
                        return;
                    }
                    try {
                        const result = await createIfMissing({
                            prisma,
                            resModel: 'AuditChecklist',
                            resId: cl.id,
                            field: `sections.${sectionIdx}.items.${itemIdx}.evidence.${fileIdx}`,
                            fileName: entry.fileName || entry.name || 'evidence',
                            fileUrl,
                            fileSize: Number(entry.fileSize || entry.size || 0) || 0,
                            mimeType: entry.mimeType || null,
                            fileHash: entry.fileHash || entry.checksum || null,
                            uploadedBy: null,
                            organizationId: cl.organizationId,
                        });
                        stats[result] += 1;
                    } catch (e) {
                        console.warn(`  ERR AuditChecklist ${cl.id}: ${e.message}`);
                        stats.errors += 1;
                    }
                });
            });
        });
    }
}

async function main() {
    const stats = { created: 0, skipped: 0, errors: 0 };
    console.log('Wave A Phase 48 — backfill Attachment from legacy file pointers');
    console.log('=================================================================');

    await backfillReportSubmissions(stats);
    await backfillLots(stats);
    await backfillApplicationAttachments(stats);
    await backfillPostAuditTasks(stats);
    await backfillAuditChecklists(stats);

    console.log('\n=================================================================');
    console.log('Summary:');
    console.log(`  Created: ${stats.created}`);
    console.log(`  Skipped: ${stats.skipped}  (already in Attachment table)`);
    console.log(`  Errors:  ${stats.errors}`);

    await prisma.$disconnect();
    if (stats.errors > 0) {
        process.exit(1);
    }
}

main().catch((e) => {
    console.error('FATAL', e);
    process.exit(1);
});
