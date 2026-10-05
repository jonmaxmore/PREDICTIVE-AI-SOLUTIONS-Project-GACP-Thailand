'use strict';

/**
 * Credit / debit note issue against a REAL Postgres — the number is drawn at
 * ISSUE (operator 2026-09-26, "number year = printed year"), so the issue path
 * is where a number can be burnt. Mocks cannot show a row lock or a rollback;
 * this file does.
 *
 *   1. Two concurrent issues of the SAME draft: exactly one succeeds, the other
 *      is refused (INVALID_TRANSITION), exactly one number is drawn from the
 *      series, the row holds that number, and the ISSUED audit names only it.
 *      (Re-review 2, New 1: before the claim, both succeeded — two numbers were
 *      drawn and the first caller was handed one no row holds.)
 *   2. A draft consumes no number; issuing it takes the next one, no gap.
 *   3. A draft that already holds a number (made before 2026-09-26) keeps it.
 *
 * Runs only when the run-level guard verified a usable test database
 * (test-support/test-database.js); otherwise it self-skips, and says so.
 */

const crypto = require('crypto');
const { describeIfTestDatabase: d } = require('../../test-support/test-database');

const KINDS = [
    {
        kind: 'credit', svcPath: '../../services/credit-note-service', model: 'creditNote', field: 'creditNoteNumber',
        create: 'createCreditNote', issue: 'issueCreditNote', cancel: 'cancelCreditNote', prefix: 'CN-PRD', reasonCode: 'PRICE_REDUCTION',
        auditAction: 'CREDIT_NOTE_ISSUED', resource: 'CREDIT_NOTE',
    },
    {
        kind: 'debit', svcPath: '../../services/debit-note-service', model: 'debitNote', field: 'debitNoteNumber',
        create: 'createDebitNote', issue: 'issueDebitNote', cancel: 'cancelDebitNote', prefix: 'DN-PRD', reasonCode: 'CORRECTION',
        auditAction: 'DEBIT_NOTE_ISSUED', resource: 'DEBIT_NOTE',
    },
];

