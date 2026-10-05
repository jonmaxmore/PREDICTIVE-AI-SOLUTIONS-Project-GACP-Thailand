/**
 * /api/provider/admin/work-config integration tests — ADR-016 Phase 1D.
 *
 * Verifies the admin-only work-queue config surfaces:
 *  - GET / returns stage configs + SLA policies + workflowStages + groups
 *  - POST /stage-configs validates workflowStage, workType, candidateGroup
 *  - PUT /stage-configs/:id updates allowed fields, audit-logs the change
 *  - DELETE /stage-configs/:id removes the row
 *  - PUT /sla-policies/:workType validates hour bounds + cross-field
 *  - All endpoints reject non-admin callers
 */

'use strict';

const request = require('supertest');
const express = require('express');

jest.mock('../../services/prisma-database', () => ({
    prisma: {
        stageActivityConfig: {
            findMany: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
            delete: jest.fn(),
            findUnique: jest.fn(),
            upsert: jest.fn(),
        },
        slaPolicy: {
            findMany: jest.fn(),
            update: jest.fn(),
            upsert: jest.fn(),
        },
        $transaction: jest.fn(async (cb) => cb({
            stageActivityConfig: {
                upsert: jest.fn(async () => ({ id: 'sac-mock' })),
            },
            slaPolicy: {
                upsert: jest.fn(async () => ({ id: 'sla-mock' })),
            },
        })),
    },
}));

jest.mock('../../middleware/audit-logger', () => ({
    auditLogger: { log: jest.fn().mockResolvedValue(null) },
    AuditCategory: { ADMIN: 'ADMIN' },
    AuditSeverity: { INFO: 'INFO' },
    ResourceType: { SYSTEM: 'SYSTEM' },
}));

jest.mock('../../middleware/auth-middleware', () => ({
    authenticateProvider: (req, _res, next) => next(),
    requireRole: () => (req, _res, next) => next(),
}));

jest.mock('../../shared/logger', () => ({
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
    stream: { write: jest.fn() },
    createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

const { prisma } = require('../../services/prisma-database');
const { auditLogger } = require('../../middleware/audit-logger');
const router = require('../../routes/api/provider/admin-work-config');

function buildApp(role = 'system_admin_dtam') {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.user = { id: 'u-admin', email: 'admin@example.com', role, canonicalRole: role };
        next();
    });
    app.use('/wc', router);
    return app;
}

beforeEach(() => {
    jest.clearAllMocks();
});

describe('GET /', () => {
    test('returns stage configs + SLA policies + reference lists', async () => {
        prisma.stageActivityConfig.findMany.mockResolvedValue([
            { id: 'sac-1', workflowStage: 'AUDIT_CONFIRMED', workType: 'FIELD_AUDIT', candidateGroup: 'field_inspector', isActive: true },
        ]);
        prisma.slaPolicy.findMany.mockResolvedValue([
            { id: 'sla-1', workType: 'FIELD_AUDIT', targetHours: 336, warningHours: 240, escalationHours: 504, isActive: true },
        ]);
        const res = await request(buildApp()).get('/wc/');
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.stageConfigs).toHaveLength(1);
        expect(res.body.data.slaPolicies).toHaveLength(1);
        expect(Array.isArray(res.body.data.workflowStages)).toBe(true);
        expect(res.body.data.candidateGroups).toEqual(expect.arrayContaining(['field_inspector', 'system_admin_dtam']));
    });

    test('rejects non-admin callers', async () => {
        const res = await request(buildApp('field_inspector')).get('/wc/');
        expect(res.status).toBe(403);
    });
});

