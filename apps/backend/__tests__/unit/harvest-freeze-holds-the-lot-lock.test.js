'use strict';

/**
 * harvest-lock (b) — การแช่แข็งต้องถือล็อกแถวเดียวกับการออกล็อต ตั้งแต่ก่อนนับจนเขียนเสร็จ
 *
 * การออกล็อต (traceability-service.createLotWithQuotaCheck) เปิด interactive transaction
 * แล้ว SELECT … FOR UPDATE แถวของรุ่นก่อนอ่านอะไรทั้งนั้น · แต่ updateBatch กับ
 * recordHarvest "นับล็อตแล้วค่อยเขียน" บน client ตรง ๆ ไม่มีล็อก:
 *
 *   PUT /:id  ──── count = 0 ─────────────────────────── update freshWeight ↑
 *   ออกล็อต         ──── lock ── quota ผ่าน ── create lot ── commit
 *
 * ล็อตที่ออกระหว่าง "นับ" กับ "เขียน" หลุดการแช่แข็งไปได้ · เทสนี้ดูลำดับคำสั่งในธุรกรรม
 * (ล็อกก่อน → นับ → เขียน ทั้งหมดบน client ของธุรกรรม) ตรวจว่าคำสั่งล็อกเป็นคำสั่งเดียวกับ
 * ของการออกล็อต และจำลองการแข่ง: ล็อตถูกออกขณะคำขอแก้ไขรอล็อก ⇒ ต้องเห็นล็อตนั้นและปฏิเสธ
 *
 * การแข่งบน Postgres จริงยังไม่มีในชุดนี้ — ดู evidence/security-wave1-2026-09-17/harvest-lock
 */

const mockLog = [];
const mockDb = { batch: null, lotCount: 0, lockGate: null, lockFindsRow: true };

function mockMakeClient(label) {
    const rec = (op, args) => { mockLog.push({ client: label, op, args }); };
    return {
        harvestBatch: {
            findUnique: async (args) => {
                rec('harvestBatch.findUnique', args);
                return mockDb.batch ? { ...mockDb.batch } : null;
            },
            update: async (args) => {
                rec('harvestBatch.update', args);
                return { ...mockDb.batch, ...args.data };
            },
        },
        lot: {
            count: async (args) => { rec('lot.count', args); return mockDb.lotCount; },
            aggregate: async (args) => { rec('lot.aggregate', args); return { _sum: { totalWeight: 0 } }; },
            create: async (args) => { rec('lot.create', args); return { id: 'lot-new', ...args.data }; },
        },
        $queryRaw: async (strings, ...values) => {
            // whitespace is layout, not SQL — compare the statement itself
            rec('$queryRaw', { sql: strings.join('$?').replace(/\s+/g, ' ').trim(), values });
            if (mockDb.lockGate) { await mockDb.lockGate; }
            return mockDb.batch && mockDb.lockFindsRow ? [{ id: mockDb.batch.id }] : [];
        },
    };
}

jest.mock('../../services/prisma-database', () => {
    const root = mockMakeClient('root');
    root.$transaction = async (fn) => {
        mockLog.push({ client: 'root', op: '$transaction' });
        return fn(mockMakeClient('tx'));
    };
    return { prisma: root };
});
jest.mock('../../shared/logger', () => {
    const l = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    return { ...l, createLogger: () => l };
});
jest.mock('../../middleware/auth-middleware', () => ({
    authenticateHealth: (req, _res, next) => { req.user = { id: 'farmer-1', role: 'health' }; next(); },
}));
jest.mock('../../services/farm-service', () => ({
    listAccessibleFarmIds: async () => ['farm-1'],
}));
jest.mock('../../services/entity-effective-permissions-service', () => ({
    assertFarmActionPermission: async () => ({ allowed: true }),
}));
jest.mock('../../middleware/audit-logger', () => ({
    auditLogger: { log: jest.fn() },
    AuditCategory: {}, AuditSeverity: {}, ResourceType: {},
}));
jest.mock('../../services/storage-service', () => ({
    createUploader: () => ({ single: () => (_req, _res, next) => next() }),
}));
jest.mock('../../services/upload-content-guard', () => ({}));
jest.mock('../../services/qrcode/qrcode-service', () => ({}));

const router = require('../../routes/api/cultivation/harvest-batches');
const traceabilityService = require('../../services/traceability-service');

function callRouter(method, url, body) {
    return new Promise((resolve, reject) => {
        const req = {
            method, url, originalUrl: url, baseUrl: '', path: url,
            body, headers: {}, params: {}, query: {}, cookies: {},
            get: () => undefined, header: () => undefined,
        };
        const res = {
            statusCode: 200,
            headersSent: false,
            locals: {},
            status(code) { this.statusCode = code; return this; },
            set() { return this; },
            setHeader() { return this; },
            getHeader() { return undefined; },
            json(payload) { resolve({ status: this.statusCode, body: payload }); return this; },
            send(payload) { resolve({ status: this.statusCode, body: payload }); return this; },
            end() { resolve({ status: this.statusCode, body: undefined }); return this; },
        };
        router.handle(req, res, (err) => reject(err || new Error(`no route for ${method} ${url}`)));
    });
}

