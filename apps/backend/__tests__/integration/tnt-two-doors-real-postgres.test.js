'use strict';

/**
 * T&T สองประตู (operator 2026-10-03 "แก้ T&T 2 จุด") บน Postgres จริง ผ่าน server จริง
 *
 * 1. POST /api/harvest-batches/:id/lab-results — ด่านเดิมคือ listAccessibleFarmIds อย่างเดียว
 *    ซึ่งนับ VIEWER ด้วย · VIEWER จึงแนบ COA สาธารณะเข้ารุ่นของบริษัทได้ (201)
 *    ประตูเขียนพี่น้องในไฟล์เดียวกันถือ HARVEST_RECORD (assertFarmActionPermission) — ต้องเท่ากัน
 *    และการปฏิเสธต้องไม่ทิ้งทั้งแถวและไฟล์
 * 2. GET /api/lots/:id/qr/print — เรียก publicTraceUrlFor โดยไม่ได้ import ⇒ 500 ทุกครั้ง
 *    URL ใน QR ต้องเป็น <trace base>/trace/lot/<id> ซึ่งคือหน้าที่ผู้ซื้อสแกนแล้วไปถึง
 *    (apps/web-app/src/app/trace/lot/[lot-id] → /api/trace/lot/:id)
 *
 * ผู้เล่น (fixtures/holder-scope-fixture.js): A OWNER ของบริษัท C · B MANAGER · V VIEWER
 */

process.env.PAYMENT_ADAPTER = process.env.PAYMENT_ADAPTER || 'mock';
process.env.RATE_LIMIT_MAX = '1000000';

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const { PrismaClient } = require('@prisma/client');
const { describeIfTestDatabase: d } = require('../../test-support/test-database');
const { seedHolderScopeFixture, cleanupHolderScopeFixture } = require('./fixtures/holder-scope-fixture');

jest.mock('../../services/pdf/pdf-generator.service', () => ({
    initialize: async () => {},
    warmUp: async () => {},
    close: async () => {},
    generatePDF: async () => Buffer.from('%PDF-1.4 t'),
    generateFromTemplate: async () => Buffer.from('%PDF-1.4 t'),
    replaceTemplateVariables: (t) => t,
    readTemplateCached: (templatePath) => require('fs').readFileSync(templatePath, 'utf8'),
}));
jest.mock('../../services/queue-service', () => ({
    ...jest.requireActual('../../services/queue-service'),
    getPrecheckQueue: () => ({ add: async () => ({ id: 'job-t' }) }),
    getPdfQueue: () => null,
}));

const TRACE_BASE = 'https://trace-two-doors.example.test';
const LAB_DIR = path.join(__dirname, '..', '..', 'public', 'uploads', 'lab-results');
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n'), Buffer.alloc(4096, 0x20), Buffer.from('\n%%EOF\n')]);

const listLabDir = () => (fs.existsSync(LAB_DIR) ? fs.readdirSync(LAB_DIR).sort() : []);

d('T&T two doors (real Postgres, real server)', () => {
    /** @type {import('@prisma/client').PrismaClient} */
    let raw;
    let app;
    let fx;
    const ORIGINAL_TRACE = process.env.PUBLIC_TRACE_URL;
    const createdFiles = [];

    beforeAll(async () => {
        process.env.PUBLIC_TRACE_URL = TRACE_BASE;
        raw = new PrismaClient();
        await raw.$connect();
        fx = await seedHolderScopeFixture(raw);
        app = require('../../server');
        await require('../../services/prisma-database').connect();
    }, 120000);

    afterAll(async () => {
        if (ORIGINAL_TRACE === undefined) { delete process.env.PUBLIC_TRACE_URL; } else { process.env.PUBLIC_TRACE_URL = ORIGINAL_TRACE; }
        for (const name of createdFiles) { fs.rmSync(path.join(LAB_DIR, name), { force: true }); }
        if (raw) {
            if (fx?.more?.batch) { await raw.batchLabResult.deleteMany({ where: { harvestBatchId: fx.more.batch } }).catch(() => {}); }
            await cleanupHolderScopeFixture(raw, fx);
            await raw.$disconnect();
        }
    });

    const as = (actor) => ({ Authorization: `Bearer ${fx.tokens[actor]}`, 'x-active-entity-id': fx.entities.C });
    const labRows = () => raw.batchLabResult.count({ where: { harvestBatchId: fx.more.batch } });
    const attach = (actor) => request(app).post(`/api/harvest-batches/${fx.more.batch}/lab-results`).set(as(actor))
        .field('labName', 'ห้องปฏิบัติการกลาง').attach('file', PDF, { filename: 'coa.pdf', contentType: 'application/pdf' });

    test('VIEWER: POST lab-results → 403 ENTITY_PERMISSION_DENIED, no row and no stored file', async () => {
        const rowsBefore = await labRows();
        const filesBefore = listLabDir();
        const res = await attach('V');
        const filesAfter = listLabDir();
        createdFiles.push(...filesAfter.filter((f) => !filesBefore.includes(f)));
        expect({ status: res.status, code: res.body.code, permission: res.body.permission })
            .toEqual({ status: 403, code: 'ENTITY_PERMISSION_DENIED', permission: 'HARVEST_RECORD' });
        expect(await labRows()).toBe(rowsBefore);
        expect(filesAfter).toEqual(filesBefore);
    });

    test.each([['A', 'OWNER'], ['B', 'MANAGER (holds HARVEST_RECORD by role default)']])(
        '%s %s: POST lab-results → 201 and one row', async (actor) => {
            const rowsBefore = await labRows();
            const filesBefore = listLabDir();
            const res = await attach(actor);
            createdFiles.push(...listLabDir().filter((f) => !filesBefore.includes(f)));
            expect(res.status).toBe(201);
            expect(res.body.data.harvestBatchId).toBe(fx.more.batch);
            expect(await labRows()).toBe(rowsBefore + 1);
        },
    );

    test('VIEWER may still READ the lab results (GET is a read, gated like GET /:id)', async () => {
        const res = await request(app).get(`/api/harvest-batches/${fx.more.batch}/lab-results`).set(as('V'));
        expect(res.status).toBe(200);
    });

    test('lot owner: GET qr/print → 200 JSON, QR encodes the buyer\'s public trace URL', async () => {
        const qrcodeService = require('../../services/qrcode/qrcode-service');
        const spy = jest.spyOn(qrcodeService, 'generateDataUrl');
        try {
            const res = await request(app).get(`/api/lots/${fx.more.lot}/qr/print`).set(as('A'));
            expect(res.status).toBe(200);
            expect(res.headers['content-type']).toMatch(/^application\/json/);
            expect(res.body.data.label.qrCodeDataUrl).toMatch(/^data:image\/png;base64,/);
            const expectedUrl = `${TRACE_BASE}/trace/lot/${fx.more.lot}`;
            expect(spy).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ url: expectedUrl }));
        } finally {
            spy.mockRestore();
        }
    });
});
