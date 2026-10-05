/**
 * Migration script: normalize existing application statuses to Master Workflow canonical names.
 *
 * Usage:
 *   node scripts/migrations/normalize-application-statuses.js [--dry-run]
 *
 * This script:
 * 1. Reads all applications with legacy status names
 * 2. Maps them to the canonical Master Workflow status
 * 3. Updates formData.workflowState to match
 * 4. Reports counts of each transition
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const LEGACY_STATUS_MAP = {
    'PAYMENT_1_PAID': 'DOC_FEE_PAID',
    'PAYMENT_1_PENDING': 'PENDING_DOC_FEE',
    'PENDING_REVIEW': 'ASSIGNED_FOR_REVIEW',
    'IN_REVIEW': 'ASSIGNED_FOR_REVIEW',
    'UNDER_REVIEW': 'ASSIGNED_FOR_REVIEW',
    'REVISION_REQUIRED': 'REVISION_REQUESTED',
    'REVISION_REQ': 'REVISION_REQUESTED',
    'DOCUMENT_APPROVED': 'DOC_APPROVED',
    'PAYMENT_2_PENDING': 'PENDING_AUDIT_FEE',
    'PAYMENT_2_COMPLETED': 'AUDIT_FEE_PAID',
    'AWAITING_SCHEDULE': 'AUDIT_FEE_PAID',
    'SCHEDULED': 'AUDIT_CONFIRMED',
    'AUDIT_SCHEDULED': 'AUDIT_CONFIRMED',
    'AUDIT_IN_PROGRESS': 'AUDIT_CONFIRMED',
    'PENDING_AUDIT': 'AUDIT_CONFIRMED',
    'INSPECTION_IN_PROGRESS': 'AUDIT_CONFIRMED',
    'INSPECTION_COMPLETED': 'AUDIT_PASSED',
    'INSPECTION_SCHEDULED': 'AUDIT_CONFIRMED',
    'AUDITED': 'AUDIT_PASSED',
    'FINAL_APPROVED': 'APPROVED',
    'FINAL_REJECTED': 'REJECTED',
    'AUDIT_FAILED': 'REJECTED',
    'CAR_SUBMITTED': 'CAR_REVIEWING',
};

async function main() {
    const isDryRun = process.argv.includes('--dry-run');
    console.log(`\n Status Migration ${isDryRun ?'(DRY RUN)':'(LIVE)'}\n`);

    const legacyStatuses = Object.keys(LEGACY_STATUS_MAP);
    const applications = await prisma.application.findMany({
        where: {
            status: { in: legacyStatuses },
            isDeleted: false,
        },
        select: {
            id: true,
            applicationNumber: true,
            status: true,
            formData: true,
        },
    });

    console.log(`Found ${applications.length} applications with legacy statuses\n`);

    const counts = {};
    let updated = 0;
    let errors = 0;

    for (const app of applications) {
        const newStatus = LEGACY_STATUS_MAP[app.status];
        if (!newStatus) {
            continue;
        }

        const key = `${app.status} → ${newStatus}`;
        counts[key] = (counts[key] || 0) + 1;

        if (!isDryRun) {
            try {
                const formData = app.formData && typeof app.formData === 'object' ? app.formData : {};
                await prisma.application.update({
                    where: { id: app.id },
                    data: {
                        status: newStatus,
                        formData: {
                            ...formData,
                            workflowState: newStatus,
                            workflowStateUpdatedAt: new Date().toISOString(),
                            _migrated: {
                                from: app.status,
                                to: newStatus,
                                migratedAt: new Date().toISOString(),
                            },
                        },
                    },
                });
                updated++;
            } catch (err) {
                console.error(`Failed: ${app.applicationNumber} (${app.status}): ${err.message}`);
                errors++;
            }
        }
    }

    console.log('Status transition counts:');
    for (const [key, count] of Object.entries(counts).sort()) {
        console.log(`  ${key}: ${count}`);
    }

    if (isDryRun) {
        console.log(`\n DRY RUN complete. ${applications.length} applications would be updated.`);
        console.log('Run without --dry-run to apply changes.');
    } else {
        console.log(`\n Migration complete: ${updated} updated, ${errors} errors`);
    }

    await prisma.$disconnect();
}

main().catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
});