const BATCH = {
    id: 'hb-1', farmId: 'farm-1', organizationId: 'org-1', batchNumber: 'BATCH-2569-000001',
    status: 'RECEIVED', freshWeight: 100, dryWeight: null, qualityGrade: 'A',
    harvestDate: new Date('2026-08-01T00:00:00.000Z'), notes: 'เดิม', isDeleted: false,
};

const steps = () => mockLog.map((e) => `${e.client}:${e.op}`);
const lockCalls = () => mockLog.filter((e) => e.op === '$queryRaw');
const writes = () => mockLog.filter((e) => e.op === 'harvestBatch.update');

async function waitUntil(predicate) {
    for (let i = 0; i < 500 && !predicate(); i += 1) {
        await new Promise((r) => setImmediate(r));
    }
}

// The statement lot issuance locks the batch row with, read from lot issuance itself.
async function lotIssuanceLock() {
    mockLog.length = 0;
    mockDb.batch = { ...BATCH, freshWeight: 0, dryWeight: 0 };
    await traceabilityService.createLotWithQuotaCheck('hb-1', { totalWeight: 1 }).catch(() => undefined);
    const [first] = mockLog.filter((e) => e.client === 'tx');
    mockLog.length = 0;
    mockDb.batch = { ...BATCH };
    return first;
}

beforeEach(() => {
    mockLog.length = 0;
    mockDb.batch = { ...BATCH };
    mockDb.lotCount = 0;
    mockDb.lockGate = null;
    mockDb.lockFindsRow = true;
});

describe('harvest-lock (b) — the freeze check and the write share lot issuance\'s row lock', () => {
    it('lot issuance itself starts its transaction with that lock (the reference this mirrors)', async () => {
        const lock = await lotIssuanceLock();
        expect(lock.op).toBe('$queryRaw');
        expect(lock.args.sql).toMatch(/SELECT\s+"id"\s+FROM\s+"harvest_batches"\s+WHERE\s+"id"\s*=\s*\$\?\s+FOR UPDATE/);
        expect(lock.args.values).toEqual(['hb-1']);
    });

    it('PUT /:id: lock first, then count, then write — all inside one transaction', async () => {
        const res = await callRouter('PUT', '/hb-1', { dryWeight: 48.5 });

        expect(res.status).toBe(200);
        expect(steps()).toEqual([
            'root:harvestBatch.findUnique', // the route's ownership read
            'root:$transaction',
            'tx:$queryRaw',
            'tx:lot.count',
            'tx:harvestBatch.update',
        ]);
        expect(writes()[0].args).toEqual({ where: { id: 'hb-1' }, data: { dryWeight: 48.5 } });
    });

    it('POST /:id/harvest: lock first, then the batch read, the count and the write — one transaction', async () => {
        const res = await callRouter('POST', '/hb-1/harvest', { actualYield: '12.5' });

        expect(res.status).toBe(200);
        expect(steps()).toEqual([
            'root:harvestBatch.findUnique', // the route's ownership read
            'root:$transaction',
            'tx:$queryRaw',
            'tx:harvestBatch.findUnique',
            'tx:lot.count',
            'tx:harvestBatch.update',
        ]);
        expect(writes()[0].args.data).toMatchObject({ freshWeight: 12.5, status: 'HARVESTED' });
    });

    it('both doors take exactly the statement lot issuance takes, on the same row', async () => {
        const reference = await lotIssuanceLock();

        await callRouter('PUT', '/hb-1', { notes: 'แก้บันทึก' });
        await callRouter('POST', '/hb-1/harvest', { notes: 'เก็บแล้ว' });

        const taken = lockCalls().map((e) => e.args);
        expect(taken).toEqual([reference.args, reference.args]);
    });

    it.each([
        ['PUT /:id', 'PUT', '/hb-1', { freshWeight: 900 }],
        ['POST /:id/harvest', 'POST', '/hb-1/harvest', { actualYield: '900' }],
    ])('%s: a lot issued while the edit waits for the row lock is seen, and the edit is refused', async (_door, method, url, body) => {
        let release;
        mockDb.lockGate = new Promise((r) => { release = r; });

        const pending = callRouter(method, url, body);
        // lot issuance holds the row: wait until the edit is either blocked on the
        // lock or has already counted without one
        await waitUntil(() => mockLog.some((e) => e.op === '$queryRaw' || e.op === 'lot.count'));
        mockDb.lotCount = 1; // …and commits its lot, then releases the row
        release();
        const res = await pending;

        expect(res.status).toBe(409);
        expect(res.body.code).toBe('HARVEST_FROZEN_AFTER_PACKING');
        expect(writes()).toEqual([]);
    });

    it('a batch that is gone by the time the lock is taken is 404, with nothing counted or written', async () => {
        mockDb.lockFindsRow = false;
        const res = await callRouter('PUT', '/hb-1', { dryWeight: 5 });

        expect(res.status).toBe(404);
        expect(res.body.code).toBe('NOT_FOUND');
        expect(steps()).not.toContain('tx:lot.count');
        expect(writes()).toEqual([]);
    });
});
