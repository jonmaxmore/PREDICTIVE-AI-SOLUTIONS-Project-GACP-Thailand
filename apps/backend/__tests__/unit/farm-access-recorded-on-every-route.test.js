/**
 * PDPA ม.39 on the routes the shape-walker cannot see.
 *
 * The T&T scope ruling (2026-09-05) gave a tracking officer every farm in the country and
 * made an access record MANDATORY because of it — "ทุกการเปิดดูต้องบันทึก audit ... เป็น
 * ข้อบังคับ ไม่ใช่ข้อเสนอ" (2026-09-05-tnt-data-scope.md §3, §5.3).
 *
 * T5 mounted the recorder at the ROUTER, deliberately, so a route added later would be
 * covered instead of being silently missed. But the recorder learns WHICH farm was seen by
 * walking the response body for a `farmId` key or a `{id, farmName}` object — and two of the
 * four provider routes carry neither:
 *
 *   GET /:id/activities   → cultivation log rows with `plot: {id, name}` and nothing else
 *   GET /:id/plot-qrs     → cyclePlotId / plotId / plotCode / qrCode rows
 *
 * So an officer could open any farm's cultivation diary or its plot QR codes, nationwide,
 * and no row would record it. The mount was real; the coverage was not. That is the
 * shape-versus-declaration failure again: a guard that matches what a payload HAPPENS to
 * look like protects only the payloads someone happened to check.
 *
 * The fix is a DECLARATION — the handler states which farm it just disclosed, and the
 * recorder honours it — so a route whose payload never mentions a farm is still recorded.
 */
'use strict';

const express = require('express');
const request = require('supertest');

const mockLog = jest.fn(async () => ({ id: 'audit-1' }));
jest.mock('../../middleware/audit-logger', () => ({
    auditLogger: { log: (...a) => mockLog(...a) },
    AuditCategory: { DATA_ACCESS: 'DATA_ACCESS' },
    AuditSeverity: { INFO: 'INFO' },
    ResourceType: { FARM: 'FARM' },
}));
jest.mock('../../shared/logger', () => {
    const l = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    return { ...l, createLogger: () => l };
});

const { recordFarmDataAccess } = require('../../services/farm-access-audit');

function appWith(handler) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.user = { id: 'officer-1', canonicalRole: 'auditor', organizationId: 'org-1' };
        next();
    });
    app.use('/x', recordFarmDataAccess({ surface: 'provider:planting' }), handler);
    return app;
}

/** The real shape of GET /:id/activities — no farm anywhere in it. */
const ACTIVITY_BODY = {
    success: true,
    data: [
        { id: 'log-1', logType: 'WATERING', scope: 'PLOT', plot: { id: 'plot-1', name: 'แปลงที่ 1' } },
        { id: 'log-2', logType: 'FERTILISING', scope: 'PLOT', plot: { id: 'plot-1', name: 'แปลงที่ 1' } },
    ],
    pagination: { page: 1, limit: 20, total: 2, totalPages: 1 },
};

/** The real shape of GET /:id/plot-qrs — plot identity only. */
const PLOT_QR_BODY = {
    success: true,
    data: [{
        cyclePlotId: 'cp-1', plotId: 'plot-1', plotName: 'แปลงที่ 1', plotCode: 'PLOT-0001',
        qrCode: 'QR-1', trackingUrl: 'https://example.test/t/QR-1',
    }],
};

beforeEach(() => jest.clearAllMocks());

describe('a payload that names no farm still records which farm was opened', () => {
    test('the cultivation diary is recorded against the farm it belongs to', async () => {
        await request(appWith((_req, res) => {
            res.locals.auditFarmIds = ['farm-77'];
            res.json(ACTIVITY_BODY);
        })).get('/x/cycle-1/activities').expect(200);

        expect(mockLog).toHaveBeenCalledTimes(1);
        expect(mockLog.mock.calls[0][0]).toMatchObject({
            resourceType: 'FARM',
            resourceId: 'farm-77',
            actorId: 'officer-1',
            metadata: expect.objectContaining({ farmIds: ['farm-77'], farmCount: 1 }),
        });
    });

    test("the plot QR view is recorded too — a plot's code is that farm's data", async () => {
        await request(appWith((_req, res) => {
            res.locals.auditFarmIds = ['farm-88'];
            res.json(PLOT_QR_BODY);
        })).get('/x/cycle-1/plot-qrs').expect(200);

        expect(mockLog).toHaveBeenCalledTimes(1);
        expect(mockLog.mock.calls[0][0].resourceId).toBe('farm-88');
    });

    test('a declared farm and a farm in the body are ONE access, not two rows', async () => {
        await request(appWith((_req, res) => {
            res.locals.auditFarmIds = ['farm-1'];
            res.json({ success: true, data: { farmId: 'farm-1', farm: { id: 'farm-1', farmName: 'สวน' } } });
        })).get('/x/cycle-1').expect(200);

        expect(mockLog).toHaveBeenCalledTimes(1);
        expect(mockLog.mock.calls[0][0].metadata.farmIds).toEqual(['farm-1']);
    });

    test('a declaration that is not a list of ids is ignored, not trusted', async () => {
        await request(appWith((_req, res) => {
            res.locals.auditFarmIds = 'farm-1';       // wrong type
            res.json({ success: true, data: [] });
        })).get('/x/cycle-1/activities').expect(200);

        expect(mockLog).not.toHaveBeenCalled();
    });

    test('a refusal declares nothing and records nothing', async () => {
        await request(appWith((_req, res) => {
            res.status(404).json({ success: false, error: 'Planting cycle not found' });
        })).get('/x/nope/activities').expect(404);

        expect(mockLog).not.toHaveBeenCalled();
    });
});

describe('the two routes that carry no farm actually declare one', () => {
    // grep proves a line exists; this proves the handler REACHES it and puts a farm id there.
    test.each([
        ['providerPlantingCycleActivities', 'listProviderCycleActivities'],
        ['providerPlantingCyclePlotQrs', 'getProviderCyclePlotQrs'],
    ])('%s sets res.locals.auditFarmIds', async (handlerName, serviceMethod) => {
        jest.isolateModules(() => {
            jest.doMock('../../routes/api/provider/handlers/shared', () => ({
                authenticateProvider: (_q, _s, n) => n(),
                requireCanonicalPermission: () => (_q, _s, n) => n(),
                PERMISSIONS: { APPLICATION_VIEW_ALL: 'application.view.all' },
                logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
                toInt: (v, d) => Number(v) || d,
            }));
            jest.doMock('../../services/planting-service', () => ({
                [serviceMethod]: jest.fn(async () => (serviceMethod === 'getProviderCyclePlotQrs'
                    ? { cycle: { id: 'cycle-1', farmId: 'farm-99', cyclePlots: [] }, qrByCyclePlotId: new Map() }
                    : { items: [], total: 0, farmId: 'farm-99' })),
            }));

            const handlers = require('../../routes/api/provider/handlers/planting');
            const chain = handlers[handlerName];
            const handler = chain[chain.length - 1];
            const res = {
                locals: {},
                json: jest.fn(function json() { return this; }),
                status: jest.fn(function status() { return this; }),
            };
            // eslint-disable-next-line no-promise-executor-return
            return handler({ params: { id: 'cycle-1' }, query: {} }, res).then(() => {
                expect(res.locals.auditFarmIds).toEqual(['farm-99']);
            });
        });
    });
});
