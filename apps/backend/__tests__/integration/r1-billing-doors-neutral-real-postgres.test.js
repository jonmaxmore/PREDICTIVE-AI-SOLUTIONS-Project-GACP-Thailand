'use strict';

/**
 * The applicant billing doors, actor × context × door, on a real Postgres.
 * Built in R1 to prove behaviour-neutrality against 9616ccdf (Task 5); since R2
 * Task 12 EXPECTED holds the R2 answers: no workspace header, no filer pin, so
 * an invoice is listed and served exactly when its application's holder is one
 * of the actor's ACTIVE memberships, and is 404 otherwise (re-recorded
 * 2026-10-03; every row is checked against that rule in
 * evidence/remove-workspace-mode/task-12/green.txt).
 *
 * Real Postgres, the real prisma-database client and the real tenant-context
 * middleware; only authentication is attached by hand, and the two PDF
 * renderers return a fixed buffer (the bytes are not under test; the reads in
 * front of them are). The witness runs in its default (shadow) mode.
 *
 * Fixture (one organisation):
 *   A — OWNER of personal P and of company C.
 *   W — OWNER of personal PW, MANAGER invited to P (a worker).
 *   V — OWNER of personal PV, VIEWER of C.
 *   M — OWNER of personal PM, MANAGER of C.
 *   S — OWNER of personal PS only (a stranger).
 *   F — OWNER of personal PF; filed fC on C, then lost the C membership (REVOKED).
 *   G — personal entity PG found by thaiCitizenIdHash only (no membership row);
 *       filed gP on PG and gN with no entity.
 *   N — OWNER of personal PN, invited to C and not yet accepted (PENDING).
 *   Z — no entity and no membership at all (no entity context is ever bound);
 *       filed zN with no entity (final review C1, 2026-10-03; expected
 *       re-recorded on main e33666b9).
 *   Invoices (paid, receipt issued, unless noted): aC, aP, wP, mC, fC, gP;
 *   uP (A on P, unpaid); aN and gN (application without an entity);
 *   xC (A on C, soft-deleted).
 */

const crypto = require('crypto');
const express = require('express');
const request = require('supertest');
const { PrismaClient } = require('@prisma/client');
const { describeIfTestDatabase: d } = require('../../test-support/test-database');

const mockActor = { current: null };
jest.mock('../../middleware/auth-middleware', () => {
    const actual = jest.requireActual('../../middleware/auth-middleware');
    const { tenantContextMiddleware } = jest.requireActual('../../middleware/tenant-context-middleware');
    const bindTenant = tenantContextMiddleware();
    const attach = (req, res, next) => {
        req.user = { ...mockActor.current };
        return bindTenant(req, res, next);
    };
    return { ...actual, authenticateAny: attach, authenticateHealth: attach, authenticateProvider: attach, authenticateToken: attach };
});
jest.mock('../../services/queue-service', () => ({
    getPrecheckQueue: () => null,
    getPdfQueue: () => null,
}));
// Both renderers launch a headless browser; their bytes are not under test.
jest.mock('../../services/pdf/invoice-template-service', () => ({
    ...jest.requireActual('../../services/pdf/invoice-template-service'),
    generateInvoicePdf: async () => Buffer.from('%PDF-1.4 invoice'),
    generateReceiptTaxInvoicePdf: async () => Buffer.from('%PDF-1.4 receipt'),
}));

const ACTORS = ['A', 'W', 'V', 'M', 'S', 'F', 'G', 'N', 'Z'];
const HEADERS = ['none', 'P', 'C'];
// [label, filer, entity (null = none), paid, isDeleted]
const INVOICES = [
    ['aC', 'A', 'C', true, false],
    ['aP', 'A', 'P', true, false],
    ['uP', 'A', 'P', false, false],
    ['wP', 'W', 'P', true, false],
    ['mC', 'M', 'C', true, false],
    ['fC', 'F', 'C', true, false],
    ['gP', 'G', 'PG', true, false],
    ['aN', 'A', null, true, false],
    ['gN', 'G', null, true, false],
    ['zN', 'Z', null, true, false],
    ['xC', 'A', 'C', true, true],
];

// R2 answers since Task 12 — see the header.
const EXPECTED = require('../fixtures/r1-billing-doors-neutral.expected.json');

