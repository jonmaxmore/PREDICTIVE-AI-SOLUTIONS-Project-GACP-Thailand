'use strict';

/**
 * The lot WRITE doors keep their pre-R2 gate: the farm OWNER (cc87292a, where
 * listOwnerFarmIdsForTrace pinned Farm.ownerId). R2 Task 12 widened the farm-id
 * list the lot doors share to every holder in readIds, which opened create, PUT,
 * print (printedAt is an irreversible lock) and labels to a VIEWER or a MANAGER of
 * the farm's holder. T&T is frozen (operator), so the write gate is restored
 * exactly; lot READS may follow membership (spec §3.1).
 *
 * Real Postgres, the real server, real tokens, no workspace header (holder-scope
 * fixture: farm held by C and owned by A; B MANAGER, V VIEWER, S stranger).
 */

process.env.PAYMENT_ADAPTER = process.env.PAYMENT_ADAPTER || 'mock';
process.env.RATE_LIMIT_MAX = '1000000';

const request = require('supertest');
const { PrismaClient } = require('@prisma/client');
const { describeIfTestDatabase: d } = require('../../test-support/test-database');
const { seedHolderScopeFixture, cleanupHolderScopeFixture } = require('./fixtures/holder-scope-fixture');

jest.mock('../../services/pdf/pdf-generator.service', () => ({
    initialize: async () => {},
    warmUp: async () => {},
    close: async () => {},
    generatePDF: async () => Buffer.from('%PDF-1.4 lot'),
    generateFromTemplate: async () => Buffer.from('%PDF-1.4 lot'),
    replaceTemplateVariables: (t) => t,
    readTemplateCached: (templatePath) => require('fs').readFileSync(templatePath, 'utf8'),
}));
jest.mock('../../services/queue-service', () => ({
    ...jest.requireActual('../../services/queue-service'),
    getPrecheckQueue: () => ({ add: async () => ({ id: 'job-lot' }) }),
    getPdfQueue: () => null,
}));
// The label renderer launches a browser; its bytes are not the subject.
jest.mock('../../services/pdf/lot-label-template-service', () => ({
    ...jest.requireActual('../../services/pdf/lot-label-template-service'),
    generateBatchLabelsPdf: async () => Buffer.from('%PDF-1.4 labels'),
    generateLotLabelPdf: async () => Buffer.from('%PDF-1.4 label'),
}));

d('lot write doors: the farm owner only (pre-R2 gate), reads may follow membership', () => {
    /** @type {import('@prisma/client').PrismaClient} */
    let raw;
    let app;
    let fx;

    beforeAll(async () => {
        raw = new PrismaClient();
        await raw.$connect();
        fx = await seedHolderScopeFixture(raw);
        app = require('../../server');
        await require('../../services/prisma-database').connect();
    }, 120000);

    afterAll(async () => {
        if (raw) {
            await cleanupHolderScopeFixture(raw, fx);
            await raw.$disconnect();
        }
    });

    const auth = (actor) => ({ Authorization: `Bearer ${fx.tokens[actor]}` });
    const doors = {
        create: (actor) => request(app).post('/api/lots').set(auth(actor))
            .send({ batchId: fx.more.batch, packageType: 'BAG', quantity: 1, unitWeight: 1 }),
        put: (actor) => request(app).put(`/api/lots/${fx.more.lot}`).set(auth(actor))
            .send({ packagedAt: new Date('2026-07-01T00:00:00Z').toISOString() }),
        print: (actor) => request(app).post(`/api/lots/${fx.more.lot}/print`).set(auth(actor)).send({}),
        labels: (actor) => request(app).post('/api/lots/labels').set(auth(actor)).send({ lotIds: [fx.more.lot] }),
    };
    const snapshot = async () => {
        const lot = await raw.lot.findUnique({ where: { id: fx.more.lot } });
        return {
            lots: await raw.lot.count({ where: { organizationId: fx.orgId } }),
            updatedAt: lot.updatedAt.toISOString(),
            printedAt: lot.printedAt ? lot.printedAt.toISOString() : null,
            packagedAt: lot.packagedAt ? lot.packagedAt.toISOString() : null,
        };
    };

    test.each([['V', 'VIEWER of C'], ['B', 'MANAGER of C'], ['S', 'stranger']])(
        '%s (%s) is refused on create (403), PUT, print and labels (404); the lot and the lot count are unchanged',
        async (actor) => {
            const before = await snapshot();
            const statuses = {};
            for (const [name, call] of Object.entries(doors)) { statuses[name] = (await call(actor)).status; }
            expect(statuses).toEqual({ create: 403, put: 404, print: 404, labels: 404 });
            expect(await snapshot()).toEqual(before);
        },
    );

    test('the farm owner A still creates (201), updates (200), prints (200) and gets labels (200)', async () => {
        const before = await snapshot();
        const statuses = {};
        for (const [name, call] of Object.entries(doors)) { statuses[name] = (await call('A')).status; }
        expect(statuses).toEqual({ create: 201, put: 200, print: 200, labels: 200 });
        const after = await snapshot();
        expect(after.lots).toBe(before.lots + 1);
        expect(after.printedAt).not.toBeNull();
    });

    test('a lot READ follows membership (spec §3.1): V and B read the lot, S does not', async () => {
        for (const [actor, status] of [['V', 200], ['B', 200], ['S', 404]]) {
            expect([actor, (await request(app).get(`/api/lots/${fx.more.lot}`).set(auth(actor))).status]).toEqual([actor, status]);
        }
    });
});
