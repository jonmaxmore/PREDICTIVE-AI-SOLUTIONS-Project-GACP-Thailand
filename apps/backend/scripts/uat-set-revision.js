/**
 * UAT Helper: Set J03 to REVISION_REQUESTED for testing edit flow
 */
let prisma;
try { prisma = require('../services/prisma-database').prisma; } catch { prisma = require('./services/prisma-database').prisma; }
let writeApplicationStatus;
try { ({ writeApplicationStatus } = require('../services/application-status-writer')); }
catch { ({ writeApplicationStatus } = require('./services/application-status-writer')); }

async function main() {
    const app = await prisma.application.findFirst({ where: { applicationNumber: 'GACP-2569-PJ03' } });
    if (!app) { console.log('App not found'); return; }

    const existing = typeof app.formData === 'object' && app.formData !== null ? app.formData : {};
    const updated = await writeApplicationStatus({
        prisma,
        applicationId: app.id,
        fromStatus: app.status,
        toStatus: 'REVISION_REQUESTED',
        actorId: 'uat-script',
        actorRole: 'SYSTEM',
        reason: 'UAT helper: set application to REVISION_REQUESTED for edit-flow test',
        additionalData: {
            formData: {
                ...existing,
                _lastReviewComment: 'กรุณาแก้ไขข้อมูลที่อยู่ฟาร์มให้ถูกต้อง และอัปโหลดรูปถ่ายแปลงปลูกเพิ่มเติม',
                workflowState: 'REVISION_REQUESTED',
            },
        },
    });
    console.log('Updated:', updated.applicationNumber, '->', updated.status);
    await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
