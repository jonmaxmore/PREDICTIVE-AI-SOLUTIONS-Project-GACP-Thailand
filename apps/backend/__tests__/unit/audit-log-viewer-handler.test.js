/**
 * Handler tests for audit-log-viewer-handler — verifies the read path now
 * routes through services/audit-trail (canonical service layer) instead of
 * touching prisma.auditLog directly.
 *
 * Pure helpers (buildWhere, csvField) are exercised in
 * __tests__/audit-log-viewer-handler.test.js. This file covers the wired-up
 * handler functions themselves.
 */

'use strict';

function buildRes() {
    const res = {};
    res.status = jest.fn(() => res);
    res.json = jest.fn(() => res);
    res.send = jest.fn(() => res);
    res.setHeader = jest.fn(() => res);
    return res;
}

function loadHandler({ listAuditEvents, exportAuditEvents } = {}) {
    jest.resetModules();

    // shared.js exposes a prisma — we mock the whole module so we don't
    // accidentally exercise the real client.
    jest.doMock('../../routes/api/provider/handlers/shared', () => ({
        prisma: { auditLog: { findMany: jest.fn(), count: jest.fn() } },
        logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
        toInt: (v, dflt, min, max) => {
            const n = Number(v);
            if (!Number.isFinite(n)) {return dflt;}
            return Math.min(Math.max(Math.floor(n), min), max);
        },
        authenticateProvider: (_req, _res, next) => next(),
        requireRole: () => (_req, _res, next) => next(),
        adminRoles: ['ADMIN'],
    }));

    const serviceMock = {
        listAuditEvents: listAuditEvents || jest.fn(),
        exportAuditEvents: exportAuditEvents || jest.fn(),
        getTimelineForApplication: jest.fn(),
    };
    jest.doMock('../../services/audit-trail', () => serviceMock);

    const mod = require('../../routes/api/provider/handlers/audit-log-viewer-handler');
    // adminAuditLogList = [authenticateProvider, requireRole(adminRoles), listAuditLog]
    return {
        listAuditLog: mod.adminAuditLogList[mod.adminAuditLogList.length - 1],
        exportAuditLogCsv: mod.adminAuditLogCsv[mod.adminAuditLogCsv.length - 1],
        serviceMock,
    };
}

describe('audit-log-viewer-handler — listAuditLog', () => {
    test('routes through audit-trail.listAuditEvents (not prisma directly)', async () => {
        const listAuditEvents = jest.fn().mockResolvedValue({
            rows: [{ id: 'a', logId: 'L1' }],
            total: 1,
            page: 1,
            limit: 50,
        });
        const { listAuditLog, serviceMock } = loadHandler({ listAuditEvents });

        const req = { query: { page: '2', limit: '25', category: 'APPLICATION' } };
        const res = buildRes();

        await listAuditLog(req, res);

        expect(serviceMock.listAuditEvents).toHaveBeenCalledTimes(1);
        const callArg = serviceMock.listAuditEvents.mock.calls[0][0];
        // Pagination params propagated correctly.
        expect(callArg.page).toBe(2);
        expect(callArg.limit).toBe(25);
        expect(callArg.maxLimit).toBe(200);
        // where clause derived from buildWhere — category coerced uppercase.
        expect(callArg.where).toEqual({ category: 'APPLICATION' });
        // Service is asked for a specific column whitelist (no leakage).
        expect(callArg.allowedColumns).toEqual(expect.arrayContaining([
            'id', 'logId', 'actorEmail', 'metadata',
        ]));
    });

    test('preserves frontend-facing JSON envelope shape', async () => {
        const listAuditEvents = jest.fn().mockResolvedValue({
            rows: [{ id: 'a' }, { id: 'b' }],
            total: 7,
            page: 1,
            limit: 50,
        });
        const { listAuditLog } = loadHandler({ listAuditEvents });

        const req = { query: {} };
        const res = buildRes();

        await listAuditLog(req, res);

        expect(res.json).toHaveBeenCalledTimes(1);
        const body = res.json.mock.calls[0][0];

        // Top-level envelope unchanged.
        expect(body.success).toBe(true);
        expect(body.data).toEqual([{ id: 'a' }, { id: 'b' }]);
        expect(body.pagination).toEqual({
            total: 7,
            page: 1,
            limit: 50,
            totalPages: 1,
        });
        // Filters block always present, with null defaults.
        expect(body.filters).toEqual({
            actor: null,
            category: null,
            severity: null,
            from: null,
            to: null,
        });
    });

    test('returns 500 with a generic error on service failure (no leakage)', async () => {
        const listAuditEvents = jest.fn().mockRejectedValue(new Error('db down'));
        const { listAuditLog } = loadHandler({ listAuditEvents });

        const req = { query: {} };
        const res = buildRes();

        await listAuditLog(req, res);

        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.json).toHaveBeenCalledWith({
            success: false,
            error: 'Failed to load audit log',
        });
    });
});

describe('audit-log-viewer-handler — exportAuditLogCsv', () => {
    test('routes through audit-trail.exportAuditEvents with the 50k cap', async () => {
        const exportAuditEvents = jest.fn().mockResolvedValue([]);
        const { exportAuditLogCsv, serviceMock } = loadHandler({ exportAuditEvents });

        const req = { query: { severity: 'ERROR' } };
        const res = buildRes();

        await exportAuditLogCsv(req, res);

        expect(serviceMock.exportAuditEvents).toHaveBeenCalledTimes(1);
        const callArg = serviceMock.exportAuditEvents.mock.calls[0][0];
        expect(callArg.maxRows).toBe(50_000);
        expect(callArg.where).toEqual({ severity: 'ERROR' });
        expect(callArg.allowedColumns).toEqual(expect.arrayContaining([
            'createdAt', 'logId', 'actorId', 'metadata',
        ]));
    });

    test('renders a CSV body with UTF-8 BOM + correct headers', async () => {
        const exportAuditEvents = jest.fn().mockResolvedValue([
            {
                createdAt: new Date('2026-05-01T00:00:00.000Z'),
                logId: 'L-001',
                sequenceNumber: 1,
                category: 'APPLICATION',
                action: 'SUBMIT',
                severity: 'INFO',
                actorId: 'u-1',
                actorEmail: 'a@example.com',
                actorRole: 'APPLICANT',
                resourceType: 'APPLICATION',
                resourceId: 'app-1',
                ipAddress: '127.0.0.1',
                result: 'SUCCESS',
                errorCode: null,
                errorMessage: null,
                metadata: { ok: true },
            },
        ]);
        const { exportAuditLogCsv } = loadHandler({ exportAuditEvents });

        const req = { query: {} };
        const res = buildRes();

        await exportAuditLogCsv(req, res);

        expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv; charset=utf-8');
        expect(res.send).toHaveBeenCalledTimes(1);
        const body = res.send.mock.calls[0][0];
        // UTF-8 BOM prefix so Excel reads Thai correctly.
        expect(body.startsWith('﻿')).toBe(true);
        expect(body).toContain('timestamp,logId,sequenceNumber,category,action');
        expect(body).toContain('L-001');
        expect(body).toContain('"{""ok"":true}"');
    });
});