d('applicant billing doors answer by holder membership (R2) (real Postgres)', () => {
    /** @type {import('@prisma/client').PrismaClient} */
    let raw;
    let app;
    const sfx = crypto.randomUUID().slice(0, 8);
    const fx = { users: {}, entities: {}, invoices: {}, entityIds: [], userIds: [], appIds: [], invoiceIds: [] };
    const label = new Map();

    const mkUser = async (name) => {
        const id = crypto.randomUUID();
        const canonicalId = `r1b-${name.toLowerCase()}-${sfx}`;
        await raw.user.create({
            data: {
                id, canonicalId, healthId: canonicalId, password: 'x', role: 'health', authType: 'EMAIL_LEGACY',
                email: `r1b-${name.toLowerCase()}-${sfx}@example.test`, firstName: 'ทดสอบ', lastName: name, organizationId: fx.org,
            },
        });
        fx.userIds.push(id);
        fx.users[name] = { id, canonicalId };
    };
    const mkEntity = async (name, type, extra = {}) => {
        const row = await raw.entity.create({ data: { type, displayName: `r1b ${name} ${sfx}`, organizationId: fx.org, ...extra } });
        fx.entityIds.push(row.id);
        fx.entities[name] = row.id;
    };
    const member = (user, entity, role, status = 'ACTIVE') => raw.entityMembership.create({
        data: { userId: fx.users[user].id, entityId: fx.entities[entity], role, status, organizationId: fx.org },
    });
    const mkInvoice = async ([name, filer, entity, paid, isDeleted]) => {
        const application = await raw.application.create({
            data: {
                applicationNumber: `APP-R1B-${name}-${sfx}`, healthId: fx.users[filer].canonicalId, areaType: 'OUTDOOR',
                organizationId: fx.org, entityId: entity ? fx.entities[entity] : null, submitterId: fx.users[filer].id,
                status: paid ? 'DOC_FEE_PAID' : 'PENDING_DOC_FEE',
                formData: { applicantData: { address: '1 หมู่ 2', province: 'นนทบุรี', postalCode: '11000' } },
            },
        });
        fx.appIds.push(application.id);
        const invoice = await raw.invoice.create({
            data: {
                invoiceNumber: `INV-R1B-${name}-${sfx}`, applicationId: application.id, healthId: fx.users[filer].canonicalId,
                serviceType: 'CERTIFICATION_CHECKOUT_M1', subtotal: 5500, vat: 385, totalAmount: 5885,
                dueDate: new Date('2026-10-08T00:00:00Z'), organizationId: fx.org,
                status: paid ? 'paid' : 'pending',
                ...(paid ? {
                    paidAt: new Date('2026-09-29T08:14:45Z'), paymentMethod: 'STRIPE',
                    receiptNumber: `TAX-PRD-R1B-${name}-${sfx}`, receiptIssuedAt: new Date('2026-09-29T08:14:45Z'),
                    receiptIssuedBy: 'stripe-webhook', receiptStatus: 'ISSUED',
                } : {}),
                isDeleted, ...(isDeleted ? { deletedAt: new Date(), deletedBy: 'test', deleteReason: 'test' } : {}),
            },
        });
        fx.invoiceIds.push(invoice.id);
        fx.invoices[name] = invoice.id;
        label.set(invoice.id, name);
    };

    const as = (name) => {
        const u = fx.users[name];
        mockActor.current = { id: u.id, canonicalId: u.canonicalId, healthId: u.canonicalId, role: 'health', canonicalRole: 'health', organizationId: fx.org };
    };
    // R2 Task 12: no request sends the workspace header. The context label stays in each
    // row key so the re-recorded table shows that every context now answers alike.
    const headerFor = () => ({});
    const labelOf = (id) => label.get(id) || 'NEW';
    const labels = (rows) => (Array.isArray(rows) ? rows.map((r) => labelOf(r.id)).sort().join(',') : '-');

    beforeAll(async () => {
        raw = new PrismaClient();
        await raw.$connect();
        fx.org = (await raw.organization.create({ data: { name: `r1b-${sfx}`, slug: `r1b-${sfx}`, code: `R1B_${sfx}`.toUpperCase() } })).id;
        for (const name of ACTORS) { await mkUser(name); }
        await mkEntity('P', 'INDIVIDUAL');
        await mkEntity('C', 'JURISTIC', { juristicId: '0105561234560' });
        for (const name of ['PW', 'PV', 'PM', 'PS', 'PF', 'PN']) { await mkEntity(name, 'INDIVIDUAL'); }
        await member('A', 'P', 'OWNER');
        await member('A', 'C', 'OWNER');
        await member('W', 'PW', 'OWNER');
        await member('W', 'P', 'MANAGER');
        await member('V', 'PV', 'OWNER');
        await member('V', 'C', 'VIEWER');
        await member('M', 'PM', 'OWNER');
        await member('M', 'C', 'MANAGER');
        await member('S', 'PS', 'OWNER');
        await member('F', 'PF', 'OWNER');
        await member('F', 'C', 'MANAGER', 'REVOKED');
        await member('N', 'PN', 'OWNER');
        await member('N', 'C', 'VIEWER', 'PENDING');
        // G's personal entity is found by the national-id hash only — no membership row.
        await mkEntity('PG', 'INDIVIDUAL', {
            thaiCitizenIdHash: crypto.createHash('sha256').update(fx.users.G.canonicalId).digest('hex'),
        });
        for (const row of INVOICES) { await mkInvoice(row); }

        app = express();
        app.use(express.json());
        app.use('/api/invoices', require('../../routes/api/finance/invoices'));
    });

    afterAll(async () => {
        if (!raw) { return; }
        // Never delete with an undefined key: Prisma drops it and the filter matches every row.
        const wipe = async (model, where) => {
            if (!raw[model] || Object.values(where).some((v) => v === undefined || v === null)) { return; }
            await raw[model].deleteMany({ where }).catch(() => {});
        };
        await wipe('invoice', { id: { in: fx.invoiceIds } });
        await wipe('application', { id: { in: fx.appIds } });
        await wipe('entityMembership', { entityId: { in: fx.entityIds } });
        await wipe('entity', { id: { in: fx.entityIds } });
        await wipe('user', { id: { in: fx.userIds } });
        await wipe('organization', { id: fx.org });
        await raw.$disconnect();
    });

    const actual = {};
    const record = (key, value) => { actual[key] = value; };

    test('GET /invoices/my, the receipt door and the invoice PDF door', async () => {
        for (const actor of ACTORS) {
            for (const h of HEADERS) {
                as(actor);
                const hdr = headerFor(h);
                const list = await request(app).get('/api/invoices/my').set(hdr);
                record(`${actor}|${h}|GET /invoices/my`, `${list.status} ${labels(list.body?.data)}`);
                const pending = await request(app).get('/api/invoices/my?status=pending').set(hdr);
                record(`${actor}|${h}|GET /invoices/my?status=pending`, `${pending.status} ${labels(pending.body?.data)}`);
                for (const [target] of INVOICES) {
                    const id = fx.invoices[target];
                    const rcpt = await request(app).get(`/api/invoices/my/${id}/receipt/pdf`).set(hdr);
                    record(`${actor}|${h}|GET /invoices/my/:id/receipt/pdf|${target}`, `${rcpt.status} ${rcpt.body?.code || ''}`.trim());
                    const pdf = await request(app).get(`/api/invoices/${id}/pdf`).set(hdr);
                    record(`${actor}|${h}|GET /invoices/:id/pdf|${target}`, `${pdf.status}`);
                }
                const unknown = crypto.randomUUID();
                record(`${actor}|${h}|GET /invoices/my/:id/receipt/pdf|unknown`, `${(await request(app).get(`/api/invoices/my/${unknown}/receipt/pdf`).set(hdr)).status}`);
                record(`${actor}|${h}|GET /invoices/:id/pdf|unknown`, `${(await request(app).get(`/api/invoices/${unknown}/pdf`).set(hdr)).status}`);
            }
        }
        expect(actual).toEqual(EXPECTED);
    });

    afterAll(() => {
        if (process.env.R1_NEUTRAL_RECORD) {
            require('fs').writeFileSync(process.env.R1_NEUTRAL_RECORD, `${JSON.stringify(actual, Object.keys(actual).sort(), 2)}\n`);
        }
    });
});
