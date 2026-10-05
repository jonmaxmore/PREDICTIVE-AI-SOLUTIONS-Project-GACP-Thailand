/**
 * Unit tests for admin-application-service force-status / revert flows
 * + audit-trail queryWithFilters helper. Iter 28 (B28-A admin tooling).
 */

'use strict';

const path = require('path');

const prismaPath = path.resolve(__dirname, '../services/prisma-database.js');
const statusWriterPath = path.resolve(__dirname, '../services/application-status-writer.js');

function loadService({ writeStub } = {}) {
    jest.resetModules();
    const updateMock = jest.fn();
    jest.doMock(prismaPath, () => ({
        prisma: {
            application: {
                findFirst: jest.fn(),
                update: updateMock,
            },
        },
    }));
    jest.doMock(statusWriterPath, () => ({
        writeApplicationStatus: writeStub || jest.fn().mockResolvedValue({}),
    }));
    const svc = require('../services/admin-application-service');
    const { prisma } = require(prismaPath);
    const writer = require(statusWriterPath);
    return { svc, prisma, writer };
}

describe('admin-application-service / validateForceStatusInputs', () => {
    test('rejects non-ADMIN actorRole', () => {
        const { svc } = loadService();
        const out = svc.validateForceStatusInputs({
            actorRole: 'auditor',
            toStatus: 'APPROVED',
            reasonCode: 'DATA_CORRECTION',
            reason: 'this is plenty long enough',
        });
        expect(out.ok).toBe(false);
        expect(out.status).toBe(403);
    });

    test('rejects unknown toStatus', () => {
        const { svc } = loadService();
        const out = svc.validateForceStatusInputs({
            actorRole: 'system_admin_dtam',
            toStatus: 'FOO',
            reasonCode: 'DATA_CORRECTION',
            reason: 'this is plenty long enough',
        });
        expect(out.ok).toBe(false);
        expect(out.status).toBe(400);
    });

    test('rejects unknown reasonCode', () => {
        const { svc } = loadService();
        const out = svc.validateForceStatusInputs({
            actorRole: 'system_admin_dtam',
            toStatus: 'APPROVED',
            reasonCode: 'BANANA',
            reason: 'this is plenty long enough',
        });
        expect(out.ok).toBe(false);
        expect(out.status).toBe(400);
    });

    test('rejects short reason (<10 chars)', () => {
        const { svc } = loadService();
        const out = svc.validateForceStatusInputs({
            actorRole: 'system_admin_dtam',
            toStatus: 'APPROVED',
            reasonCode: 'DATA_CORRECTION',
            reason: 'short',
        });
        expect(out.ok).toBe(false);
        expect(out.status).toBe(400);
        expect(out.error.message).toMatch(/at least 10/);
    });

    test('accepts well-formed inputs and uppercases status / code', () => {
        const { svc } = loadService();
        const out = svc.validateForceStatusInputs({
            actorRole: 'system_admin_dtam',
            toStatus: 'approved',
            reasonCode: 'data_correction',
            reason: 'compliance escalation case 9',
        });
        expect(out.ok).toBe(true);
        expect(out.normalized.toStatus).toBe('APPROVED');
        expect(out.normalized.reasonCode).toBe('DATA_CORRECTION');
    });
});

