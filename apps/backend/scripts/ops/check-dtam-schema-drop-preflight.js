#!/usr/bin/env node
'use strict';

/**
 * Pre-deploy check for migration 20260929155037_drop_dtam_remittance_schema
 * (PR3 of the DTAM remittance removal). READ-ONLY: one READ ONLY transaction,
 * SELECTs only. Writes nothing.
 *
 * Answers, for the database in DATABASE_URL, the two questions the migration
 * itself asks before it drops anything — so the deploy never meets a refusal:
 *   - checkout_orders rows with dtam_fee_amount > 0 that are not CANCELLED
 *     (the migration refuses on any);
 *   - dtam_remittance_batches rows that are not OPEN (a record of money sent;
 *     the migration refuses on any);
 *   - any other checkout_orders row the new CHECKs would refuse: not CANCELLED
 *     with total_payable_amount <> platform_fee_gross, or a negative net/VAT
 *     (a database whose old CHECK was dropped by hand; the migration refuses).
 * Plus what the drop will discard (informational): CANCELLED orders that carried
 * a DTAM part (they stay, with their total), OPEN batches, remittance statuses,
 * batch pointers.
 *
 * Exit: 0 SAFE_TO_DROP or ALREADY_DROPPED · 1 BLOCKED · 2 could not check.
 * Prints a JSON report to stdout. Never prints the connection string.
 *
 * Usage (from apps/backend, DATABASE_URL set):
 *   node scripts/ops/check-dtam-schema-drop-preflight.js
 */

const path = require('path');
process.chdir(path.join(__dirname, '..', '..'));

const { PrismaClient } = require('@prisma/client');

const num = (v) => Number(v);
const byStatus = (rows) => Object.fromEntries(rows.map((r) => [r.status, num(r.n)]));

