'use strict';

/**
 * N+1 query batching — Step 3 of the post-canonicalization mandate.
 *
 * Six sites survived triage as GENUINE N+1 (out of 36 candidates; the rest
 * are scanner artifacts, bounded config seeds, or per-row semantics like
 * confirm-then-stamp that MUST stay sequential — see the triage table in the
 * PR). Each test pins the query count, not the source text: the assertion is
 * "N rows cost O(1) queries", counted on a mock prisma.
 *
 *   work-activity createForStage   per-config idempotency findFirst + SLA
 *                                  findUnique — runs on EVERY workflow
 *                                  transition (hottest of the six).
 *   subscription renewal cron      per-candidate findFirst + per-candidate
 *                                  invoice findUnique.
 *   survey submitResponse          per-answer create (public farmer path).
 *   survey createTemplate          per-question create.
 *   quote → invoice conversion     per-line-item create.
 *   wizard submission              per-plot create.
 *
 * The tenant-prisma-extension maps organizationId over createMany row arrays
 * (tenant-prisma-extension.js `createMany` hook), so the loop→createMany swaps
 * keep org injection for TENANT_SCOPED models (Plot, InvoiceLineItem).
 */

jest.mock('../../shared/logger', () => {
    const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...l, createLogger: jest.fn(() => l) };
});

// One shared prisma-database mock for every module under test that imports the
// singleton (quote-service). work-activity and the wizard submission methods
// take an injected prisma instead.
const mockSubFindMany = jest.fn();
const mockSubFindFirst = jest.fn();
const mockInvFindMany = jest.fn();
const mockInvFindUnique = jest.fn();
const mockInvoiceCreate = jest.fn();
const mockLineCreate = jest.fn();
const mockLineCreateMany = jest.fn();

jest.mock('../../services/prisma-database', () => ({
    prisma: {
        subscription: {
            findMany: (...a) => mockSubFindMany(...a),
            findFirst: (...a) => mockSubFindFirst(...a),
            updateMany: jest.fn(async () => ({ count: 0 })),
        },
        invoice: {
            findMany: (...a) => mockInvFindMany(...a),
            findUnique: (...a) => mockInvFindUnique(...a),
            create: (...a) => mockInvoiceCreate(...a),
        },
        invoiceLineItem: {
            create: (...a) => mockLineCreate(...a),
            createMany: (...a) => mockLineCreateMany(...a),
        },
        user: { findFirst: jest.fn(async () => null) },
    },
}));

describe('work-activity createForStage — one probe per stage, not per config', () => {
    jest.mock('../../services/work-activity-notifications', () => ({
        notifyAssigned: jest.fn(async () => 0),
        notifyWarning: jest.fn(async () => 0),
        notifyBreach: jest.fn(async () => 0),
        workTypeLabel: (s) => s,
    }));

    const wa = require('../../services/work-activity-service');

    function makePrisma({ configs, openRows, policies }) {
        return {
            stageActivityConfig: { findMany: jest.fn(async () => configs) },
            workActivity: {
                findFirst: jest.fn(async () => null),
                findMany: jest.fn(async () => openRows),
                create: jest.fn(async ({ data }) => ({ id: `wa-${data.workType}`, ...data })),
            },
            slaPolicy: {
                findUnique: jest.fn(async ({ where }) =>
                    policies.find((p) => p.workType === where.workType) || null),
                findMany: jest.fn(async ({ where }) =>
                    policies.filter((p) => where.workType.in.includes(p.workType))),
            },
        };
    }

    test('N configs cost one workActivity probe and one slaPolicy read', async () => {
        const prisma = makePrisma({
            configs: [
                { workType: 'DOC_REVIEW', candidateGroup: 'document_reviewer', displayOrder: 1 },
                { workType: 'AUDIT_VISIT', candidateGroup: 'auditor', displayOrder: 2 },
                { workType: 'ACCOUNT_CHECK', candidateGroup: 'account', displayOrder: 3 },
            ],
            openRows: [],
            policies: [{ workType: 'DOC_REVIEW', targetHours: 72, warningHours: 48 }],
        });

        const created = await wa.createForStage({
            prisma, applicationId: 'app1', toStatus: 'ASSIGNED_FOR_REVIEW', organizationId: 'org1',
        });

        expect(created).toHaveLength(3);
        // The idempotency probe is ONE findMany over all three workTypes.
        expect(prisma.workActivity.findFirst).not.toHaveBeenCalled();
        expect(prisma.workActivity.findMany).toHaveBeenCalledTimes(1);
        // The SLA policies come back in ONE read, not one per config.
        const slaReads = prisma.slaPolicy.findUnique.mock.calls.length
            + prisma.slaPolicy.findMany.mock.calls.length;
        expect(slaReads).toBe(1);
    });

    test('idempotency survives the batching — an open row still suppresses its config', async () => {
        const prisma = makePrisma({
            configs: [
                { workType: 'DOC_REVIEW', candidateGroup: 'document_reviewer', displayOrder: 1 },
                { workType: 'AUDIT_VISIT', candidateGroup: 'auditor', displayOrder: 2 },
            ],
            openRows: [{ workType: 'DOC_REVIEW' }],
            policies: [],
        });

        const created = await wa.createForStage({
            prisma, applicationId: 'app1', toStatus: 'ASSIGNED_FOR_REVIEW', organizationId: 'org1',
        });

        expect(created).toHaveLength(1);
        expect(created[0].workType).toBe('AUDIT_VISIT');
        expect(prisma.workActivity.create).toHaveBeenCalledTimes(1);
    });

    test('SLA policy still lands on dueAt/warningAt after the batch read', async () => {
        const prisma = makePrisma({
            configs: [{ workType: 'DOC_REVIEW', candidateGroup: 'document_reviewer', displayOrder: 1 }],
            openRows: [],
            policies: [{ workType: 'DOC_REVIEW', targetHours: 72, warningHours: 48 }],
        });

        const created = await wa.createForStage({
            prisma, applicationId: 'app1', toStatus: 'ASSIGNED_FOR_REVIEW', organizationId: 'org1',
        });

        expect(created[0].dueAt).toBeInstanceOf(Date);
        expect(created[0].warningAt).toBeInstanceOf(Date);
        expect(created[0].dueAt.getTime()).toBeGreaterThan(created[0].warningAt.getTime());
    });
});

