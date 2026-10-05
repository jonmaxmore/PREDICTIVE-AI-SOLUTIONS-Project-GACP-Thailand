'use strict';

/**
 * C4 (operator 2026-09-30 "ทำทางแยก") — the planting-activity page uploads its
 * attachments through its own door under the planting-cycle router, scoped to a
 * cycle the caller may write, instead of riding on /applications/draft-documents
 * (which found or created an Application draft to hang the file on).
 *
 * Real Postgres, the real prisma-database client, the real tenant-context
 * middleware, the real farm gates and the read witness in THROW
 * mode. Only authentication is attached by hand.
 *
 * Fixture: company C holds the farm and its cycle. M is a MANAGER of C (holds the
 * ACTIVITY_* capabilities by role default), V a VIEWER of C (holds none), S a
 * stranger with no membership. R2 Task 12: no actor sends a workspace header;
 * membership alone decides.
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const PDFDocument = require('pdfkit');
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

const sharedLogger = require('../../shared/logger');
const witnessConfig = require('../../config/holder-read-witness');

function setMode(mode) {
    if (mode === undefined) { delete process.env.HOLDER_READ_WITNESS; }
    else { process.env.HOLDER_READ_WITNESS = mode; }
    witnessConfig.resetHolderReadWitnessModeCache();
}

const UPLOADS_ROOT = path.join(__dirname, '..', '..', 'public');

d('planting attachment door: its own door under the cycle, gated by the farm (real Postgres)', () => {
    /** @type {import('@prisma/client').PrismaClient} */
    let raw;
    let app;
    let warn;
    let tmpDir;
    let pdf;
    const sfx = crypto.randomUUID().slice(0, 8);
    const fx = { userIds: [], entityIds: [] };
    const ORIGINAL_MODE = process.env.HOLDER_READ_WITNESS;

    const witnessLogs = () => warn.mock.calls
        .map((c) => c[1])
        .filter((m) => m && m.signal === 'HEALTH_READ_UNSCOPED')
        .map((m) => `${m.model}.${m.op} ${m.route || ''}`);

    const mkUser = async (name) => {
        const id = crypto.randomUUID();
        const canonicalId = `pa-${name}-${sfx}`;
        await raw.user.create({
            data: {
                id, canonicalId, healthId: canonicalId, password: 'x', role: 'health', authType: 'EMAIL_LEGACY',
                email: `pa-${name}-${sfx}@example.test`, firstName: 'ทดสอบ', lastName: name, organizationId: fx.org,
            },
        });
        fx.userIds.push(id);
        return { id, canonicalId };
    };
    const as = (u) => {
        mockActor.current = { id: u.id, canonicalId: u.canonicalId, healthId: u.canonicalId, role: 'health', canonicalRole: 'health', organizationId: fx.org };
    };
    const onC = () => ({});
    const door = () => `/api/planting-cycles/${fx.cycle}/attachments`;
    const upload = (headers = {}) => request(app).post(`${door()}?activityType=IRRIGATION`).set(headers).attach('file', pdf);
    const applicationCount = () => raw.application.count({ where: { organizationId: fx.org } });
    const liveAttachments = () => raw.attachment.findMany({ where: { resId: fx.cycle, isDeleted: false } });
    // Files on disk in the folder both upload doors write to. A refusal must leave this count unchanged.
    const DRAFTS_DIR = path.join(UPLOADS_ROOT, 'uploads', 'application-drafts');
    const storedFileCount = () => (fs.existsSync(DRAFTS_DIR) ? fs.readdirSync(DRAFTS_DIR).length : 0);

    const writePdf = async (file) => {
        await new Promise((resolve, reject) => {
            const doc = new PDFDocument();
            const out = fs.createWriteStream(file);
            doc.pipe(out);
            doc.fontSize(14).text('Irrigation record - planting attachment fixture '.repeat(200));
            doc.end();
            out.on('finish', resolve);
            out.on('error', reject);
        });
        return file;
    };

    beforeAll(async () => {
        raw = new PrismaClient();
        await raw.$connect();
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'planting-attachment-'));
        pdf = await writePdf(path.join(tmpDir, 'irrigation.pdf'));
        fx.org = (await raw.organization.create({ data: { name: `pa-${sfx}`, slug: `pa-${sfx}`, code: `PA_${sfx}`.toUpperCase() } })).id;
        fx.A = await mkUser('owner');
        fx.M = await mkUser('manager');
        fx.V = await mkUser('viewer');
        fx.S = await mkUser('stranger');
        fx.M2 = await mkUser('manager2');
        fx.C = (await raw.entity.create({ data: { type: 'JURISTIC', displayName: `บริษัท pa ${sfx} จำกัด`, organizationId: fx.org } })).id;
        fx.entityIds.push(fx.C);
        for (const [u, role] of [[fx.A, 'OWNER'], [fx.M, 'MANAGER'], [fx.V, 'VIEWER'], [fx.M2, 'MANAGER']]) {
            await raw.entityMembership.create({ data: { userId: u.id, entityId: fx.C, role, status: 'ACTIVE', organizationId: fx.org } });
        }
        fx.farm = (await raw.farm.create({
            data: {
                ownerId: fx.A.id, farmName: `ฟาร์ม pa ${sfx}`, farmType: 'CULTIVATION', address: '1', province: 'สมุทรปราการ',
                district: 'บางพลี', subDistrict: 'บางพลีใหญ่', postalCode: '10540', totalArea: 1, cultivationArea: 1,
                cultivationMethod: 'OUTDOOR', organizationId: fx.org, entityId: fx.C,
            },
        })).id;
        fx.species = (await raw.plantSpecies.create({ data: { code: `P${sfx}`.slice(0, 8).toUpperCase(), nameTH: 'ทดสอบ' } })).id;
        fx.cycle = (await raw.plantingCycle.create({
            data: { cycleName: 'รอบที่ 1', farmId: fx.farm, plantSpeciesId: fx.species, startDate: new Date(), organizationId: fx.org },
        })).id;

        fx.mMembership = (await raw.entityMembership.findUnique({ where: { userId_entityId: { userId: fx.M.id, entityId: fx.C } } })).id;
        fx.farmS = (await raw.farm.create({
            data: {
                ownerId: fx.S.id, farmName: `ฟาร์มส่วนตัว pa ${sfx}`, farmType: 'CULTIVATION', address: '2', province: 'สมุทรปราการ',
                district: 'บางพลี', subDistrict: 'บางพลีใหญ่', postalCode: '10540', totalArea: 1, cultivationArea: 1,
                cultivationMethod: 'OUTDOOR', organizationId: fx.org,
            },
        })).id;
        fx.cycleS = (await raw.plantingCycle.create({
            data: { cycleName: 'รอบของคนอื่น', farmId: fx.farmS, plantSpeciesId: fx.species, startDate: new Date(), organizationId: fx.org },
        })).id;
        fx.cycleB = (await raw.plantingCycle.create({
            data: { cycleName: 'รอบที่ 2', farmId: fx.farm, plantSpeciesId: fx.species, startDate: new Date(), organizationId: fx.org },
        })).id;

        app = express();
        app.use(express.json());
        app.use('/api/planting-cycles', require('../../routes/api/cultivation/planting-cycles'));
    });

    afterAll(async () => {
        setMode(ORIGINAL_MODE);
        if (tmpDir) { fs.rmSync(tmpDir, { recursive: true, force: true }); }
        if (!raw) { return; }
        const rows = await raw.attachment.findMany({ where: { organizationId: fx.org }, select: { fileUrl: true } }).catch(() => []);
        for (const { fileUrl } of rows) {
            if (/^\/uploads\/application-drafts\/[\w.-]+$/.test(fileUrl)) {
                fs.rmSync(path.join(UPLOADS_ROOT, fileUrl), { force: true });
            }
        }
        // Never delete with an undefined key: Prisma drops it and the filter matches every row.
        const wipe = async (model, where) => {
            if (!raw[model] || Object.values(where).some((v) => v === undefined || v === null)) { return; }
            await raw[model].deleteMany({ where }).catch(() => {});
        };
        await wipe('attachment', { organizationId: fx.org });
        const cycles = [fx.cycle, fx.cycleB, fx.cycleS].filter(Boolean);
        await wipe('cultivationLog', { cycleId: { in: cycles } });
        await wipe('entityMemberPermissionGrant', { organizationId: fx.org });
        await wipe('plantingCycle', { id: { in: cycles } });
        await wipe('farm', { organizationId: fx.org });
        await wipe('plantSpecies', { id: fx.species });
        await wipe('application', { organizationId: fx.org });
        await wipe('entityMembership', { entityId: { in: fx.entityIds } });
        await wipe('entity', { id: { in: fx.entityIds } });
        await wipe('user', { id: { in: fx.userIds } });
        await wipe('organization', { id: fx.org });
        await raw.$disconnect();
    });

    beforeEach(() => {
        setMode('throw');
        warn = jest.spyOn(sharedLogger, 'warn');
    });
    afterEach(() => { if (warn) { warn.mockRestore(); } });

    test('a member holding the activity capability uploads (201) and deletes (200); the bytes and the row go', async () => {
        as(fx.M);
        const up = await upload(onC());
        expect(up.status).toBe(201);
        // The shape the planting-activities hook reads today.
        expect(up.body.success).toBe(true);
        expect(typeof up.body.data.documentId).toBe('string');
        expect(up.body.data.fileName).toBe('irrigation.pdf');
        expect(up.body.data.fileUrl).toMatch(/^\/uploads\/application-drafts\/[\w.-]+$/);
        const stored = path.join(UPLOADS_ROOT, up.body.data.fileUrl);
        expect(fs.existsSync(stored)).toBe(true);

        const row = await raw.attachment.findUnique({ where: { id: up.body.data.documentId } });
        expect(row).toMatchObject({ resModel: 'PlantingCycle', resId: fx.cycle, uploadedBy: fx.M.id, isDeleted: false, organizationId: fx.org });

        const del = await request(app).delete(`${door()}/${up.body.data.documentId}`).set(onC());
        expect(del.status).toBe(200);
        expect(del.body).toMatchObject({ success: true, data: { documentId: up.body.data.documentId, deleted: true } });
        expect((await raw.attachment.findUnique({ where: { id: up.body.data.documentId } })).isDeleted).toBe(true);
        expect(fs.existsSync(stored)).toBe(false);
        expect(witnessLogs()).toEqual([]);
    });

    test('the upload creates no Application row', async () => {
        as(fx.M);
        const before = await applicationCount();
        const up = await upload(onC());
        expect(up.status).toBe(201);
        expect(await applicationCount()).toBe(before);
    });

    test('a VIEWER of the farm\'s holder is refused with 403 on upload and on delete, and nothing is stored (no row, no file)', async () => {
        as(fx.M);
        const target = await upload(onC());
        expect(target.status).toBe(201);
        const liveBefore = (await liveAttachments()).length;
        const filesBefore = storedFileCount();

        as(fx.V);
        const up = await upload(onC());
        expect(up.status).toBe(403);
        expect(up.body.code).toBe('ENTITY_PERMISSION_DENIED');
        const del = await request(app).delete(`${door()}/${target.body.data.documentId}`).set(onC());
        expect(del.status).toBe(403);
        // Round 2 (b): a VIEWER is neither the uploader nor the farm's OWNER.
        expect(del.body.code).toBe('ATTACHMENT_OWNERSHIP_DENIED');
        expect((await liveAttachments()).length).toBe(liveBefore);
        expect(storedFileCount()).toBe(filesBefore);
        expect(witnessLogs()).toEqual([]);
    });

    test('a stranger gets the cycle gate\'s 404 on upload and on delete, and nothing changes (no row, no file)', async () => {
        as(fx.M);
        const target = await upload(onC());
        expect(target.status).toBe(201);
        const liveBefore = (await liveAttachments()).length;
        const filesBefore = storedFileCount();

        as(fx.S);
        const up = await upload();
        expect(up.status).toBe(404);
        expect(up.body.message).toBe('Planting cycle not found');
        const del = await request(app).delete(`${door()}/${target.body.data.documentId}`);
        expect(del.status).toBe(404);
        expect(del.body.message).toBe('Planting cycle not found');
        expect((await liveAttachments()).length).toBe(liveBefore);
        expect(storedFileCount()).toBe(filesBefore);
    });

    test('the upload goes through the same content guard as the draft-documents door: a fake PDF is refused and leaves no row and no file', async () => {
        as(fx.M);
        const fake = path.join(tmpDir, 'fake.pdf');
        fs.writeFileSync(fake, 'this is not a pdf at all, just text pretending to be one');
        const liveBefore = (await liveAttachments()).length;
        const filesBefore = storedFileCount();
        const res = await request(app).post(`${door()}?activityType=IRRIGATION`).set(onC()).attach('file', fake);
        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(typeof res.body.code).toBe('string');
        expect((await liveAttachments()).length).toBe(liveBefore);
        expect(storedFileCount()).toBe(filesBefore);
    });

    test('an unknown activityType is refused with 400 before any permission check', async () => {
        as(fx.M);
        const res = await request(app).post(`${door()}?activityType=NOT_A_TYPE`).set(onC()).attach('file', pdf);
        expect(res.status).toBe(400);
        expect(res.body.message).toBe('Invalid activityType');
    });

    test('deleting an attachment that is not on this cycle answers 404', async () => {
        as(fx.M);
        const res = await request(app).delete(`${door()}/${crypto.randomUUID()}`).set(onC());
        expect(res.status).toBe(404);
        expect(res.body.success).toBe(false);
    });
    test('an attachment of cycle B cannot be deleted through cycle A, even by a member who may write both: 404, row and file stay', async () => {
        as(fx.M);
        const onB = await request(app).post(`/api/planting-cycles/${fx.cycleB}/attachments?activityType=IRRIGATION`).set(onC()).attach('file', pdf);
        expect(onB.status).toBe(201);
        const stored = path.join(UPLOADS_ROOT, onB.body.data.fileUrl);
        const filesBefore = storedFileCount();

        const res = await request(app).delete(`${door()}/${onB.body.data.documentId}`).set(onC());
        expect(res.status).toBe(404);
        expect(res.body).toMatchObject({ success: false, message: 'Attachment not found' });
        const row = await raw.attachment.findUnique({ where: { id: onB.body.data.documentId } });
        expect(row).toMatchObject({ resModel: 'PlantingCycle', resId: fx.cycleB, isDeleted: false });
        expect(fs.existsSync(stored)).toBe(true);
        expect(storedFileCount()).toBe(filesBefore);
    });
    // ── Round 2 (a), operator 2026-10-03 "แก้ได้": a saved activity references the
    // attachments this door returns, and only those of the same cycle, live, and
    // uploaded under a capability the caller holds.
    const saveActivity = (cycleId, attachmentIds, headers = onC()) => request(app)
        .post(`/api/planting-cycles/${cycleId}/activities`).set(headers)
        .send({ scope: 'CYCLE', activityType: 'IRRIGATION', attachmentIds });

    test('an activity saved with an attachment from this door is 201 and carries it', async () => {
        as(fx.M);
        const up = await upload(onC());
        expect(up.status).toBe(201);
        const res = await saveActivity(fx.cycle, [up.body.data.documentId]);
        expect(res.status).toBe(201);
        expect(res.body.data.attachmentIds).toEqual([up.body.data.documentId]);
        const log = await raw.cultivationLog.findUnique({ where: { id: res.body.data.id } });
        expect(log.attachmentIds).toEqual([up.body.data.documentId]);
        expect(witnessLogs()).toEqual([]);
    });

    test('an attachment of another cycle is refused (403 ATTACHMENT_OWNERSHIP_DENIED) and nothing is saved', async () => {
        as(fx.M);
        const onB = await request(app).post(`/api/planting-cycles/${fx.cycleB}/attachments?activityType=IRRIGATION`).set(onC()).attach('file', pdf);
        expect(onB.status).toBe(201);
        const before = await raw.cultivationLog.count({ where: { cycleId: fx.cycle } });
        const res = await saveActivity(fx.cycle, [onB.body.data.documentId]);
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('ATTACHMENT_OWNERSHIP_DENIED');
        expect(await raw.cultivationLog.count({ where: { cycleId: fx.cycle } })).toBe(before);
    });

    test('a deleted attachment is refused', async () => {
        as(fx.M);
        const up = await upload(onC());
        expect((await request(app).delete(`${door()}/${up.body.data.documentId}`).set(onC())).status).toBe(200);
        const res = await saveActivity(fx.cycle, [up.body.data.documentId]);
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('ATTACHMENT_OWNERSHIP_DENIED');
    });

    test('another user\'s attachment on a farm the caller cannot reach is refused', async () => {
        as(fx.S);
        const theirs = await request(app).post(`/api/planting-cycles/${fx.cycleS}/attachments?activityType=IRRIGATION`).attach('file', pdf);
        expect(theirs.status).toBe(201);
        as(fx.M);
        expect((await request(app).post(`/api/planting-cycles/${fx.cycleS}/attachments?activityType=IRRIGATION`).set(onC()).attach('file', pdf)).status).toBe(404);
        const res = await saveActivity(fx.cycle, [theirs.body.data.documentId]);
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('ATTACHMENT_OWNERSHIP_DENIED');
    });

    test('an attachment uploaded under a capability the caller no longer holds is refused', async () => {
        as(fx.A);
        const fert = await request(app).post(`${door()}?activityType=FERTILIZER`).set(onC()).attach('file', pdf);
        expect(fert.status).toBe(201);
        await raw.entityMemberPermissionGrant.create({
            data: { membershipId: fx.mMembership, permission: 'ACTIVITY_FERTILIZER', effect: 'REVOKE', organizationId: fx.org },
        });
        try {
            as(fx.M);
            const res = await saveActivity(fx.cycle, [fert.body.data.documentId]);
            expect(res.status).toBe(403);
            expect(res.body.code).toBe('ATTACHMENT_OWNERSHIP_DENIED');
        } finally {
            await raw.entityMemberPermissionGrant.deleteMany({ where: { membershipId: fx.mMembership } });
        }
    });

    test('an id that is no attachment of this door is refused', async () => {
        as(fx.M);
        const res = await saveActivity(fx.cycle, [crypto.randomUUID()]);
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('ATTACHMENT_OWNERSHIP_DENIED');
    });
    // ── Round 2 (b), operator 2026-10-03 "แก้ได้": DELETE is for the uploader (while they
    // still hold the capability) or the farm's OWNER; an attachment a saved activity
    // carries is never deleted (409).
    const del = (id) => request(app).delete(`${door()}/${id}`).set(onC());
    const uploadAs = async (u, type = 'IRRIGATION') => {
        as(u);
        const res = await request(app).post(`${door()}?activityType=${type}`).set(onC()).attach('file', pdf);
        expect(res.status).toBe(201);
        return res.body.data;
    };

    test('another member holding the same capability cannot delete someone else\'s file: 403, row and file stay', async () => {
        const mine = await uploadAs(fx.M);
        as(fx.M2);
        const res = await del(mine.documentId);
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('ATTACHMENT_OWNERSHIP_DENIED');
        expect((await raw.attachment.findUnique({ where: { id: mine.documentId } })).isDeleted).toBe(false);
        expect(fs.existsSync(path.join(UPLOADS_ROOT, mine.fileUrl))).toBe(true);
    });

    test('the farm\'s OWNER can delete a member\'s file', async () => {
        const mine = await uploadAs(fx.M);
        as(fx.A);
        const res = await del(mine.documentId);
        expect(res.status).toBe(200);
        expect((await raw.attachment.findUnique({ where: { id: mine.documentId } })).isDeleted).toBe(true);
        expect(fs.existsSync(path.join(UPLOADS_ROOT, mine.fileUrl))).toBe(false);
    });

    test('the uploader who no longer holds the capability cannot delete their own file', async () => {
        const mine = await uploadAs(fx.M, 'FERTILIZER');
        await raw.entityMemberPermissionGrant.create({
            data: { membershipId: fx.mMembership, permission: 'ACTIVITY_FERTILIZER', effect: 'REVOKE', organizationId: fx.org },
        });
        try {
            as(fx.M);
            const res = await del(mine.documentId);
            expect(res.status).toBe(403);
            expect(res.body.code).toBe('ENTITY_PERMISSION_DENIED');
            expect((await raw.attachment.findUnique({ where: { id: mine.documentId } })).isDeleted).toBe(false);
        } finally {
            await raw.entityMemberPermissionGrant.deleteMany({ where: { membershipId: fx.mMembership } });
        }
    });

    test('an attachment a saved activity carries is not deleted, even by the OWNER: 409 PLANTING_ATTACHMENT_IN_USE in Thai, row and file stay', async () => {
        const mine = await uploadAs(fx.M);
        expect((await saveActivity(fx.cycle, [mine.documentId])).status).toBe(201);
        for (const actor of [fx.M, fx.A]) {
            as(actor);
            const res = await del(mine.documentId);
            expect(res.status).toBe(409);
            expect(res.body.code).toBe('PLANTING_ATTACHMENT_IN_USE');
            expect(res.body.error).toMatch(/[\u0E00-\u0E7F]/);
        }
        expect((await raw.attachment.findUnique({ where: { id: mine.documentId } })).isDeleted).toBe(false);
        expect(fs.existsSync(path.join(UPLOADS_ROOT, mine.fileUrl))).toBe(true);
    });
});