describe('admin-application-service / forceTransitionStatus', () => {
    test('rejects when actorRole is not admin', async () => {
        const { svc } = loadService();
        await expect(svc.forceTransitionStatus({
            applicationId: 'app-1',
            actorId: 'a1',
            actorRole: 'auditor',
            toStatus: 'APPROVED',
            reasonCode: 'DATA_CORRECTION',
            reason: 'this is plenty long enough',
        })).rejects.toMatchObject({ status: 403 });
    });

    test('404 when application missing', async () => {
        const { svc, prisma } = loadService();
        prisma.application.findFirst.mockResolvedValue(null);
        await expect(svc.forceTransitionStatus({
            applicationId: 'missing',
            actorId: 'a1',
            actorRole: 'system_admin_dtam',
            toStatus: 'APPROVED',
            reasonCode: 'DATA_CORRECTION',
            reason: 'this is plenty long enough',
        })).rejects.toMatchObject({ status: 404 });
    });

    test('400 when target status equals current', async () => {
        const { svc, prisma } = loadService();
        prisma.application.findFirst.mockResolvedValue({
            id: 'app-1', applicationNumber: 'GACP-1',
            status: 'APPROVED', formData: {}, workflowHistory: [],
        });
        await expect(svc.forceTransitionStatus({
            applicationId: 'app-1',
            actorId: 'a1',
            actorRole: 'system_admin_dtam',
            toStatus: 'APPROVED',
            reasonCode: 'DATA_CORRECTION',
            reason: 'this is plenty long enough',
        })).rejects.toMatchObject({ status: 400 });
    });

    test('happy path calls writeApplicationStatus with assertTransition=false', async () => {
        const writeStub = jest.fn().mockResolvedValue({});
        const { svc, prisma } = loadService({ writeStub });
        prisma.application.findFirst.mockResolvedValue({
            id: 'app-1',
            applicationNumber: 'GACP-1',
            status: 'SUBMITTED',
            formData: { adminOverrides: [] },
            workflowHistory: [],
        });
        const result = await svc.forceTransitionStatus({
            applicationId: 'app-1',
            actorId: 'admin-1',
            actorRole: 'system_admin_dtam',
            toStatus: 'APPROVED',
            reasonCode: 'COMPLIANCE_ESCALATION',
            reason: 'court order received today',
        });
        expect(writeStub).toHaveBeenCalledTimes(1);
        const args = writeStub.mock.calls[0][0];
        expect(args.assertTransition).toBe(false);
        // A force override is a manual admin escalation, not a real audit
        // outcome, so it MUST opt out of certificate auto-issuance — issuance
        // stays bound to the genuine auditor PASS flow.
        expect(args.autoIssueCertificate).toBe(false);
        expect(args.fromStatus).toBe('SUBMITTED');
        expect(args.toStatus).toBe('APPROVED');
        expect(args.additionalData.formData.adminOverrides).toHaveLength(1);
        expect(result.auditMetadata.actionType).toBe('APPLICATION_FORCE_STATUS');
        expect(result.previousStatus).toBe('SUBMITTED');
        expect(result.nextStatus).toBe('APPROVED');
    });
});

describe('admin-application-service / revertLastTransition', () => {
    test('rejects non-admin', async () => {
        const { svc } = loadService();
        await expect(svc.revertLastTransition({
            applicationId: 'app-1',
            actorId: 'a1',
            actorRole: 'auditor',
            reason: 'revert rationale here',
        })).rejects.toMatchObject({ status: 403 });
    });

    test('rejects short reason', async () => {
        const { svc } = loadService();
        await expect(svc.revertLastTransition({
            applicationId: 'app-1',
            actorId: 'a1',
            actorRole: 'system_admin_dtam',
            reason: 'no',
        })).rejects.toMatchObject({ status: 400 });
    });

    test('400 when no prior transition exists', async () => {
        const { svc, prisma } = loadService();
        prisma.application.findFirst.mockResolvedValue({
            id: 'app-1',
            applicationNumber: 'GACP-1',
            status: 'SUBMITTED',
            formData: {},
            workflowHistory: [],
        });
        await expect(svc.revertLastTransition({
            applicationId: 'app-1',
            actorId: 'a1',
            actorRole: 'system_admin_dtam',
            reason: 'attempt revert without history',
        })).rejects.toMatchObject({ status: 400 });
    });

    test('409 when current status diverged from last transition toStatus', async () => {
        const { svc, prisma } = loadService();
        prisma.application.findFirst.mockResolvedValue({
            id: 'app-1', applicationNumber: 'GACP-1',
            status: 'CERTIFIED',
            formData: {},
            workflowHistory: [
                { action: 'TRANSITION', fromStatus: 'SUBMITTED', toStatus: 'APPROVED' },
            ],
        });
        await expect(svc.revertLastTransition({
            applicationId: 'app-1',
            actorId: 'a1',
            actorRole: 'system_admin_dtam',
            reason: 'cannot revert from CERTIFIED here',
        })).rejects.toMatchObject({ status: 409 });
    });

    test('happy path rolls status back to fromStatus', async () => {
        const writeStub = jest.fn().mockResolvedValue({});
        const { svc, prisma } = loadService({ writeStub });
        prisma.application.findFirst.mockResolvedValue({
            id: 'app-1', applicationNumber: 'GACP-1',
            status: 'APPROVED',
            formData: { adminOverrides: [] },
            workflowHistory: [
                {
                    action: 'ADMIN_FORCE_STATUS',
                    fromStatus: 'SUBMITTED',
                    toStatus: 'APPROVED',
                    timestamp: '2026-05-15T08:00:00Z',
                },
            ],
        });
        const result = await svc.revertLastTransition({
            applicationId: 'app-1',
            actorId: 'admin-1',
            actorRole: 'system_admin_dtam',
            reason: 'admin pressed wrong button',
        });
        expect(writeStub).toHaveBeenCalledTimes(1);
        const args = writeStub.mock.calls[0][0];
        expect(args.fromStatus).toBe('APPROVED');
        expect(args.toStatus).toBe('SUBMITTED');
        expect(args.assertTransition).toBe(false);
        // WF-2: a revert bypasses the SoD guard, so it must never auto-issue a
        // certificate (matters when a revert lands on APPROVED).
        expect(args.autoIssueCertificate).toBe(false);
        expect(result.nextStatus).toBe('SUBMITTED');
        expect(result.auditMetadata.actionType).toBe('APPLICATION_REVERT_LAST_TRANSITION');
        expect(result.auditMetadata.revertedAction).toBe('ADMIN_FORCE_STATUS');
    });
});