// The 'subscription renewal cron — prefetched probes' block lived here. It
// covered createRenewalInvoicesForDueSubscriptions(), the cron that re-billed
// an expiring membership. M3 (operator 2026-08-23, 'ไม่มีค่าสมาชิก') deleted the
// function and the cron, so there is no N+1 left to guard.


describe('quote → invoice conversion — line items land in one createMany', () => {
    test('N items cost one insert, with the same row shape the loop produced', async () => {
        const quoteService = require('../../services/quote-service');
        mockInvoiceCreate.mockResolvedValue({ id: 'inv1', organizationId: 'orgA' });
        mockLineCreateMany.mockResolvedValue({ count: 2 });

        await quoteService.createInvoiceFromQuote({
            quote: {
                id: 'q1', applicationId: 'app1', subtotal: 100, vat: 7, totalAmount: 107,
                items: [
                    { code: 'DOC_FEE', description: 'ค่าตรวจเอกสาร', quantity: 1, unitPrice: 100, amount: 100, isTaxable: true },
                    { label: 'ส่วนลด', quantity: 1, unitPrice: -20, amount: -20 },
                ],
            },
            invoiceNumber: 'INV-1', healthId: 'HID1', serviceType: 'certification',
        });

        expect(mockLineCreate).not.toHaveBeenCalled();
        expect(mockLineCreateMany).toHaveBeenCalledTimes(1);
        const rows = mockLineCreateMany.mock.calls[0][0].data;
        expect(rows).toHaveLength(2);
        expect(rows[0]).toMatchObject({
            invoiceId: 'inv1', organizationId: 'orgA', lineNumber: 1,
            code: 'DOC_FEE', quantity: 1, unitPrice: 100, amount: 100, isTaxable: true,
        });
        // The loop's fallback shapes survive: label → description, ITEM_n code,
        // amount recomputed from qty × price when absent.
        expect(rows[1]).toMatchObject({
            lineNumber: 2, code: 'ITEM_2', description: 'ส่วนลด', amount: -20, isTaxable: false,
        });
    });
});

describe('wizard submission — plots land in one createMany', () => {
    const { createApplicationSubmissionMethods } =
        require('../../services/application-service/application-submission-methods');

    test('N plots cost one insert inside the submission transaction', async () => {
        const tx = {
            user: { update: jest.fn(async () => ({})) },
            farm: { create: jest.fn(async ({ data }) => ({ id: 'farm1', ...data })) },
            plot: {
                create: jest.fn(),
                createMany: jest.fn(async ({ data }) => ({ count: data.length })),
            },
            application: { create: jest.fn(async ({ data }) => ({ id: 'app1', ...data })) },
            applicationDraft: { deleteMany: jest.fn(async () => ({ count: 0 })) },
        };
        const prisma = { $transaction: jest.fn(async (cb) => cb(tx)) };
        const feeService = {
            calculateApplicationFees: jest.fn(() => ({
                phase1: { total: 5000 }, phase2: { total: 25000 }, scopeCount: 1,
            })),
        };

        const methods = createApplicationSubmissionMethods({ prisma, feeService, logger: console });
        await methods.executeWizardSubmission('u1', 'HID1', {
            applicantData: { firstName: 'ก', lastName: 'ข', address: 'x', province: 'y' },
            farmData: { farmName: 'ฟาร์ม', totalAreaSize: 400, totalAreaUnit: 'SQM' },
            plots: [
                { name: 'แปลง 1', areaSize: 100, areaUnit: 'SQM' },
                { name: 'แปลง 2', areaSize: 150, areaUnit: 'SQM' },
                { name: 'แปลง 3', areaSize: 150, areaUnit: 'SQM' },
            ],
            documents: [],
            cultivationMethods: ['outdoor'],
        });

        expect(tx.plot.create).not.toHaveBeenCalled();
        expect(tx.plot.createMany).toHaveBeenCalledTimes(1);
        const rows = tx.plot.createMany.mock.calls[0][0].data;
        expect(rows).toHaveLength(3);
        expect(rows[0]).toMatchObject({
            farmId: 'farm1', name: 'แปลง 1', area: 100, solarSystem: 'OUTDOOR',
        });
    });
});
