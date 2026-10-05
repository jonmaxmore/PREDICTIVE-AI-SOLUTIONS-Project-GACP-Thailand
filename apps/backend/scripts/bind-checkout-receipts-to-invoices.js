#!/usr/bin/env node
'use strict';
/**
 * Bind the PLATFORM_TAX_INVOICE document already issued at settlement onto the invoice
 * that the checkout order paid — for orders settled BEFORE the settlement service
 * started writing the receipt columns itself — and refuse everything else.
 *
 * WHY THIS EXISTS (ledger F-G4-36, reports/g4-journey/QA-LEDGER.md)
 *   checkout-settlement-service allocates one TAX-PRD number per settlement and stores
 *   the document in checkout_documents (W14: one number, one document). Until F-G4-36
 *   it did not copy that number onto invoices.receiptNumber, so every reader of the
 *   invoice row (customer statement, daily cash report, bank reconciliation, invoice
 *   PDF, the farmer's payments page) saw a paid invoice with no receipt, and
 *   listPendingReceipts kept offering the accountant an "issue receipt" button that
 *   would draw a SECOND number for the same supply (F-G4-38). The settlement service
 *   now writes the receipt columns in the same transaction as the document; this script
 *   backfills the rows settled before that change with the exact same four columns.
 *
 * WHY THE GUARDS ARE THIS PARANOID
 *   A receipt number is a legal document identifier. The script binds only when the
 *   order is SETTLED, has an invoice, the invoice has NO receipt number, and EXACTLY one
 *   PLATFORM_TAX_INVOICE document exists for the order. An invoice that already carries
 *   a DIFFERENT number is a CONFLICT (two documents for one supply — a human decides).
 *   An invoice that already carries THIS number is ALREADY_BOUND and is counted apart
 *   as a no-op. The decision is a pure function (planReceiptBindings) pinned by
 *   __tests__/unit/bind-checkout-receipts-script.test.js.
 *
 * SAFETY CONTRACT (mirrors scripts/cleanup-test-organizations.js)
 *   - dry run is the default; nothing is written without --apply;
 *   - --apply additionally requires --expect=<n> and aborts unless exactly n bindings
 *     are planned, so a dataset that drifted since the dry run stops the run;
 *   - every write is guarded by receiptNumber still being null inside the transaction —
 *     one row that moved rolls the whole transaction back;
 *   - output carries no personal data: order milestone, application numbers, invoice
 *     numbers, document numbers, amounts; the connection string is never printed (L2).
 *
 * Usage:
 *   node scripts/bind-checkout-receipts-to-invoices.js                     # dry run (default)
 *   node scripts/bind-checkout-receipts-to-invoices.js --apply --expect=2  # bind, guarded
 *   ... [--evidence <dir>]                                                 # write decisions JSON
 */
const fs = require('fs');
const path = require('path');
require('dotenv').config({ quiet: true });
const { PrismaClient } = require('@prisma/client');
const { CHECKOUT_STATUSES } = require('../shared/checkout-status');

const SCRIPT_REL = 'scripts/bind-checkout-receipts-to-invoices.js';
const LEDGER_ID = 'F-G4-36';

// The only order state whose money has moved (shared/checkout-status.js).
const SETTLED = 'SETTLED';
if (!CHECKOUT_STATUSES.includes(SETTLED)) {
    throw new Error(`${SETTLED} is not in shared/checkout-status CHECKOUT_STATUSES`);
}

// services/document-numbering.js SCHEMES.PLATFORM_TAX_INVOICE. Not imported: that module
// requires services/prisma-database at load, and requiring this script must never build
// a client.
const TAX_INVOICE_DOCUMENT_TYPE = 'PLATFORM_TAX_INVOICE';

// Exactly what checkout-settlement-service.js writes onto the invoice at settle time.
const RECEIPT_ISSUED_BY = 'stripe-webhook';
const RECEIPT_STATUS_ISSUED = 'ISSUED';

function redactDbUrl(rawUrl) {
    try {
        const u = new URL(rawUrl);
        return `${u.protocol}//<redacted>@${u.hostname}:${u.port || '5432'}${u.pathname}`;
    } catch {
        return '<unparseable DATABASE_URL — redacted>';
    }
}

