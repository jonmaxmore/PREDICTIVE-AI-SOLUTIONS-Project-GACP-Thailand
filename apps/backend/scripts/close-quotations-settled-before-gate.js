#!/usr/bin/env node
'use strict';
/**
 * Close the quotations of applications that paid in full through the checkout
 * rail BEFORE the acceptance gate existed — and refuse everything else.
 *
 * WHY THIS EXISTS (ledger F-G4-64, R5)
 *   The register of 2026-08-28 holds three quotations, all PENDING, all with
 *   acceptedAt null. Two of them (QT-PRD-2026-000001 for A1 and -000002 for A3)
 *   priced applications whose BOTH instalments are SETTLED, whose applications
 *   are CERTIFIED, and one of whose certificates is still active. The row says
 *   "awaiting the customer's answer" about a bill that was paid in full and
 *   receipted twice.
 *
 * WHAT IT REFUSES TO DO
 *   It does not write acceptedAt, acceptedBy, acceptedSnapshot or
 *   acceptedSnapshotHash. Nobody accepted these quotations; the money is a
 *   fact and the acceptance is not, and a repair that manufactures the second
 *   to tidy up the first is a forged record. The row is stamped INVOICED with a
 *   note saying precisely that, and the screen labels it
 *   "ออกใบแจ้งหนี้แล้ว (ชำระก่อนมีขั้นตอนยอมรับ)".
 *
 *   It also creates nothing for application A2 (29422e73), which collected
 *   35,310 THB, holds an active certificate E5960D, and has no quotation row at
 *   all. Ledger F-G4-68 records that absence. Back-dating a document for it
 *   would be inventing the pricing record an auditor would then rely on.
 *
 * SAFETY CONTRACT (mirrors scripts/bind-checkout-receipts-to-invoices.js)
 *   - dry run is the default; nothing is written without --apply;
 *   - --apply additionally requires --expect=<n> and aborts unless exactly n
 *     closures are planned, so a register that drifted since the dry run stops
 *     the run;
 *   - every write is guarded inside the transaction by the row still being
 *     un-closed; one row that moved rolls the whole transaction back;
 *   - output carries no personal data, and the connection string is never
 *     printed (L2).
 *
 * Usage:
 *   node scripts/close-quotations-settled-before-gate.js                     # dry run (default)
 *   node scripts/close-quotations-settled-before-gate.js --apply --expect=2  # close, guarded
 *   ... [--evidence <dir>]                                                   # write decisions JSON
 *
 * L3: the --apply run belongs to the operator. An agent runs the dry run only.
 */
const fs = require('fs');
const path = require('path');
require('dotenv').config({ quiet: true });
const { PrismaClient } = require('@prisma/client');
const { CHECKOUT_STATUSES, MILESTONES } = require('../shared/checkout-status');
const { MILESTONE_TO_PHASE, QUOTATION_ACCEPTED_STATES } = require('../services/billing/quotation-gate');

const SCRIPT_REL = 'scripts/close-quotations-settled-before-gate.js';
const LEDGER_ID = 'F-G4-64';

const REPAIR_NOTE = 'CLOSED_BY_REPAIR 2026-08-28 F-G4-64: '
    + 'settled via checkout before the acceptance gate; no acceptance recorded';

// The only order state whose money has moved (shared/checkout-status.js).
const SETTLED = 'SETTLED';
if (!CHECKOUT_STATUSES.includes(SETTLED)) {
    throw new Error(`${SETTLED} is not in shared/checkout-status CHECKOUT_STATUSES`);
}

// services/quotation-service.js QUOTATION_STATUS. Not imported: that module
// requires services/prisma-database at load, and requiring this script must
// never build a client (pinned by __tests__/unit/close-quotations-script.test.js).
const STATUS_ACCEPTED = 'ACCEPTED';
const STATUS_INVOICED = 'INVOICED';
// Spec §3.7 names the repair case exactly: "ใบ PENDING ที่คำขอมี checkout_orders
// SETTLED ครบทุกงวด". PENDING is what issuance writes (quotation-service.js
// createQuotation), and it is the only status this repair understands. DRAFT
// (the schema default), SENT, REJECTED and EXPIRED each mean something the
// script has no instruction for — a REJECTED row stamped INVOICED would keep
// its rejectedAt and would open the pay gate on a document the applicant
// refused, because quotation-gate counts INVOICED as accepted.
const STATUS_PENDING = 'PENDING';

