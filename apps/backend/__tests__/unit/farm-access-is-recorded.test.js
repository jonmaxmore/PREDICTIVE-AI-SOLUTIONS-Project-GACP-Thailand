/**
 * T5 — ม.39: ทุกการเปิดดูข้อมูลฟาร์มของพนักงาน ต้องบันทึกว่าใครเปิดของใครเมื่อไร
 *
 * มติ 2026-09-05 ให้พนักงานติดตามเห็น "ฟาร์มทุกแห่งทั้งประเทศ" — ขอบเขตกว้างขึ้นทำให้
 * หน้าที่ตามกฎหมายหนักขึ้น ไม่ใช่เบาลง PDPA ม.37(1) ให้ผู้ควบคุมข้อมูลต้องป้องกันการเข้าถึง
 * โดยมิชอบ และ ม.39 ให้บันทึก "การเข้าถึง" ไว้ · สิทธิ์ระดับทั้งประเทศที่ไม่มีเครื่องบันทึก
 * ไม่ผ่านทั้งสองข้อ
 *
 * สองอย่างที่ตัดสินรูปร่างของโค้ดนี้:
 *
 * **บันทึกจากสิ่งที่ถูก "ส่งออกไปจริง" ไม่ใช่สิ่งที่ถูก "ขอ"** — คำขอที่ได้ 404 กลับไป
 * ไม่ได้เข้าถึงอะไรเลย การบันทึกมันคือการกล่าวหาคนที่ยังไม่ได้เห็นอะไร · มิดเดิลแวร์จึงอ่าน
 * body ที่กำลังจะถูกส่ง ไม่ใช่ query ที่เข้ามา
 *
 * **ติดที่ router ไม่ใช่ที่ handler** — ถ้าไปเรียกทีละประตู ประตูที่เขียนพรุ่งนี้จะเงียบ
 * โดยไม่มีใครรู้ตัว ซึ่งเป็นกับดักเดิมที่โปรเจกต์นี้เจอมาห้าครั้ง (guard ที่จับ "รูปร่าง"
 * แทน "การประกาศ") · ติดที่ `router.use` แล้วทุกเส้นทางในไฟล์นั้นได้ไปด้วยกันหมด
 *
 * และ log ไม่ใช่สำเนาที่สองของ PII: บันทึก id กับคำค้น ไม่บันทึกชื่อฟาร์มหรือชื่อคน
 */
'use strict';

const express = require('express');
const request = require('supertest');

const mockAuditLog = jest.fn(async () => ({ ok: true }));
const mockLoggerError = jest.fn();

jest.mock('../../middleware/audit-logger', () => ({
    auditLogger: { log: (...a) => mockAuditLog(...a) },
    AuditCategory: { DATA_ACCESS: 'DATA_ACCESS', SECURITY: 'SECURITY' },
    AuditSeverity: { INFO: 'INFO', WARNING: 'WARNING', ERROR: 'ERROR' },
    ResourceType: { FARM: 'FARM' },
}));
// createLogger must be here: prisma-database calls it at import time, and a
// logger mock missing it turns "is the middleware mounted?" into a crash that
// looks like the middleware is missing. Cost an hour once already.
jest.mock('../../shared/logger', () => {
    const l = {
        info: jest.fn(), warn: jest.fn(), debug: jest.fn(),
        error: (...a) => mockLoggerError(...a),
    };
    return { ...l, createLogger: () => l };
});
jest.mock('../../services/prisma-database', () => ({ prisma: {} }));

const { farmIdsIn, recordFarmDataAccess } = require('../../services/farm-access-audit');

const LIST_BODY = {
    success: true,
    data: {
        items: [
            { id: 'cycle-1', farmId: 'farm-1', farm: { id: 'farm-1', farmName: 'สวนลุงมี', province: 'เชียงใหม่' },
              cyclePlots: [{ id: 'cp-1', plot: { id: 'plot-9', name: 'แปลง 1' } }] },
            { id: 'cycle-2', farmId: 'farm-2', farm: { id: 'farm-2', farmName: 'สวนป้าน้อย', province: 'ลำพูน' } },
        ],
        total: 2,
    },
};
const DETAIL_BODY = {
    success: true,
    data: { id: 'cycle-1', farmId: 'farm-7', farm: { id: 'farm-7', farmName: 'สวนเดียว' } },
};

function appWith(handler, { user } = {}) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.user = user === null ? undefined : (user || { id: 'officer-1', canonicalRole: 'auditor', organizationId: 'org-1' });
        next();
    });
    app.use('/x', recordFarmDataAccess({ surface: 'provider:planting' }), handler);
    return app;
}

beforeEach(() => jest.clearAllMocks());