/**
 * The whole decision, in one place, over plain rows. PURE: reads its arguments, mutates
 * nothing, touches no database.
 *
 * @param {object} p
 * @param {Array<{id, status, invoiceId, invoice: {id, invoiceNumber, receiptNumber}|null,
 *                documents: Array<{documentType, documentNumber, createdAt}>}>} p.orders
 * @returns {{
 *   bindings: Array<{invoiceId, receiptNumber, receiptIssuedAt, receiptIssuedBy, receiptStatus}>,
 *   alreadyBound: Array<{order, reason}>,
 *   refused: Array<{order, reason}>,
 * }}
 */
function planReceiptBindings({ orders }) {
    const bindings = [];
    const alreadyBound = [];
    const refused = [];
    const plannedInvoiceIds = new Set();

    for (const order of orders) {
        if (order.status !== SETTLED) {
            refused.push({ order, reason: `NOT_SETTLED (status=${order.status})` });
            continue;
        }
        if (!order.invoiceId || !order.invoice) {
            refused.push({ order, reason: 'NO_INVOICE (order has no invoice row)' });
            continue;
        }
        const docs = (order.documents || []).filter((d) => d.documentType === TAX_INVOICE_DOCUMENT_TYPE);
        if (docs.length === 0) {
            refused.push({ order, reason: `NO_TAX_INVOICE_DOCUMENT (no ${TAX_INVOICE_DOCUMENT_TYPE} for this order)` });
            continue;
        }
        if (docs.length > 1) {
            refused.push({ order, reason: `MULTIPLE_TAX_INVOICE_DOCUMENTS (${docs.length} ${TAX_INVOICE_DOCUMENT_TYPE} for this order)` });
            continue;
        }
        const doc = docs[0];
        const current = order.invoice.receiptNumber;
        if (current && current === doc.documentNumber) {
            alreadyBound.push({ order, reason: `ALREADY_BOUND (${doc.documentNumber})` });
            continue;
        }
        if (current) {
            refused.push({ order, reason: `CONFLICT (invoice carries ${current}, document is ${doc.documentNumber})` });
            continue;
        }
        if (plannedInvoiceIds.has(order.invoiceId)) {
            refused.push({ order, reason: 'DUPLICATE_INVOICE_IN_PLAN (another order already binds this invoice)' });
            continue;
        }
        plannedInvoiceIds.add(order.invoiceId);
        bindings.push({
            invoiceId: order.invoiceId,
            receiptNumber: doc.documentNumber,
            // The live path (checkout-settlement-service.js) stamps receiptIssuedAt with the
            // order's settledAt — the same instant as paidAt. Carry that here so a backfilled
            // invoice is indistinguishable from one settled after the fix; the document row's
            // own createdAt is only the fallback for an order that never recorded settledAt.
            receiptIssuedAt: order.settledAt || doc.createdAt,
            receiptIssuedBy: RECEIPT_ISSUED_BY,
            receiptStatus: RECEIPT_STATUS_ISSUED,
        });
    }
    return { bindings, alreadyBound, refused };
}

function parseArgs(argv) {
    const args = { apply: false, expect: null, evidence: null };
    for (let i = 0; i < argv.length; i += 1) {
        const a = argv[i];
        if (a === '--apply') {
            args.apply = true;
        } else if (a.startsWith('--expect=')) {
            args.expect = Number(a.slice('--expect='.length));
        } else if (a === '--expect') {
            i += 1;
            args.expect = Number(argv[i]);
        } else if (a === '--evidence') {
            i += 1;
            args.evidence = argv[i];
        } else {
            throw new Error(`unknown argument: ${a}`);
        }
    }
    return args;
}

/** One printable line per decision — no personal data. */
function summarise(decision, order, receiptNumber, reason) {
    return {
        decision,
        milestone: order.milestone,
        application: order.application?.applicationNumber || order.applicationId,
        invoice: order.invoice?.invoiceNumber || order.invoiceId,
        invoiceStatus: order.invoice?.status,
        amount: order.invoice ? String(order.invoice.totalAmount) : null,
        receipt: receiptNumber,
        reason,
    };
}