// Which quotation column records that an instalment has been billed. The live
// path's copy is PHASE_INVOICED_COLUMN inside quotation-service, which is
// private to that module and unreachable from here for the reason above.
const PHASE_COLUMN = Object.freeze({ PHASE_1: 'phase1InvoicedAt', PHASE_2: 'phase2InvoicedAt' });

// The two states quotation-gate reads as "the applicant accepted" are exactly
// the two this script must NOT treat as repair cases: INVOICED is already
// closed, ACCEPTED belongs to the live settlement path. If the gate ever grows a
// third accepted state, this script would silently close rows it does not
// understand — so it refuses to load instead (same discipline as the checkout
// vocabulary's own boot-time totality assertion).
const HANDLED_ACCEPTED_STATES = Object.freeze([STATUS_ACCEPTED, STATUS_INVOICED]);
const unhandledAcceptedStates = QUOTATION_ACCEPTED_STATES
    .filter((s) => !HANDLED_ACCEPTED_STATES.includes(s));
if (unhandledAcceptedStates.length > 0) {
    throw new Error(
        `[${SCRIPT_REL}] quotation-gate counts ${unhandledAcceptedStates.join(', ')} as accepted `
        + 'but this repair has no branch for it — refusing to load',
    );
}

function redactDbUrl(rawUrl) {
    try {
        const u = new URL(rawUrl);
        return `${u.protocol}//<redacted>@${u.hostname}:${u.port || '5432'}${u.pathname}`;
    } catch {
        return '<unparseable DATABASE_URL — redacted>';
    }
}

/**
 * The whole decision, in one place, over plain rows. PURE: reads its arguments,
 * mutates nothing, touches no database.
 *
 * @param {{quotations: Array<{id, quotationNumber, status, acceptedAt, notes,
 *          phase1InvoicedAt, phase2InvoicedAt, installments,
 *          application: {id, checkoutOrders: Array<{milestone, status, settledAt}>}}>}} p
 * @returns {{closures: Array<{quotationId, quotationNumber, data}>,
 *            skipped: Array<{quotationNumber, reason}>}}
 */
