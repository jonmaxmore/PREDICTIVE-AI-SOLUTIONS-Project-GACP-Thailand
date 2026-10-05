'use strict';

/**
 * POST /api/applications/:id/car stores the evidence (multer) before the door
 * decides anything. Every refusal must remove what it stored: a refused upload
 * that stays in public/uploads/car is an orphan file nobody can see or delete.
 * Found while removing the R1 filer pin from this door (R2 Task 12; operator:
 * fix what needs fixing).
 *
 * Real Postgres, the real server app and real tokens (the holder-scope fixture).
 *   - stranger S on X → refused (404), no file kept;
 *   - A on X, which is CERTIFIED (not CAR_PENDING) → refused (4xx), no file kept.
 * The accepted path (files kept and named in the filing) is covered by
 * r1-task6-write-doors-neutral-real-postgres.test.js and holder-scope-real-postgres.test.js.
 */

process.env.PAYMENT_ADAPTER = process.env.PAYMENT_ADAPTER || 'mock';
process.env.RATE_LIMIT_MAX = '1000000';

const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const { PrismaClient } = require('@prisma/client');
const { describeIfTestDatabase: d } = require('../../test-support/test-database');
const { seedHolderScopeFixture, cleanupHolderScopeFixture } = require('./fixtures/holder-scope-fixture');

jest.mock('../../services/pdf/pdf-generator.service', () => ({
    initialize: async () => {},
    warmUp: async () => {},
    close: async () => {},
    generatePDF: async () => Buffer.from('%PDF-1.4 car'),
    generateFromTemplate: async () => Buffer.from('%PDF-1.4 car'),
    replaceTemplateVariables: (t) => t,
    readTemplateCached: (templatePath) => require('fs').readFileSync(templatePath, 'utf8'),
}));
jest.mock('../../services/queue-service', () => ({
    ...jest.requireActual('../../services/queue-service'),
    getPrecheckQueue: () => ({ add: async () => ({ id: 'job-car' }) }),
    getPdfQueue: () => null,
}));

const CAR_DIR = path.join(__dirname, '..', '..', 'public', 'uploads', 'car');
const carFiles = () => (fs.existsSync(CAR_DIR) ? fs.readdirSync(CAR_DIR).sort() : []);

d('a refused CAR upload keeps no file (real Postgres, real server)', () => {
    /** @type {import('@prisma/client').PrismaClient} */
    let raw;
    let app;
    let fx;
    let pdfPath;

    beforeAll(async () => {
        raw = new PrismaClient();
        await raw.$connect();
        fx = await seedHolderScopeFixture(raw);
        app = require('../../server');
        await require('../../services/prisma-database').connect();
        const PDFDocument = require('pdfkit');
        pdfPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'car-refusal-')), 'car.pdf');
        await new Promise((resolve, reject) => {
            const doc = new PDFDocument();
            const out = fs.createWriteStream(pdfPath);
            doc.pipe(out);
            doc.fontSize(14).text('Corrective action evidence '.repeat(200));
            doc.end();
            out.on('finish', resolve);
            out.on('error', reject);
        });
    }, 120000);

    afterAll(async () => {
        if (raw) {
            await cleanupHolderScopeFixture(raw, fx);
            await raw.$disconnect();
        }
    });

    const postCar = (actor) => request(app).post(`/api/applications/${fx.apps.X}/car`)
        .set({ Authorization: `Bearer ${fx.tokens[actor]}` })
        .field('notes', 'หลักฐาน').attach('carDocument', pdfPath);

    test('stranger S → 404, and the stored evidence is removed', async () => {
        const before = carFiles();
        const res = await postCar('S');
        expect(res.status).toBe(404);
        expect(carFiles()).toEqual(before);
    });

    test('a filing that is not CAR_PENDING → refused, and the stored evidence is removed', async () => {
        const before = carFiles();
        const res = await postCar('A');
        expect(res.status).toBeGreaterThanOrEqual(400);
        expect(res.status).toBeLessThan(500);
        expect(carFiles()).toEqual(before);
        expect((await raw.application.findUnique({ where: { id: fx.apps.X } })).status).toBe('CERTIFIED');
    });
});