describe('admin-application-service / findLastWorkflowTransition', () => {
    test('returns null when history is empty', () => {
        const { svc } = loadService();
        expect(svc.findLastWorkflowTransition([])).toBeNull();
    });

    test('returns the last entry with both from + to status', () => {
        const { svc } = loadService();
        const out = svc.findLastWorkflowTransition([
            { action: 'NOTE', comment: 'no transition' },
            { action: 'TRANSITION', fromStatus: 'SUBMITTED', toStatus: 'APPROVED' },
            { action: 'COMMENT' },
        ]);
        expect(out.toStatus).toBe('APPROVED');
    });

    test('with excludeAdminOverrides skips ADMIN_FORCE_STATUS entries', () => {
        const { svc } = loadService();
        const out = svc.findLastWorkflowTransition([
            { action: 'TRANSITION', fromStatus: 'REGISTERED', toStatus: 'SUBMITTED' },
            { action: 'ADMIN_FORCE_STATUS', fromStatus: 'SUBMITTED', toStatus: 'APPROVED' },
        ], { excludeAdminOverrides: true });
        expect(out.toStatus).toBe('SUBMITTED');
    });
});

describe('audit-trail / queryWithFilters + buildAdminFilterWhere', () => {
    function loadAudit() {
        jest.resetModules();
        const findManyMock = jest.fn().mockResolvedValue([]);
        const countMock = jest.fn().mockResolvedValue(0);
        jest.doMock(prismaPath, () => ({
            prisma: {
                auditLog: {
                    findMany: findManyMock,
                    count: countMock,
                },
            },
        }));
        const svc = require('../services/audit-trail');
        return { svc, findManyMock, countMock };
    }

    test('buildAdminFilterWhere returns empty object when no filters', () => {
        const { svc } = loadAudit();
        expect(svc.buildAdminFilterWhere({})).toEqual({});
    });

    test('buildAdminFilterWhere uppercases category but drops unknown values', () => {
        const { svc } = loadAudit();
        expect(svc.buildAdminFilterWhere({ category: 'application' }))
            .toEqual({ category: 'APPLICATION' });
        expect(svc.buildAdminFilterWhere({ category: 'unknown' })).toEqual({});
    });

    test('buildAdminFilterWhere wires actorId exact-match', () => {
        const { svc } = loadAudit();
        expect(svc.buildAdminFilterWhere({ actorId: 'admin-99' }))
            .toEqual({ actorId: 'admin-99' });
    });

    test('buildAdminFilterWhere applicationId scopes to APPLICATION resource', () => {
        const { svc } = loadAudit();
        expect(svc.buildAdminFilterWhere({ applicationId: 'app-1' }))
            .toEqual({ resourceType: 'APPLICATION', resourceId: 'app-1' });
    });

    test('buildAdminFilterWhere date range coerces ISO strings to Date', () => {
        const { svc } = loadAudit();
        const out = svc.buildAdminFilterWhere({
            dateRange: { from: '2026-05-01', to: '2026-05-16' },
        });
        expect(out.createdAt.gte).toEqual(new Date('2026-05-01'));
        expect(out.createdAt.lte).toEqual(new Date('2026-05-16'));
    });

    test('buildAdminFilterWhere drops invalid dates silently', () => {
        const { svc } = loadAudit();
        const out = svc.buildAdminFilterWhere({
            dateRange: { from: 'banana' },
        });
        expect(out.createdAt).toBeUndefined();
    });

    test('queryWithFilters forwards the built where + applies pagination', async () => {
        const { svc, findManyMock } = loadAudit();
        await svc.queryWithFilters({
            filters: { category: 'admin', actorId: 'admin-99' },
            page: 2,
            limit: 25,
        });
        expect(findManyMock).toHaveBeenCalledTimes(1);
        const call = findManyMock.mock.calls[0][0];
        expect(call.where).toEqual({
            category: 'ADMIN',
            actorId: 'admin-99',
        });
        expect(call.skip).toBe(25); // page 2 of 25
        expect(call.take).toBe(25);
    });
});
