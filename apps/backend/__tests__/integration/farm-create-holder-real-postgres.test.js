'use strict';

/**
 * R2 Task 10 (spec 2026-09-30-remove-workspace-mode §3.2 "Farm create (B7/B8)"
 * and "Wizard-created farm (B6)"), through the REAL server on a REAL Postgres
 * with the REAL permission engine (no mocked service decides anything here).
 *
 *   POST /api/farms names its holder in body.entityId:
 *     - missing → 400 APPLICATION_HOLDER_REQUIRED (the spec §3.6 copy);
 *     - FARM_CREATE is checked on that entity every time, the personal entity
 *       included: the OWNER passes by role (A on PA, A on C), MANAGER B and
 *       VIEWER V on C → 403, stranger S on C → 403;
 *     - only the body names the holder (there is no workspace header since R2 Task 12).
 *   Every refusal writes nothing: farm and plot counts unchanged, and the
 *   evidence_photo multer already stored is discarded.
 *
 *   The legacy /api/wizard door is gone: 404 even with
 *   ENABLE_PROVIDER_LEGACY_ALIAS=true, while /provider-cms (same flag) stays.
 *
 * R2 Task 12: no actor sends a workspace header; membership alone decides.
 */

process.env.RATE_LIMIT_MAX = '1000000';
// The flag that used to mount /api/wizard. Set before the server is required:
// routes/api/index.js reads it at load.
process.env.ENABLE_PROVIDER_LEGACY_ALIAS = 'true';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const request = require('supertest');
const { PrismaClient } = require('@prisma/client');
const { describeIfTestDatabase: d } = require('../../test-support/test-database');
const { seedHolderScopeFixture, cleanupHolderScopeFixture } = require('./fixtures/holder-scope-fixture');

jest.mock('../../services/pdf/pdf-generator.service', () => ({
    initialize: async () => {},
    warmUp: async () => {},
    close: async () => {},
    generatePDF: async () => Buffer.from('%PDF-1.4 farm'),
    generateFromTemplate: async () => Buffer.from('%PDF-1.4 farm'),
    replaceTemplateVariables: (t) => t,
    readTemplateCached: (templatePath) => require('fs').readFileSync(templatePath, 'utf8'),
}));
jest.mock('../../services/queue-service', () => ({
    ...jest.requireActual('../../services/queue-service'),
    getPrecheckQueue: () => ({ add: async () => ({ id: 'job-farm' }) }),
    getPdfQueue: () => null,
}));

/** A real 1x1 PNG (the uploader checks mimetype and extension). */
function realPng() {
    const crcTable = Array.from({ length: 256 }, (_, n) => {
        let c = n;
        for (let k = 0; k < 8; k += 1) { c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1); }
        return c >>> 0;
    });
    const crc = (buf) => {
        let c = 0xffffffff;
        for (const b of buf) { c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); }
        return (c ^ 0xffffffff) >>> 0;
    };
    const chunk = (type, data) => {
        const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
        const td = Buffer.concat([Buffer.from(type), data]);
        const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
        return Buffer.concat([len, td, c]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4);
    ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
    const idat = zlib.deflateSync(Buffer.from([0, 0, 102, 51]));
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0)),
    ]);
}

const HOLDER_REQUIRED_TH = 'ยังไม่ได้เลือกว่าจะยื่นในนามใคร กรุณาเลือกที่ขั้นตอนที่ 1 หากเปิดหน้านี้ค้างไว้ ให้โหลดหน้าใหม่ก่อน';
const UPLOAD_ROOT = path.join(__dirname, '..', '..', 'public', 'uploads');