async function main() {
    const args = parseArgs(process.argv.slice(2));

    if (!process.env.DATABASE_URL) {
        console.error('FATAL: DATABASE_URL is not set');
        process.exit(2);
    }
    const u = new URL(process.env.DATABASE_URL);
    u.port = '6543';
    u.searchParams.set('pgbouncer', 'true');
    u.searchParams.set('connection_limit', '1');
    const prisma = new PrismaClient({ datasources: { db: { url: u.toString() } } });

    console.log(`database: ${redactDbUrl(u.toString())}`);
    console.log(`mode:     ${args.apply ? 'APPLY (receipt columns will be written)' : 'DRY RUN (nothing will be written)'}\n`);

    const orders = await prisma.checkoutOrder.findMany({
        where: { status: SETTLED, invoiceId: { not: null } },
        select: {
            id: true, milestone: true, status: true, invoiceId: true, applicationId: true, settledAt: true,
            application: { select: { applicationNumber: true } },
            invoice: {
                select: {
                    id: true, invoiceNumber: true, status: true, totalAmount: true,
                    receiptNumber: true, receiptStatus: true, receiptIssuedAt: true, receiptIssuedBy: true,
                },
            },
            documents: {
                where: { documentType: TAX_INVOICE_DOCUMENT_TYPE },
                select: { id: true, documentType: true, documentNumber: true, createdAt: true },
            },
        },
        orderBy: [{ settledAt: 'asc' }, { createdAt: 'asc' }],
    });

    const { bindings, alreadyBound, refused } = planReceiptBindings({ orders });
    const orderByInvoiceId = new Map(orders.map((o) => [o.invoiceId, o]));

    const table = [
        ...bindings.map((b) => summarise('BIND', orderByInvoiceId.get(b.invoiceId), b.receiptNumber, `${LEDGER_ID} backfill`)),
        ...alreadyBound.map((a) => summarise('SKIP', a.order, a.order.invoice.receiptNumber, a.reason)),
        ...refused.map((r) => summarise('KEEP', r.order, r.order.invoice?.receiptNumber ?? null, r.reason)),
    ];
    console.table(table);
    console.log(`\n${bindings.length} to bind, ${alreadyBound.length} already bound, ${refused.length} refused, ${orders.length} settled orders read`);

    if (args.evidence) {
        fs.mkdirSync(args.evidence, { recursive: true });
        fs.writeFileSync(
            path.join(args.evidence, 'bind-checkout-receipts-decisions.json'),
            JSON.stringify({
                database: redactDbUrl(u.toString()),
                mode: args.apply ? 'apply' : 'dry-run',
                ledger: LEDGER_ID,
                decisions: table,
                ranAt: new Date().toISOString(),
            }, null, 2),
        );
    }

    if (!args.apply) {
        console.log('\nDRY RUN — nothing written. To bind, re-run with:');
        console.log(`  node ${SCRIPT_REL} --apply --expect=${bindings.length}`);
        await prisma.$disconnect();
        return;
    }

    if (!Number.isInteger(args.expect)) {
        console.error('FATAL: --apply requires --expect=<n> (the count printed by the dry run) — refusing');
        process.exit(2);
    }
    if (bindings.length !== args.expect) {
        console.error(`FATAL: expected exactly ${args.expect} bindings, found ${bindings.length} — refusing`);
        process.exit(1);
    }

    await prisma.$transaction(async (tx) => {
        for (const b of bindings) {
            // Guarded by id AND receiptNumber still null: a row that gained a receipt between
            // the read and this write returns count 0, which rolls back every binding.
            const { invoiceId, ...data } = b;
            const r = await tx.invoice.updateMany({
                where: { id: invoiceId, receiptNumber: null },
                data,
            });
            if (r.count !== 1) {
                throw new Error(`invoice ${invoiceId} already carries a receipt number — rolled back, nothing bound`);
            }
        }
    });

    const bound = await prisma.invoice.count({
        where: {
            id: { in: bindings.map((b) => b.invoiceId) },
            receiptNumber: { in: bindings.map((b) => b.receiptNumber) },
            receiptStatus: RECEIPT_STATUS_ISSUED,
        },
    });
    if (bound !== args.expect) {
        console.error(`FATAL: ${bound} rows read back as bound but expected ${args.expect} — inspect the dataset now`);
        process.exit(1);
    }

    console.log(`\nBOUND ${bound} receipt(s).`);
    for (const b of bindings) {
        const o = orderByInvoiceId.get(b.invoiceId);
        console.log(`  ${o.invoice.invoiceNumber} <- ${b.receiptNumber}`);
    }
    await prisma.$disconnect();
}

module.exports = {
    planReceiptBindings,
    parseArgs,
    TAX_INVOICE_DOCUMENT_TYPE,
    RECEIPT_ISSUED_BY,
    RECEIPT_STATUS_ISSUED,
};

if (require.main === module) {
    main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
}