function planQuotationClosures({ quotations }) {
    const closures = [];
    const skipped = [];
    for (const q of quotations) {
        if (q.status === STATUS_INVOICED) {
            skipped.push({ quotationNumber: q.quotationNumber, reason: 'ALREADY_CLOSED' });
            continue;
        }
        if (q.status === STATUS_ACCEPTED || q.acceptedAt) {
            // Not a repair case: this row went through the real gate, and the
            // live settlement path is what closes it.
            skipped.push({ quotationNumber: q.quotationNumber, reason: 'ACCEPTED_NOT_A_REPAIR_CASE' });
            continue;
        }
        if (q.status !== STATUS_PENDING) {
            // Allow-list, not a deny-list: an unknown status is left alone.
            skipped.push({ quotationNumber: q.quotationNumber, reason: 'NOT_A_PENDING_ROW' });
            continue;
        }
        const priced = (Array.isArray(q.installments) ? q.installments : [])
            .map((i) => i.phase).filter((p) => PHASE_COLUMN[p]);
        if (priced.length === 0) {
            skipped.push({ quotationNumber: q.quotationNumber, reason: 'NO_INSTALMENTS_TO_MATCH' });
            continue;
        }
        // Earliest SETTLED order per phase: the instant that instalment was
        // actually billed. Two settled orders for one milestone is an anomaly
        // this repair may not resolve by whichever row the read returned last.
        const settled = new Map();
        for (const o of q.application?.checkoutOrders || []) {
            if (o.status !== SETTLED || !o.settledAt || !MILESTONES.includes(o.milestone)) { continue; }
            const phase = MILESTONE_TO_PHASE[o.milestone];
            const seen = settled.get(phase);
            if (!seen || o.settledAt < seen) { settled.set(phase, o.settledAt); }
        }
        if (!priced.every((p) => settled.has(p))) {
            skipped.push({ quotationNumber: q.quotationNumber, reason: 'NOT_FULLY_SETTLED' });
            continue;
        }
        const data = {
            status: STATUS_INVOICED,
            notes: q.notes ? `${q.notes}\n${REPAIR_NOTE}` : REPAIR_NOTE,
        };
        for (const p of priced) { data[PHASE_COLUMN[p]] = settled.get(p); }
        closures.push({ quotationId: q.id, quotationNumber: q.quotationNumber, data });
    }
    return { closures, skipped };
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

/**
 * One printable line per decision — number, statuses, instants; no personal data.
 *
 * BEFORE and AFTER side by side, for KEEP rows as well as CLOSE rows: the
 * operator approves --apply from this table and from the JSON it writes, and a
 * line that printed only the planned value showed `status null` on every KEEP
 * row — which reads as "the register holds null here", not as "PENDING, left
 * alone". A KEEP row's after-values are its own current values, because that is
 * what keeping it means.
 */
function summarise(decision, row, data, reason) {
    const at = (v) => (v instanceof Date ? v.toISOString() : v || null);
    const after = (column) => at(data && data[column] ? data[column] : row[column]);
    return {
        decision,
        quotation: row.quotationNumber,
        statusBefore: row.status,
        statusAfter: (data && data.status) || row.status,
        phase1Before: at(row.phase1InvoicedAt),
        phase1After: after('phase1InvoicedAt'),
        phase2Before: at(row.phase2InvoicedAt),
        phase2After: after('phase2InvoicedAt'),
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
    console.log(`mode:     ${args.apply ? 'APPLY (quotations will be closed)' : 'DRY RUN (nothing will be written)'}\n`);

    const quotations = await prisma.quotation.findMany({
        where: { isDeleted: false, status: { notIn: [STATUS_INVOICED] } },
        include: {
            application: { select: { id: true, checkoutOrders: {
                select: { milestone: true, status: true, settledAt: true },
            } } },
        },
        orderBy: { quotationNumber: 'asc' },
    });

    const { closures, skipped } = planQuotationClosures({ quotations });

    // The row as the register holds it, so every printed line can show the
    // before-state next to the planned one.
    const byNumber = new Map(quotations.map((q) => [q.quotationNumber, q]));
    const table = [
        ...closures.map((c) => summarise('CLOSE', byNumber.get(c.quotationNumber), c.data, `${LEDGER_ID} repair`)),
        ...skipped.map((s) => summarise('KEEP', byNumber.get(s.quotationNumber), null, s.reason)),
    ];
    console.table(table);
    console.log(`\n${closures.length} to close, ${skipped.length} kept, ${quotations.length} open quotation(s) read`);

    if (args.evidence) {
        fs.mkdirSync(args.evidence, { recursive: true });
        fs.writeFileSync(
            path.join(args.evidence, 'close-quotations-decisions.json'),
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
        console.log('\nDRY RUN — nothing written. To close, re-run with:');
        console.log(`  node ${SCRIPT_REL} --apply --expect=${closures.length}`);
        await prisma.$disconnect();
        return;
    }

    if (!Number.isInteger(args.expect)) {
        console.error('FATAL: --apply requires --expect=<n> (the count printed by the dry run) — refusing');
        process.exit(2);
    }
    if (closures.length !== args.expect) {
        console.error(`FATAL: expected exactly ${args.expect} closures, found ${closures.length} — refusing`);
        process.exit(1);
    }

    await prisma.$transaction(async (tx) => {
        for (const c of closures) {
            // Guarded by id AND the row still not being closed: a row that was
            // closed between the read and this write returns count 0, which
            // rolls back every closure in the batch.
            const r = await tx.quotation.updateMany({
                where: { id: c.quotationId, status: { not: STATUS_INVOICED } },
                data: c.data,
            });
            if (r.count !== 1) {
                throw new Error(`quotation ${c.quotationNumber} moved since the dry run — rolled back, nothing closed`);
            }
        }
    });

    const closed = await prisma.quotation.count({
        where: { id: { in: closures.map((c) => c.quotationId) }, status: STATUS_INVOICED },
    });
    if (closed !== args.expect) {
        console.error(`FATAL: ${closed} rows read back as closed but expected ${args.expect} — inspect the register now`);
        process.exit(1);
    }

    console.log(`\nCLOSED ${closed} quotation(s).`);
    for (const c of closures) {
        console.log(`  ${c.quotationNumber} -> ${STATUS_INVOICED}`);
    }
    await prisma.$disconnect();
}

module.exports = {
    planQuotationClosures,
    summarise,
    parseArgs,
    REPAIR_NOTE,
    PHASE_COLUMN,
    STATUS_ACCEPTED,
    STATUS_INVOICED,
};

if (require.main === module) {
    main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
}