d('R2 Task 10: a farm names its holder (real Postgres, real server, real engine)', () => {
    /** @type {import('@prisma/client').PrismaClient} */
    let raw;
    let app;
    let fx;
    let png;

    const auth = (actor) => ({ Authorization: `Bearer ${fx.tokens[actor]}` });
    /** Top-level files multer stores evidence_photo under (folder ''). */
    const storedFiles = () => (fs.existsSync(UPLOAD_ROOT)
        ? fs.readdirSync(UPLOAD_ROOT, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name).sort()
        : []);
    const snapshot = async () => ({
        farms: await raw.farm.count(),
        plots: await raw.plot.count(),
        files: storedFiles(),
    });
    const farmFields = (req, extra = {}) => {
        const fields = {
            farmName: `ฟาร์มผู้ถือ ${fx.sfx}`, address: '42 หมู่ 3', province: 'เชียงใหม่',
            district: 'แม่ริม', subDistrict: 'ริมใต้', postalCode: '50180', ...extra,
        };
        for (const [k, v] of Object.entries(fields)) { req.field(k, v); }
        return req;
    };
    const postFarm = (actor, extra) => farmFields(
        request(app).post('/api/farms').set(auth(actor)), extra,
    ).attach('evidence_photo', png, { filename: 'land.png', contentType: 'image/png' });

    /** A refusal: same counts, no file left behind. */
    async function expectNothingWritten(before) {
        const after = await snapshot();
        expect(after.farms).toBe(before.farms);
        expect(after.plots).toBe(before.plots);
        expect(after.files).toEqual(before.files);
    }

    beforeAll(async () => {
        raw = new PrismaClient();
        await raw.$connect();
        fx = await seedHolderScopeFixture(raw);
        png = realPng();
        app = require('../../server');
        await require('../../services/prisma-database').connect();
    }, 120000);

    afterAll(async () => {
        if (raw) {
            const ownerIds = Object.values(fx?.users || {}).map((u) => u.id);
            const made = await raw.farm.findMany({
                // Only the farms this file posts (the fixture's own farm has cycles; its cleanup owns it).
                where: {
                    ownerId: { in: ownerIds },
                    OR: [{ farmName: `ฟาร์มผู้ถือ ${fx.sfx}` }, { farmName: `ฟาร์มขาดที่อยู่ ${fx.sfx}` }],
                },
                select: { id: true, landDocuments: true },
            });
            for (const farm of made) {
                for (const url of farm.landDocuments?.images || []) {
                    const name = path.basename(String(url));
                    fs.rmSync(path.join(UPLOAD_ROOT, name), { force: true });
                }
            }
            await raw.farm.deleteMany({ where: { id: { in: made.map((f) => f.id) } } });
            await cleanupHolderScopeFixture(raw, fx);
            await raw.$disconnect();
        }
    });

    // ── refusals write nothing ─────────────────────────────────────────────
    test('no entityId → 400 APPLICATION_HOLDER_REQUIRED with the spec copy; nothing written, photo discarded', async () => {
        const before = await snapshot();
        const res = await postFarm('A');
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('APPLICATION_HOLDER_REQUIRED');
        expect(res.body.messageTh).toBe(HOLDER_REQUIRED_TH);
        await expectNothingWritten(before);
    });

    test('MANAGER B on C → 403 ENTITY_PERMISSION_DENIED (FARM_CREATE); nothing written, photo discarded', async () => {
        const before = await snapshot();
        const res = await postFarm('B', { entityId: fx.entities.C });
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('ENTITY_PERMISSION_DENIED');
        expect(res.body.permission).toBe('FARM_CREATE');
        expect(res.body.messageTh).toBe('คุณไม่มีสิทธิ์ทำรายการนี้ในนามของผู้ถือรายนี้ ขอให้เจ้าของมอบสิทธิ์ให้คุณก่อน แล้วลองอีกครั้ง');
        await expectNothingWritten(before);
    });

    test('VIEWER V on C → 403; nothing written, photo discarded', async () => {
        const before = await snapshot();
        const res = await postFarm('V', { entityId: fx.entities.C });
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('ENTITY_PERMISSION_DENIED');
        await expectNothingWritten(before);
    });

    test('stranger S names C → 403; nothing written, photo discarded', async () => {
        const before = await snapshot();
        const res = await postFarm('S', { entityId: fx.entities.C });
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('ENTITY_PERMISSION_DENIED');
        await expectNothingWritten(before);
    });

    test('missing required fields with a photo → 400; nothing written, photo discarded', async () => {
        const before = await snapshot();
        const res = await request(app).post('/api/farms').set(auth('A'))
            .field('farmName', `ฟาร์มขาดที่อยู่ ${fx.sfx}`).field('entityId', fx.entities.PA)
            .attach('evidence_photo', png, { filename: 'land.png', contentType: 'image/png' });
        expect(res.status).toBe(400);
        await expectNothingWritten(before);
    });

    test('a create that fails after the upload is stored → 500; nothing written, photo discarded', async () => {
        // Review M1: the catch-block discard. The holder check passes (A owns C); the write
        // itself throws after multer has stored the photo.
        const farmService = require('../../services/farm-service');
        const spy = jest.spyOn(farmService, 'createFarm').mockRejectedValueOnce(new Error('write failed'));
        try {
            const before = await snapshot();
            const res = await postFarm('A', { entityId: fx.entities.C });
            expect(res.status).toBe(500);
            expect(spy).toHaveBeenCalledTimes(1);
            await expectNothingWritten(before);
        } finally {
            spy.mockRestore();
        }
    });

    // ── the OWNER passes by role, on the personal entity too ───────────────
    test('A (OWNER) on the personal entity PA → 201, farm.entityId = PA, photo kept', async () => {
        const before = await snapshot();
        const res = await postFarm('A', { entityId: fx.entities.PA });
        expect(res.status).toBe(201);
        const row = await raw.farm.findUnique({ where: { id: res.body.data.id } });
        expect(row.entityId).toBe(fx.entities.PA);
        expect(row.ownerId).toBe(fx.users.A.id);
        expect(await raw.farm.count()).toBe(before.farms + 1);
        const images = row.landDocuments?.images || [];
        expect(images).toHaveLength(1);
        expect(storedFiles()).toContain(path.basename(images[0]));
    });

    test('A (OWNER) on C → 201, farm.entityId = C', async () => {
        const res = await postFarm('A', { entityId: fx.entities.C });
        expect(res.status).toBe(201);
        expect((await raw.farm.findUnique({ where: { id: res.body.data.id } })).entityId).toBe(fx.entities.C);
    });

    test('the body names the holder: A with body C → farm on C (there is no workspace header since R2 Task 12)', async () => {
        const res = await postFarm('A', { entityId: fx.entities.C });
        expect(res.status).toBe(201);
        expect((await raw.farm.findUnique({ where: { id: res.body.data.id } })).entityId).toBe(fx.entities.C);
    });

    // ── the legacy /api/wizard door is gone ────────────────────────────────
    test('GET /api/wizard/* → 404 with ENABLE_PROVIDER_LEGACY_ALIAS=true', async () => {
        expect(process.env.ENABLE_PROVIDER_LEGACY_ALIAS).toBe('true');
        expect((await request(app).get('/api/wizard/config')).status).toBe(404);
        expect((await request(app).get('/api/wizard/draft').set(auth('A'))).status).toBe(404);
        expect((await request(app).get('/api/wizard/admin/steps').set(auth('F'))).status).toBe(404);
    });

    test('POST /api/wizard/submit and /prepare → 404 and create nothing', async () => {
        const before = await snapshot();
        const apps = await raw.application.count();
        for (const door of ['/api/wizard/submit', '/api/wizard/prepare', '/api/wizard/draft']) {
            const res = await request(app).post(door).set(auth('A'))
                .send({ farmData: { farmName: 'x' }, applicantData: {}, plots: [] });
            expect(res.status).toBe(404);
        }
        expect(await raw.application.count()).toBe(apps);
        await expectNothingWritten(before);
    });

    test('the same flag still mounts /provider-cms (only the /wizard line went)', async () => {
        // The alias router stamps Deprecation on everything it forwards.
        const res = await request(app).get('/api/provider-cms/applications');
        expect(res.headers.deprecation).toBe('true');
    });
});