describe('POST /stage-configs', () => {
    test('rejects unknown workflowStage', async () => {
        const res = await request(buildApp())
            .post('/wc/stage-configs')
            .send({ workflowStage: 'NOT_A_STAGE', workType: 'X', candidateGroup: 'field_inspector' });
        expect(res.status).toBe(400);
    });

    test('rejects missing candidateGroup', async () => {
        const res = await request(buildApp())
            .post('/wc/stage-configs')
            .send({ workflowStage: 'AUDIT_CONFIRMED', workType: 'X', candidateGroup: '' });
        expect(res.status).toBe(400);
    });

    test('creates and audit-logs', async () => {
        prisma.stageActivityConfig.create.mockResolvedValue({
            id: 'sac-new', workflowStage: 'AUDIT_CONFIRMED', workType: 'NEW_TYPE', candidateGroup: 'field_inspector', isActive: true,
        });
        const res = await request(buildApp())
            .post('/wc/stage-configs')
            .send({
                workflowStage: 'AUDIT_CONFIRMED',
                workType: 'NEW_TYPE',
                candidateGroup: 'field_inspector',
                labelTH: 'ทดสอบ',
                labelEN: 'Test',
            });
        expect(res.status).toBe(200);
        expect(res.body.data.id).toBe('sac-new');
        expect(auditLogger.log).toHaveBeenCalledWith(
            expect.objectContaining({ action: 'WORK_CONFIG_STAGE_CREATED' }),
        );
    });

    test('translates P2002 unique conflict to 409', async () => {
        prisma.stageActivityConfig.create.mockRejectedValue({ code: 'P2002' });
        const res = await request(buildApp())
            .post('/wc/stage-configs')
            .send({ workflowStage: 'AUDIT_CONFIRMED', workType: 'FIELD_AUDIT', candidateGroup: 'field_inspector' });
        expect(res.status).toBe(409);
    });
});

describe('PUT /stage-configs/:id', () => {
    test('rejects empty body', async () => {
        const res = await request(buildApp()).put('/wc/stage-configs/sac-1').send({});
        expect(res.status).toBe(400);
    });

    test('updates labelTH + audit-logs', async () => {
        prisma.stageActivityConfig.update.mockResolvedValue({ id: 'sac-1', labelTH: 'ใหม่' });
        const res = await request(buildApp())
            .put('/wc/stage-configs/sac-1')
            .send({ labelTH: 'ใหม่' });
        expect(res.status).toBe(200);
        expect(prisma.stageActivityConfig.update).toHaveBeenCalledWith(
            expect.objectContaining({ where: { id: 'sac-1' }, data: { labelTH: 'ใหม่' } }),
        );
        expect(auditLogger.log).toHaveBeenCalledWith(
            expect.objectContaining({ action: 'WORK_CONFIG_STAGE_UPDATED' }),
        );
    });

    test('returns 404 when row missing (P2025)', async () => {
        prisma.stageActivityConfig.update.mockRejectedValue({ code: 'P2025' });
        const res = await request(buildApp())
            .put('/wc/stage-configs/missing')
            .send({ isActive: false });
        expect(res.status).toBe(404);
    });
});

describe('DELETE /stage-configs/:id', () => {
    test('returns 404 when not found', async () => {
        prisma.stageActivityConfig.findUnique.mockResolvedValue(null);
        const res = await request(buildApp()).delete('/wc/stage-configs/missing');
        expect(res.status).toBe(404);
    });

    test('deletes + audit-logs', async () => {
        prisma.stageActivityConfig.findUnique.mockResolvedValue({
            id: 'sac-1', workflowStage: 'AUDIT_CONFIRMED', workType: 'FIELD_AUDIT',
        });
        prisma.stageActivityConfig.delete.mockResolvedValue({});
        const res = await request(buildApp()).delete('/wc/stage-configs/sac-1');
        expect(res.status).toBe(200);
        expect(prisma.stageActivityConfig.delete).toHaveBeenCalled();
        expect(auditLogger.log).toHaveBeenCalledWith(
            expect.objectContaining({ action: 'WORK_CONFIG_STAGE_DELETED' }),
        );
    });
});