async function inspect(tx) {
    const [shape] = await tx.$queryRawUnsafe(`
        SELECT current_database() AS database,
               to_regclass('dtam_remittance_batches') IS NOT NULL AS batch_table,
               EXISTS (SELECT 1 FROM information_schema.columns
                        WHERE table_schema = current_schema() AND table_name = 'checkout_orders'
                          AND column_name = 'dtam_fee_amount') AS dtam_column`);
    const report = { database: shape.database, batchTablePresent: shape.batch_table, dtamColumnPresent: shape.dtam_column };

    if (!shape.batch_table && !shape.dtam_column) {
        return { ...report, verdict: 'ALREADY_DROPPED' };
    }
    if (!shape.batch_table || !shape.dtam_column) {
        return { ...report, verdict: 'UNEXPECTED_SHAPE' };
    }

    const blockingByStatus = await tx.$queryRawUnsafe(`
        SELECT status, count(*) AS n FROM checkout_orders
         WHERE dtam_fee_amount > 0 AND status <> 'CANCELLED' GROUP BY status ORDER BY status`);
    const blockingOrders = await tx.$queryRawUnsafe(`
        SELECT o.id, o.status, o.milestone, o."applicationId", a."applicationNumber",
               o.stripe_payment_intent_id AS "paymentIntentId", o."createdAt"
          FROM checkout_orders o LEFT JOIN applications a ON a.id = o."applicationId"
         WHERE o.dtam_fee_amount > 0 AND o.status <> 'CANCELLED'
         ORDER BY o."createdAt"`);
    const [cancelled] = await tx.$queryRawUnsafe(`
        SELECT count(*) AS n FROM checkout_orders WHERE dtam_fee_amount > 0 AND status = 'CANCELLED'`);
    const batches = await tx.$queryRawUnsafe(`
        SELECT status, count(*) AS n FROM dtam_remittance_batches GROUP BY status ORDER BY status`);
    const remittanceStatuses = await tx.$queryRawUnsafe(`
        SELECT dtam_remittance_status AS status, count(*) AS n FROM checkout_orders
         WHERE dtam_remittance_status IS NOT NULL GROUP BY dtam_remittance_status ORDER BY 1`);
    const [pointers] = await tx.$queryRawUnsafe(`
        SELECT count(*) AS n FROM checkout_orders WHERE "remittanceBatchId" IS NOT NULL`);
    // Same predicate as the migration's third refusal count.
    const breakingNewCheck = await tx.$queryRawUnsafe(`
        SELECT o.id, o.status, o.milestone, a."applicationNumber",
               o.platform_fee_gross::text AS "platformFeeGross", o.total_payable_amount::text AS "totalPayableAmount"
          FROM checkout_orders o LEFT JOIN applications a ON a.id = o."applicationId"
         WHERE NOT (o.dtam_fee_amount > 0 AND o.status <> 'CANCELLED')
           AND ((o.total_payable_amount <> o.platform_fee_gross AND o.status <> 'CANCELLED')
                OR o.platform_fee_net < 0 OR o.platform_fee_vat < 0)
         ORDER BY o."createdAt"`);

    const batchesByStatus = byStatus(batches);
    const blockingBatchesByStatus = Object.fromEntries(
        Object.entries(batchesByStatus).filter(([status]) => status !== 'OPEN'),
    );
    const blockingOrdersByStatus = byStatus(blockingByStatus);
    const ordersBreakingNewTotalCheckByStatus = {};
    for (const o of breakingNewCheck) {
        ordersBreakingNewTotalCheckByStatus[o.status] = (ordersBreakingNewTotalCheckByStatus[o.status] || 0) + 1;
    }
    const blocked = Object.keys(blockingOrdersByStatus).length > 0
        || Object.keys(blockingBatchesByStatus).length > 0
        || breakingNewCheck.length > 0;

    return {
        ...report,
        verdict: blocked ? 'BLOCKED' : 'SAFE_TO_DROP',
        blockingOrdersByStatus,
        blockingOrders: blockingOrders.map((o) => ({ ...o, createdAt: o.createdAt && o.createdAt.toISOString() })),
        blockingBatchesByStatus,
        ordersBreakingNewTotalCheckByStatus,
        ordersBreakingNewTotalCheck: breakingNewCheck,
        cancelledOrdersWithDtamPortion: num(cancelled.n),
        batchesByStatus,
        ordersWithRemittanceStatus: byStatus(remittanceStatuses),
        ordersWithBatchPointer: num(pointers.n),
    };
}

const NEXT = {
    SAFE_TO_DROP: 'migrate deploy may run: the migration will not refuse on this database.',
    ALREADY_DROPPED: 'the schema is already dropped here; nothing to check.',
    BLOCKED: 'do NOT deploy yet. A PENDING_PAYMENT order is retired by one press of its pay button '
        + '(PR2 checkout door) — then run this again. Any other listed row (SETTLED / EXPIRED order, '
        + 'REMITTED / RECONCILED batch, or a row in ordersBreakingNewTotalCheck) is an operator decision; '
        + 'the migration refuses until it is resolved.',
    UNEXPECTED_SHAPE: 'only one of the two dropped objects exists; stop and inspect by hand.',
};

async function main() {
    const prisma = new PrismaClient();
    try {
        const report = await prisma.$transaction(async (tx) => {
            await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
            return inspect(tx);
        }, { timeout: 30000 });
        report.next = NEXT[report.verdict];
        process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
        if (report.verdict === 'BLOCKED') { return 1; }
        if (report.verdict === 'UNEXPECTED_SHAPE') { return 2; }
        return 0;
    } finally {
        await prisma.$disconnect();
    }
}

main().then(
    (code) => { process.exitCode = code; },
    (err) => {
        // The error message only — a Prisma connection error can quote the URL.
        const msg = String((err && err.message) || err).replace(/postgres(?:ql)?:\/\/[^\s'"]+/g, 'postgresql://<redacted>');
        process.stderr.write(`check-dtam-schema-drop-preflight: could not check: ${msg}\n`);
        process.exitCode = 2;
    },
);