d('credit/debit note issue on real Postgres — one number per issued note', () => {
    let prisma;
    let orgId;
    let healthId;
    let invoiceId;
    let actor;
    const created = { notes: { creditNote: [], debitNote: [] }, invoices: [], apps: [] };
    const uid = () => crypto.randomUUID();

    beforeAll(async () => {
        ({ prisma } = require('../../services/prisma-database'));
        const suffix = uid().slice(0, 8);
        const org = await prisma.organization.create({
            data: { name: `NoteIssue ${suffix}`, slug: `note-issue-${suffix}`, code: `NI_${suffix}`.toUpperCase() },
        });
        orgId = org.id;
        healthId = `note-issue-canon-${suffix}`;
        await prisma.user.create({ data: { canonicalId: healthId, password: 'x', organizationId: orgId, authType: 'EMAIL_LEGACY' } });
        const app = await prisma.application.create({
            data: { applicationNumber: `NI-${suffix}`, healthId, areaType: 'OUTDOOR', organizationId: orgId, status: 'CERTIFIED', formData: {} },
        });
        created.apps.push(app.id);
        const invoice = await prisma.invoice.create({
            data: {
                invoiceNumber: `INV-NI-${suffix}`, healthId, applicationId: app.id, organizationId: orgId,
                serviceType: 'CERTIFICATION_CHECKOUT_M1', status: 'paid',
                subtotal: 5500, vat: 385, totalAmount: 5885, paidAt: new Date(), dueDate: new Date(),
            },
        });
        invoiceId = invoice.id;
        created.invoices.push(invoice.id);
        actor = { id: `acc-${suffix}`, canonicalRole: 'finance_officer_platform', role: 'finance_officer_platform', organizationId: orgId };
    });

    afterAll(async () => {
        if (!prisma) { return; }
        for (const model of ['creditNote', 'debitNote']) {
            for (const id of created.notes[model]) {
                await prisma.auditLog.deleteMany({ where: { resourceId: `${model === 'creditNote' ? 'CREDIT' : 'DEBIT'}_NOTE:${id}` } }).catch(() => {});
                await prisma[model].deleteMany({ where: { id } }).catch(() => {});
            }
        }
        await prisma.invoice.deleteMany({ where: { id: { in: created.invoices } } }).catch(() => {});
        await prisma.application.deleteMany({ where: { id: { in: created.apps } } }).catch(() => {});
        await prisma.user.deleteMany({ where: { canonicalId: healthId } }).catch(() => {});
        await prisma.organization.deleteMany({ where: { id: orgId } }).catch(() => {});
    });

    const counter = async (prefix, year) => {
        const row = await prisma.receiptSequence.findUnique({ where: { prefix_year: { prefix, year } } });
        return row ? row.counter : 0;
    };
    const bangkokYear = () => Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Bangkok', year: 'numeric' }).format(new Date()));

    describe.each(KINDS)('$kind notes', (k) => {
        const svc = () => require(k.svcPath);
        const draft = async () => {
            const row = await svc()[k.create]({
                originalInvoiceId: invoiceId, reasonCode: k.reasonCode, reason: 'ปรับราคาตามข้อตกลง',
                subtotal: 1, vat: 0.07, actor,
            });
            created.notes[k.model].push(row.id);
            return row;
        };

        it('two concurrent issues of the same draft: one succeeds, one number is drawn, the audit names only it', async () => {
            const note = await draft();
            expect(note[k.field]).toBeNull();
            const year = bangkokYear();
            const before = await counter(k.prefix, year);

            const results = await Promise.allSettled([
                svc()[k.issue](note.id, { actor }),
                svc()[k.issue](note.id, { actor }),
            ]);
            const ok = results.filter((r) => r.status === 'fulfilled');
            const refused = results.filter((r) => r.status === 'rejected');
            expect(ok).toHaveLength(1);
            expect(refused).toHaveLength(1);
            expect(refused[0].reason.code).toBe('INVALID_TRANSITION');

            const after = await counter(k.prefix, year);
            expect(after - before).toBe(1);
            const row = await prisma[k.model].findUnique({ where: { id: note.id } });
            expect(row.status).toBe('ISSUED');
            expect(row[k.field]).toBe(ok[0].value[k.field]);
            expect(row[k.field]).toBe(`${k.prefix}-${year}-${String(after).padStart(6, '0')}`);

            const audits = await prisma.auditLog.findMany({ where: { action: k.auditAction, resourceId: `${k.resource}:${note.id}` } });
            // audit-logger persists metadata as a JSON string (middleware/audit-logger.js).
            const meta = (a) => (typeof a.metadata === 'string' ? JSON.parse(a.metadata) : a.metadata) || {};
            const numbers = audits.map((a) => meta(a)[k.field]);
            expect(numbers).toEqual([row[k.field]]);
        });

        it('an abandoned draft takes no number; the next issued note is the next number (no gap)', async () => {
            const year = bangkokYear();
            const before = await counter(k.prefix, year);
            await draft(); // abandoned
            const next = await draft();
            const issued = await svc()[k.issue](next.id, { actor });
            expect(issued[k.field]).toBe(`${k.prefix}-${year}-${String(before + 1).padStart(6, '0')}`);
            expect(await counter(k.prefix, year)).toBe(before + 1);
        });

        // Fix round 4 — cancel is a conditional write on the status the caller
        // read. A second transaction changes the status and HOLDS the row lock
        // while the cancel runs: the cancel reads the old status, then blocks on
        // its write until that transaction commits, exactly the race window.
        const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
        async function raceCancelAgainst(noteId, changeTo) {
            let release;
            const released = new Promise((r) => { release = r; });
            let locked;
            const lockedP = new Promise((r) => { locked = r; });
            const holder = prisma.$transaction(async (tx) => {
                await tx[k.model].update({ where: { id: noteId }, data: changeTo });
                locked();
                await released;
            }, { timeout: 20_000 });
            await lockedP;
            const cancel = svc()[k.cancel](noteId, { actor, reason: 'race' }).then(
                (v) => ({ ok: v }), (e) => ({ err: e.code || e.message }));
            await sleep(400); // the cancel has read the row and is waiting on the lock
            release();
            await holder;
            return cancel;
        }

        it('a cancel racing a POST cannot turn the POSTED note CANCELLED', async () => {
            const note = await draft();
            const issued = await svc()[k.issue](note.id, { actor });
            const result = await raceCancelAgainst(note.id, { status: 'POSTED', postedAt: new Date() });
            expect(result.err).toBe('INVALID_TRANSITION');
            const row = await prisma[k.model].findUnique({ where: { id: note.id } });
            expect(row.status).toBe('POSTED');
            expect(row[k.field]).toBe(issued[k.field]);
        });

        it('a cancel that read a DRAFT does not void the note a concurrent issue just numbered', async () => {
            const note = await draft();
            const result = await raceCancelAgainst(note.id, {
                status: 'ISSUED', issuedAt: new Date(), [k.field]: `${k.prefix}-RACE-${note.id.slice(0, 8)}`,
            });
            expect(result.err).toBe('INVALID_TRANSITION');
            const row = await prisma[k.model].findUnique({ where: { id: note.id } });
            expect(row.status).toBe('ISSUED');
        });

        it('cancelling a POSTED note is refused outright (POSTED is terminal — correct with a new CN/DN)', async () => {
            const note = await draft();
            await svc()[k.issue](note.id, { actor });
            await prisma[k.model].update({ where: { id: note.id }, data: { status: 'POSTED', postedAt: new Date() } });
            await expect(svc()[k.cancel](note.id, { actor })).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
            expect((await prisma[k.model].findUnique({ where: { id: note.id } })).status).toBe('POSTED');
        });

        it('a DRAFT and an ISSUED (not yet posted) note can still be cancelled', async () => {
            const a = await draft();
            expect((await svc()[k.cancel](a.id, { actor })).status).toBe('CANCELLED');
            const b = await draft();
            const issuedB = await svc()[k.issue](b.id, { actor });
            const cancelledB = await svc()[k.cancel](b.id, { actor });
            expect(cancelledB.status).toBe('CANCELLED');
            expect(cancelledB[k.field]).toBe(issuedB[k.field]); // a voided document keeps its number
        });

        it('a draft that already holds a number (made before 2026-09-26) keeps it at issue', async () => {
            const year = bangkokYear();
            const legacyNumber = `${k.prefix}-${year}-9${uid().replace(/\D/g, '').slice(0, 5).padEnd(5, '0')}`;
            const note = await draft();
            await prisma[k.model].update({ where: { id: note.id }, data: { [k.field]: legacyNumber } });
            const before = await counter(k.prefix, year);
            const issued = await svc()[k.issue](note.id, { actor });
            expect(issued[k.field]).toBe(legacyNumber);
            expect(await counter(k.prefix, year)).toBe(before);
        });
    });
});