describe('GET /export', () => {
    test('returns shape ready for re-import', async () => {
        prisma.stageActivityConfig.findMany.mockResolvedValue([
            { workflowStage: 'AUDIT_CONFIRMED', workType: 'FIELD_AUDIT', candidateGroup: 'field_inspector', isActive: true, displayOrder: 0, labelTH: 'x', labelEN: 'x', descriptionTH: null },
        ]);
        prisma.slaPolicy.findMany.mockResolvedValue([
            { workType: 'FIELD_AUDIT', targetHours: 336, warningHours: 240, escalationHours: 504, labelTH: 'x', labelEN: 'x', isActive: true },
        ]);
        const res = await request(buildApp()).get('/wc/export');
        expect(res.status).toBe(200);
        expect(res.body.data.exportedAt).toBeDefined();
        expect(res.body.data.stageConfigs).toHaveLength(1);
        expect(res.body.data.slaPolicies).toHaveLength(1);
    });
});

describe('POST /import', () => {
    test('rejects empty body', async () => {
        const res = await request(buildApp()).post('/wc/import').send({});
        expect(res.status).toBe(400);
    });

    test('rejects unknown workflowStage', async () => {
        const res = await request(buildApp()).post('/wc/import').send({
            stageConfigs: [{ workflowStage: 'NOT_A_STAGE', workType: 'X', candidateGroup: 'field_inspector' }],
        });
        expect(res.status).toBe(400);
    });

    test('rejects warningHours >= targetHours in SLA', async () => {
        const res = await request(buildApp()).post('/wc/import').send({
            slaPolicies: [{ workType: 'FIELD_AUDIT', targetHours: 24, warningHours: 24 }],
        });
        expect(res.status).toBe(400);
    });

    test('upserts valid config + audit-logs once for the whole import', async () => {
        const res = await request(buildApp()).post('/wc/import').send({
            stageConfigs: [
                { workflowStage: 'AUDIT_CONFIRMED', workType: 'FIELD_AUDIT', candidateGroup: 'field_inspector' },
            ],
            slaPolicies: [
                { workType: 'FIELD_AUDIT', targetHours: 336, warningHours: 240 },
            ],
        });
        expect(res.status).toBe(200);
        expect(res.body.data.stagesUpserted).toBe(1);
        expect(res.body.data.slaUpserted).toBe(1);
        // Single audit entry summarizes the import
        const calls = auditLogger.log.mock.calls.filter(
            ([entry]) => entry.action === 'WORK_CONFIG_BULK_IMPORTED',
        );
        expect(calls).toHaveLength(1);
    });
});

describe('PUT /sla-policies/:workType', () => {
    test('rejects targetHours below floor', async () => {
        const res = await request(buildApp())
            .put('/wc/sla-policies/FIELD_AUDIT')
            .send({ targetHours: 0 });
        expect(res.status).toBe(400);
    });

    test('rejects targetHours above ceiling', async () => {
        const res = await request(buildApp())
            .put('/wc/sla-policies/FIELD_AUDIT')
            .send({ targetHours: 99999 });
        expect(res.status).toBe(400);
    });

    test('rejects warningHours >= targetHours', async () => {
        const res = await request(buildApp())
            .put('/wc/sla-policies/FIELD_AUDIT')
            .send({ targetHours: 24, warningHours: 24 });
        expect(res.status).toBe(400);
    });

    test('updates within bounds + audit-logs', async () => {
        prisma.slaPolicy.update.mockResolvedValue({
            id: 'sla-1', workType: 'FIELD_AUDIT', targetHours: 168, warningHours: 100,
        });
        const res = await request(buildApp())
            .put('/wc/sla-policies/FIELD_AUDIT')
            .send({ targetHours: 168, warningHours: 100 });
        expect(res.status).toBe(200);
        expect(auditLogger.log).toHaveBeenCalledWith(
            expect.objectContaining({ action: 'WORK_CONFIG_SLA_UPDATED' }),
        );
    });

    test('returns 404 when no policy exists for workType', async () => {
        prisma.slaPolicy.update.mockRejectedValue({ code: 'P2025' });
        const res = await request(buildApp())
            .put('/wc/sla-policies/UNKNOWN')
            .send({ targetHours: 24 });
        expect(res.status).toBe(404);
    });
});