describe('which farms a response actually carried', () => {
    test('finds every farm in a list, once each', () => {
        expect(farmIdsIn(LIST_BODY).sort()).toEqual(['farm-1', 'farm-2']);
    });

    test('finds the one farm in a detail page', () => {
        expect(farmIdsIn(DETAIL_BODY)).toEqual(['farm-7']);
    });

    test('does not mistake a plot id or a cycle id for a farm', () => {
        const ids = farmIdsIn(LIST_BODY);
        expect(ids).not.toContain('plot-9');
        expect(ids).not.toContain('cycle-1');
        expect(ids).not.toContain('cp-1');
    });

    test('an empty result carries no farm', () => {
        expect(farmIdsIn({ success: true, data: { items: [], total: 0 } })).toEqual([]);
        expect(farmIdsIn(null)).toEqual([]);
        expect(farmIdsIn({ success: false, message: 'not found' })).toEqual([]);
    });
});

describe('the row it writes', () => {
    test('a staff read writes exactly one row naming who read whose data', async () => {
        const app = appWith((_q, res) => res.json(LIST_BODY));
        await request(app).get('/x?q=สมชาย&status=ACTIVE');

        expect(mockAuditLog).toHaveBeenCalledTimes(1);
        const row = mockAuditLog.mock.calls[0][0];
        expect(row).toMatchObject({
            category: 'DATA_ACCESS',
            action: 'FARM_DATA_VIEWED',
            resourceType: 'FARM',
            actorId: 'officer-1',
            actorRole: 'auditor',
            organizationId: 'org-1',
        });
        expect(row.metadata.farmIds.sort()).toEqual(['farm-1', 'farm-2']);
        expect(row.metadata.farmCount).toBe(2);
        expect(row.metadata.surface).toBe('provider:planting');
    });

    test('records the terms the officer searched by — that IS the access', async () => {
        const app = appWith((_q, res) => res.json(LIST_BODY));
        await request(app).get('/x?q=สมชาย&status=ACTIVE');
        expect(mockAuditLog.mock.calls[0][0].metadata.query).toMatchObject({ q: 'สมชาย', status: 'ACTIVE' });
    });

    test('carries no farm name and no owner name — the log is not a second copy of the data', async () => {
        const app = appWith((_q, res) => res.json(LIST_BODY));
        await request(app).get('/x');
        const serialized = JSON.stringify(mockAuditLog.mock.calls[0][0]);
        expect(serialized).not.toContain('สวนลุงมี');
        expect(serialized).not.toContain('สวนป้าน้อย');
    });

    test('a 404 records nothing — nothing was accessed', async () => {
        const app = appWith((_q, res) => res.status(404).json({ success: false, message: 'not found' }));
        await request(app).get('/x/missing');
        expect(mockAuditLog).not.toHaveBeenCalled();
    });

    test('an empty search records nothing — a search that found nobody saw nobody', async () => {
        const app = appWith((_q, res) => res.json({ success: true, data: { items: [], total: 0 } }));
        await request(app).get('/x?q=ไม่มีใคร');
        expect(mockAuditLog).not.toHaveBeenCalled();
    });
});

describe('when the recorder itself fails', () => {
    test('the officer still gets their answer, and the failure is reported loudly', async () => {
        mockAuditLog.mockRejectedValueOnce(new Error('audit table is down'));
        const app = appWith((_q, res) => res.json(DETAIL_BODY));
        const res = await request(app).get('/x/cycle-1');

        expect(res.status).toBe(200);
        expect(res.body.data.farm.id).toBe('farm-7');
        expect(mockLoggerError).toHaveBeenCalled();
        const said = mockLoggerError.mock.calls.map((c) => JSON.stringify(c)).join(' ');
        expect(said).toContain('FARM_DATA_VIEWED');
    });

    test('an anonymous caller is recorded as unknown, not skipped', async () => {
        const app = appWith((_q, res) => res.json(DETAIL_BODY), { user: null });
        await request(app).get('/x/cycle-1');
        expect(mockAuditLog).toHaveBeenCalledTimes(1);
        expect(mockAuditLog.mock.calls[0][0].actorId).toBe('UNKNOWN');
    });
});

describe('it is mounted where the farms actually leave the building', () => {
    test.each([
        ['../../routes/api/provider/planting', 'provider'],
        ['../../routes/api/admin/planting', 'admin'],
    ])('%s carries the recorder in its middleware stack', (modulePath) => {
        jest.isolateModules(() => {
            jest.doMock('../../middleware/auth-middleware', () => {
                const u = (req, _res, next) => { req.user = { id: 'o', canonicalRole: 'admin' }; next(); };
                return { authenticateProvider: u, authenticateHealth: u, authenticateAny: u, requireRole: () => (_q, _s, n) => n() };
            });
            const router = require(modulePath);
            const names = (router.stack || []).map((layer) => layer.handle && layer.handle.name);
            expect(names).toContain('farmDataAccessRecorder');
        });
    });
});
