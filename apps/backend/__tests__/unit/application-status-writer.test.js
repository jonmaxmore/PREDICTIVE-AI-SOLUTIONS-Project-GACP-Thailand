/**
 * application-status-writer unit tests — Phase A6 / PR-WF-1.
 *
 * Verifies the canonical status writer's contract:
 *  - Required-args validation
 *  - prisma.application.update called with correct shape
 *  - onAudit callback fires with the right entry
 *  - onAudit failure does NOT throw (best-effort)
 *  - assertTransition strict mode throws on illegal transitions
 */

'use strict';

const path = require('path');

// workflow-transition-service is required lazily inside the writer.
// Mock it via jest.mock so the lazy require sees the stub.
const mockWfState = {
    canTransition: () => true,
    // H1: the writer now syncs formData.workflowState via this normalizer.
    // Identity-upper is enough for the writer's purpose in tests.
    normalizeWorkflowStateInput: (v) => String(v || '').toUpperCase() || null,
};

jest.mock('../../services/workflow-transition-service', () => ({
    canTransition: (...args) => mockWfState.canTransition(...args),
    normalizeWorkflowStateInput: (...args) => mockWfState.normalizeWorkflowStateInput(...args),
}));

// Iter R2 / R2-D — certificate-service is also lazily required. Mock it
// so the cert auto-issuance hook on AUDIT_PASSED transitions can be
// exercised without the heavy prisma + crypto dependency tree.
const mockCertState = {
    findCertificateForApplication: jest.fn(async () => null),
    generateCertificate: jest.fn(async () => ({ id: 'cert-default', certificateNumber: 'GACP-TEST' })),
};
jest.mock('../../services/certificate-service', () => ({
    findCertificateForApplication: (...args) => mockCertState.findCertificateForApplication(...args),
    generateCertificate: (...args) => mockCertState.generateCertificate(...args),
}));

// Iter R3 / R3-D — audit-logger is also lazily required for the
// CERT_AUTO_GEN_ROLLBACK defence-in-depth emission. I-003 dictates this
// MUST use `logWithin(event, tx)` so the audit row commits atomically
// with the status revert. The mock exposes BOTH `logWithin` AND `log`
// (per I-008) so the writer's lazy require destructure resolves cleanly
// regardless of which entry-point is invoked.
const mockAuditState = {
    logWithin: jest.fn(async () => ({ id: 'audit-row-default' })),
    log: jest.fn(async () => ({ id: 'audit-row-default' })),
};
jest.mock('../../middleware/audit-logger', () => ({
    auditLogger: {
        logWithin: (...args) => mockAuditState.logWithin(...args),
        log: (...args) => mockAuditState.log(...args),
    },
    AuditCategory: { APPLICATION: 'APPLICATION' },
    AuditSeverity: { WARNING: 'WARNING', INFO: 'INFO' },
    ResourceType: { APPLICATION: 'APPLICATION' },
}));

const writerPath = path.resolve(__dirname, '../../services/application-status-writer.js');

function loadWriter() {
    jest.resetModules();
    return require(writerPath);
}

describe('application-status-writer (PR-WF-1)', () => {
    beforeEach(() => {
        mockWfState.canTransition = () => true;
        mockCertState.findCertificateForApplication = jest.fn(async () => null);
        mockCertState.generateCertificate = jest.fn(async () => ({
            id: 'cert-default',
            certificateNumber: 'GACP-TEST',
        }));
        // R3-D: reset audit mocks between cases so call counts/assertions
        // don't leak across tests in the cert-hook suite below.
        mockAuditState.logWithin = jest.fn(async () => ({ id: 'audit-row-default' }));
        mockAuditState.log = jest.fn(async () => ({ id: 'audit-row-default' }));
    });

    function makePrisma() {
        return {
            application: {
                update: jest.fn(async ({ where, data }) => ({ id: where.id, ...data })),
            },
        };
    }

    test('throws when prisma is missing', async () => {
        const { writeApplicationStatus } = loadWriter();
        await expect(
            writeApplicationStatus({ applicationId: 'a', toStatus: 'SUBMITTED' }),
        ).rejects.toThrow(/prisma required/);
    });

    test('throws when applicationId is missing', async () => {
        const { writeApplicationStatus } = loadWriter();
        await expect(
            writeApplicationStatus({ prisma: makePrisma(), toStatus: 'SUBMITTED' }),
        ).rejects.toThrow(/applicationId required/);
    });

    test('throws when toStatus is missing', async () => {
        const { writeApplicationStatus } = loadWriter();
        await expect(
            writeApplicationStatus({ prisma: makePrisma(), applicationId: 'a' }),
        ).rejects.toThrow(/toStatus required/);
    });

    test('calls prisma.application.update with correct shape', async () => {
        const { writeApplicationStatus } = loadWriter();
        const prisma = makePrisma();
        await writeApplicationStatus({
            prisma,
            applicationId: 'app-1',
            fromStatus: 'REGISTERED',
            toStatus: 'SUBMITTED',
            actorId: 'user-7',
        });
        expect(prisma.application.update).toHaveBeenCalledTimes(1);
        const call = prisma.application.update.mock.calls[0][0];
        expect(call.where).toEqual({ id: 'app-1' });
        expect(call.data.status).toBe('SUBMITTED');
        expect(call.data.updatedBy).toBe('user-7');
        expect(call.data.updatedAt).toBeInstanceOf(Date);
    });

    test('merges additionalData into the update', async () => {
        const { writeApplicationStatus } = loadWriter();
        const prisma = makePrisma();
        await writeApplicationStatus({
            prisma,
            applicationId: 'app-2',
            toStatus: 'PAYMENT_1_PAID',
            actorId: 'user-7',
            additionalData: { phase1Status: 'PAID', phase1PaidAt: new Date('2026-04-29') },
        });
        const call = prisma.application.update.mock.calls[0][0];
        expect(call.data.phase1Status).toBe('PAID');
        expect(call.data.phase1PaidAt).toBeInstanceOf(Date);
    });

    test('fires onAudit callback with full entry', async () => {
        const captured = [];
        const onAudit = async (entry) => { captured.push(entry); };
        const { writeApplicationStatus } = loadWriter();
        await writeApplicationStatus({
            prisma: makePrisma(),
            applicationId: 'app-3',
            fromStatus: 'REGISTERED',
            toStatus: 'SUBMITTED',
            actorId: 'user-7',
            actorRole: 'health',
            reason: 'phase1 paid',
            onAudit,
        });
        expect(captured.length).toBe(1);
        expect(captured[0].applicationId).toBe('app-3');
        expect(captured[0].fromStatus).toBe('REGISTERED');
        expect(captured[0].toStatus).toBe('SUBMITTED');
        expect(captured[0].actorRole).toBe('health');
        expect(captured[0].reason).toBe('phase1 paid');
        expect(captured[0].timestamp).toBeInstanceOf(Date);
    });

    test('onAudit not provided is OK (no-op audit)', async () => {
        const { writeApplicationStatus } = loadWriter();
        const prisma = makePrisma();
        const result = await writeApplicationStatus({
            prisma,
            applicationId: 'app-3b',
            toStatus: 'SUBMITTED',
            actorId: 'user-7',
        });
        expect(result.id).toBe('app-3b');
        expect(prisma.application.update).toHaveBeenCalled();
    });

    test('onAudit failure does NOT throw (best-effort)', async () => {
        const onAudit = async () => { throw new Error('audit DB unavailable'); };
        const { writeApplicationStatus } = loadWriter();
        await expect(
            writeApplicationStatus({
                prisma: makePrisma(),
                applicationId: 'app-4',
                toStatus: 'SUBMITTED',
                actorId: 'user-7',
                onAudit,
            }),
        ).resolves.toBeDefined();
    });

    test('assertTransition strict mode throws on illegal transition', async () => {
        mockWfState.canTransition = () => false;
        const { writeApplicationStatus } = loadWriter();
        await expect(
            writeApplicationStatus({
                prisma: makePrisma(),
                applicationId: 'app-5',
                fromStatus: 'DRAFT',
                toStatus: 'CERTIFIED',
                actorId: 'user-7',
                assertTransition: true,
            }),
        ).rejects.toThrow(/illegal transition/);
    });

    test('assertTransition false (default) is permissive — never throws on transition', async () => {
        mockWfState.canTransition = () => false;
        const { writeApplicationStatus } = loadWriter();
        const prisma = makePrisma();
        await expect(
            writeApplicationStatus({
                prisma,
                applicationId: 'app-6',
                fromStatus: 'DRAFT',
                toStatus: 'CERTIFIED',
                actorId: 'user-7',
            }),
        ).resolves.toBeDefined();
        expect(prisma.application.update).toHaveBeenCalled();
    });

    // ─── ADR-016 Phase 1A: work-activity hook ─────────────────────────────
    describe('work-activity emission (ADR-016)', () => {
        function makePrismaWithActivities() {
            const base = makePrisma();
            base.workActivity = {
                create: jest.fn(async ({ data }) => ({ id: 'wa-1', ...data })),
                findFirst: jest.fn(async () => null),
                findMany: jest.fn(async () => []),
                updateMany: jest.fn(async () => ({ count: 0 })),
            };
            base.stageActivityConfig = {
                findMany: jest.fn(async ({ where }) => {
                    if (where.workflowStage === 'AUDIT_CONFIRMED') {
                        return [
                            {
                                workflowStage: 'AUDIT_CONFIRMED',
                                workType: 'FIELD_AUDIT',
                                candidateGroup: 'auditor',
                                displayOrder: 0,
                                isActive: true,
                            },
                        ];
                    }
                    return [];
                }),
            };
            base.slaPolicy = {
                findUnique: jest.fn(async () => null),
                findMany: jest.fn(async () => []),
            };
            // make application.update return organizationId so the hook
            // has somewhere to send the activity to
            base.application.update = jest.fn(async ({ where, data }) => ({
                id: where.id,
                organizationId: 'org-1',
                ...data,
            }));
            return base;
        }

        test('spawns activities matching the new stage', async () => {
            const { writeApplicationStatus } = loadWriter();
            const prisma = makePrismaWithActivities();
            await writeApplicationStatus({
                prisma,
                applicationId: 'app-7',
                fromStatus: 'AUDIT_FEE_PAID',
                toStatus: 'AUDIT_CONFIRMED',
                actorId: 'user-7',
                actorRole: 'scheduler',
            });
            expect(prisma.stageActivityConfig.findMany).toHaveBeenCalledWith(
                expect.objectContaining({ where: { workflowStage: 'AUDIT_CONFIRMED', isActive: true } }),
            );
            expect(prisma.workActivity.create).toHaveBeenCalledTimes(1);
            const call = prisma.workActivity.create.mock.calls[0][0];
            expect(call.data.workType).toBe('FIELD_AUDIT');
            expect(call.data.candidateGroup).toBe('auditor');
            expect(call.data.organizationId).toBe('org-1');
        });

        test('cancels open activities when status reaches a terminal state', async () => {
            const { writeApplicationStatus } = loadWriter();
            const prisma = makePrismaWithActivities();
            await writeApplicationStatus({
                prisma,
                applicationId: 'app-8',
                fromStatus: 'AUDIT_CONFIRMED',
                toStatus: 'REJECTED',
                actorId: 'user-7',
                actorRole: 'auditor',
            });
            expect(prisma.workActivity.updateMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        applicationId: 'app-8',
                        state: { in: ['TODO', 'CLAIMED', 'IN_PROGRESS'] },
                    }),
                    data: expect.objectContaining({ state: 'CANCELLED' }),
                }),
            );
        });

        test('hook failure does NOT block status write (best-effort)', async () => {
            const { writeApplicationStatus } = loadWriter();
            const prisma = makePrismaWithActivities();
            prisma.stageActivityConfig.findMany = jest.fn(async () => {
                throw new Error('config table unavailable');
            });
            await expect(
                writeApplicationStatus({
                    prisma,
                    applicationId: 'app-9',
                    fromStatus: 'AUDIT_FEE_PAID',
                    toStatus: 'AUDIT_CONFIRMED',
                    actorId: 'user-7',
                    actorRole: 'scheduler',
                }),
            ).resolves.toBeDefined();
            expect(prisma.application.update).toHaveBeenCalled();
        });

        test('skips silently when prisma stub has no workActivity (legacy callers)', async () => {
            const { writeApplicationStatus } = loadWriter();
            const prisma = makePrisma(); // no workActivity namespace
            await expect(
                writeApplicationStatus({
                    prisma,
                    applicationId: 'app-10',
                    fromStatus: 'AUDIT_FEE_PAID',
                    toStatus: 'AUDIT_CONFIRMED',
                    actorId: 'user-7',
                    actorRole: 'scheduler',
                }),
            ).resolves.toBeDefined();
        });
    });

    // ─── Iter R2 / R2-D: certificate auto-generation hook ────────────────
    describe('certificate auto-generation hook (R2-D)', () => {
        test('APPROVED with no existing cert calls generateCertificate', async () => {
            mockCertState.findCertificateForApplication = jest.fn(async () => null);
            const generated = { id: 'cert-1', certificateNumber: 'GACP-TH-2569-A1B2C3' };
            mockCertState.generateCertificate = jest.fn(async () => generated);

            const { writeApplicationStatus } = loadWriter();
            const prisma = makePrisma();
            await writeApplicationStatus({
                prisma,
                applicationId: 'app-r2d-1',
                fromStatus: 'AUDIT_PASSED',
                toStatus: 'APPROVED',
                actorId: 'auditor-7',
                actorRole: 'AUDITOR',
            });

            expect(mockCertState.findCertificateForApplication)
                .toHaveBeenCalledWith('app-r2d-1', expect.objectContaining({ prisma: expect.anything() }));
            expect(mockCertState.generateCertificate).toHaveBeenCalledTimes(1);
            const [appId, providerId, options] = mockCertState.generateCertificate.mock.calls[0];
            expect(appId).toBe('app-r2d-1');
            expect(providerId).toBe('auditor-7');
            // BE-T1: hook threads its client so cert issuance joins the caller's
            // transaction. C-1 still holds — no skipInitialAssets, so the hook
            // keeps owning initial-asset creation.
            expect(options).toEqual({ prisma });
            expect(options.skipInitialAssets).toBeUndefined();
            expect(prisma.application.update).toHaveBeenCalledTimes(1); // no rollback
        });

        test('APPROVED with existing cert is idempotent — skips generateCertificate', async () => {
            const existing = { id: 'cert-existing', certificateNumber: 'GACP-TH-2569-ZZZZZZ' };
            mockCertState.findCertificateForApplication = jest.fn(async () => existing);
            mockCertState.generateCertificate = jest.fn(async () => {
                throw new Error('should NOT be called when cert exists');
            });

            const { writeApplicationStatus } = loadWriter();
            const prisma = makePrisma();
            await expect(
                writeApplicationStatus({
                    prisma,
                    applicationId: 'app-r2d-2',
                    fromStatus: 'AUDIT_PASSED',
                    toStatus: 'APPROVED',
                    actorId: 'auditor-7',
                    actorRole: 'AUDITOR',
                }),
            ).resolves.toBeDefined();

            expect(mockCertState.findCertificateForApplication)
                .toHaveBeenCalledWith('app-r2d-2', expect.objectContaining({ prisma: expect.anything() }));
            expect(mockCertState.generateCertificate).not.toHaveBeenCalled();
            expect(prisma.application.update).toHaveBeenCalledTimes(1); // no rollback
        });

        test('cert-gen failure rolls back status to fromStatus and re-throws wrapped', async () => {
            mockCertState.findCertificateForApplication = jest.fn(async () => null);
            const certErr = new Error('cert DB down');
            certErr.code = 'CERT_DB_DOWN';
            mockCertState.generateCertificate = jest.fn(async () => { throw certErr; });

            const { writeApplicationStatus } = loadWriter();
            const prisma = makePrisma();

            await expect(
                writeApplicationStatus({
                    prisma,
                    applicationId: 'app-r2d-3',
                    fromStatus: 'AUDIT_PASSED',
                    toStatus: 'APPROVED',
                    actorId: 'auditor-7',
                    actorRole: 'AUDITOR',
                }),
            ).rejects.toThrow(/cert-auto-gen failed; status rolled back/);

            // Two update calls: original APPROVED, then rollback to AUDIT_PASSED
            expect(prisma.application.update).toHaveBeenCalledTimes(2);
            const rollbackCall = prisma.application.update.mock.calls[1][0];
            expect(rollbackCall.where).toEqual({ id: 'app-r2d-3' });
            expect(rollbackCall.data.status).toBe('AUDIT_PASSED');
            expect(rollbackCall.data.updatedBy).toBe('auditor-7');
        });

        test('autoIssueCertificate=false opts out — hook does not fire on APPROVED', async () => {
            mockCertState.findCertificateForApplication = jest.fn(async () => null);
            mockCertState.generateCertificate = jest.fn(async () => ({ id: 'cert-x' }));

            const { writeApplicationStatus } = loadWriter();
            const prisma = makePrisma();
            await writeApplicationStatus({
                prisma,
                applicationId: 'app-r2d-4',
                fromStatus: 'AUDIT_PASSED',
                toStatus: 'APPROVED',
                actorId: 'auditor-7',
                actorRole: 'AUDITOR',
                autoIssueCertificate: false,
            });

            expect(mockCertState.findCertificateForApplication).not.toHaveBeenCalled();
            expect(mockCertState.generateCertificate).not.toHaveBeenCalled();
            expect(prisma.application.update).toHaveBeenCalledTimes(1);
        });

        test('hook is no-op for non-AUDIT_PASSED transitions (default true is irrelevant)', async () => {
            mockCertState.findCertificateForApplication = jest.fn(async () => null);
            mockCertState.generateCertificate = jest.fn(async () => ({ id: 'cert-y' }));

            const { writeApplicationStatus } = loadWriter();
            const prisma = makePrisma();
            await writeApplicationStatus({
                prisma,
                applicationId: 'app-r2d-5',
                fromStatus: 'REGISTERED',
                toStatus: 'SUBMITTED',
                actorId: 'user-7',
            });

            expect(mockCertState.findCertificateForApplication).not.toHaveBeenCalled();
            expect(mockCertState.generateCertificate).not.toHaveBeenCalled();
        });

        test('rollback emits onAudit entry tagged with APPROVED_ROLLBACK_CERT_FAILURE (I-003)', async () => {
            mockCertState.findCertificateForApplication = jest.fn(async () => null);
            mockCertState.generateCertificate = jest.fn(async () => { throw new Error('boom'); });

            const captured = [];
            const onAudit = async (entry) => { captured.push(entry); };

            const { writeApplicationStatus } = loadWriter();
            await expect(
                writeApplicationStatus({
                    prisma: makePrisma(),
                    applicationId: 'app-r2d-6',
                    fromStatus: 'AUDIT_PASSED',
                    toStatus: 'APPROVED',
                    actorId: 'auditor-7',
                    actorRole: 'AUDITOR',
                    onAudit,
                }),
            ).rejects.toThrow(/cert-auto-gen failed/);

            // First entry: original AUDIT_PASSED → APPROVED
            // Second entry: rollback APPROVED → AUDIT_PASSED with the failure reason
            expect(captured.length).toBe(2);
            expect(captured[0].toStatus).toBe('APPROVED');
            expect(captured[1].fromStatus).toBe('APPROVED');
            expect(captured[1].toStatus).toBe('AUDIT_PASSED');
            expect(captured[1].reason).toBe('APPROVED_ROLLBACK_CERT_FAILURE');
        });
    });

    // ─── Iter R3 / R3-D: CERT_AUTO_GEN_ROLLBACK defence-in-depth audit ────
    //
    // R3-D extends the rollback branch added by R2-D so that when cert-gen
    // throws and the AUDIT_PASSED transition is being reverted, an audit
    // row with action 'CERT_AUTO_GEN_ROLLBACK' is also written inside the
    // same transaction. I-003 mandates `auditLogger.logWithin(event, tx)`
    // for transactional audit emission; the call is wrapped in its own
    // try/catch so an audit emission failure does NOT prevent the wrapped
    // cert-error from being re-thrown to the caller.
    describe('CERT_AUTO_GEN_ROLLBACK audit emission (R3-D, I-003)', () => {
        test('(a) cert-gen throws — status reverts AND CERT_AUTO_GEN_ROLLBACK audit row written via logWithin', async () => {
            mockCertState.findCertificateForApplication = jest.fn(async () => null);
            const certErr = new Error('cert-service down');
            certErr.code = 'CERT_SVC_503';
            mockCertState.generateCertificate = jest.fn(async () => { throw certErr; });

            const { writeApplicationStatus } = loadWriter();
            const prisma = makePrisma();

            await expect(
                writeApplicationStatus({
                    prisma,
                    applicationId: 'app-r3d-1',
                    fromStatus: 'AUDIT_PASSED',
                    toStatus: 'APPROVED',
                    actorId: 'auditor-42',
                    actorRole: 'AUDITOR',
                }),
            ).rejects.toThrow(/cert-auto-gen failed; status rolled back/);

            // Two prisma updates: forward APPROVED + revert to AUDIT_PASSED
            expect(prisma.application.update).toHaveBeenCalledTimes(2);
            const rollbackCall = prisma.application.update.mock.calls[1][0];
            expect(rollbackCall.where).toEqual({ id: 'app-r3d-1' });
            expect(rollbackCall.data.status).toBe('AUDIT_PASSED');

            // I-003: audit row emitted via logWithin (NOT log) with tx as 2nd arg
            expect(mockAuditState.logWithin).toHaveBeenCalledTimes(1);
            expect(mockAuditState.log).not.toHaveBeenCalled();
            const [auditEvent, txArg] = mockAuditState.logWithin.mock.calls[0];
            expect(auditEvent.action).toBe('CERT_AUTO_GEN_ROLLBACK');
            expect(auditEvent.resourceType).toBe('APPLICATION');
            expect(auditEvent.resourceId).toBe('app-r3d-1');
            expect(auditEvent.actorId).toBe('auditor-42');
            expect(auditEvent.metadata.fromStatus).toBe('APPROVED');
            expect(auditEvent.metadata.toStatus).toBe('AUDIT_PASSED');
            // The 2nd arg MUST be the tx handle (the same prisma reference
            // the writer was invoked with — when callers run inside
            // prisma.$transaction this is the tx client).
            expect(txArg).toBe(prisma);
        });

        test('(b) audit emit failure does NOT prevent re-throw of cert-auto-gen wrapped error', async () => {
            mockCertState.findCertificateForApplication = jest.fn(async () => null);
            const certErr = new Error('boom from cert');
            certErr.code = 'CERT_BOOM';
            mockCertState.generateCertificate = jest.fn(async () => { throw certErr; });

            // Simulate a transient audit-infrastructure outage: logWithin
            // rejects. The rollback already executed; the writer MUST still
            // re-throw the wrapped cert-auto-gen error.
            mockAuditState.logWithin = jest.fn(async () => {
                throw new Error('audit DB unreachable');
            });

            const { writeApplicationStatus } = loadWriter();
            const prisma = makePrisma();

            let thrown;
            try {
                await writeApplicationStatus({
                    prisma,
                    applicationId: 'app-r3d-2',
                    fromStatus: 'AUDIT_PASSED',
                    toStatus: 'APPROVED',
                    actorId: 'auditor-42',
                    actorRole: 'AUDITOR',
                });
            } catch (e) {
                thrown = e;
            }

            // Wrapped error surfaces (audit failure is swallowed)
            expect(thrown).toBeDefined();
            expect(thrown.message).toMatch(/cert-auto-gen failed; status rolled back/);
            expect(thrown.code).toBe('CERT_BOOM');
            expect(thrown.cause).toBe(certErr);

            // Rollback executed (two updates) and audit was attempted
            expect(prisma.application.update).toHaveBeenCalledTimes(2);
            expect(mockAuditState.logWithin).toHaveBeenCalledTimes(1);
        });

        test('(c) metadata.errorMessage + errorCode mirror the certError (default UNKNOWN when absent)', async () => {
            mockCertState.findCertificateForApplication = jest.fn(async () => null);
            // certError with BOTH message + code populated
            const certErrWithCode = new Error('connection refused');
            certErrWithCode.code = 'ECONNREFUSED';
            mockCertState.generateCertificate = jest.fn(async () => { throw certErrWithCode; });

            const { writeApplicationStatus } = loadWriter();
            await expect(
                writeApplicationStatus({
                    prisma: makePrisma(),
                    applicationId: 'app-r3d-3a',
                    fromStatus: 'AUDIT_PASSED',
                    toStatus: 'APPROVED',
                    actorId: 'auditor-42',
                    actorRole: 'AUDITOR',
                }),
            ).rejects.toThrow(/cert-auto-gen failed/);

            expect(mockAuditState.logWithin).toHaveBeenCalledTimes(1);
            const [evtA] = mockAuditState.logWithin.mock.calls[0];
            expect(evtA.metadata.errorMessage).toBe('connection refused');
            expect(evtA.metadata.errorCode).toBe('ECONNREFUSED');

            // Now reset mocks and assert the UNKNOWN/unknown defaults when
            // the cert error has neither a usable message nor a .code
            // property (a bare thrown value or stripped Error).
            mockAuditState.logWithin = jest.fn(async () => ({ id: 'audit-row-default' }));
            const certErrBare = new Error('');
            // No code assigned — exercise the 'UNKNOWN' default branch
            mockCertState.generateCertificate = jest.fn(async () => { throw certErrBare; });

            const { writeApplicationStatus: writer2 } = loadWriter();
            await expect(
                writer2({
                    prisma: makePrisma(),
                    applicationId: 'app-r3d-3b',
                    fromStatus: 'AUDIT_PASSED',
                    toStatus: 'APPROVED',
                    actorId: 'auditor-42',
                    actorRole: 'AUDITOR',
                }),
            ).rejects.toThrow(/cert-auto-gen failed/);

            expect(mockAuditState.logWithin).toHaveBeenCalledTimes(1);
            const [evtB] = mockAuditState.logWithin.mock.calls[0];
            // Empty message falls back to the 'unknown' default
            expect(evtB.metadata.errorMessage).toBe('unknown');
            // Missing .code falls back to 'UNKNOWN'
            expect(evtB.metadata.errorCode).toBe('UNKNOWN');
        });
    });

    describe('WF-F7 — optimistic concurrency (version)', () => {
        test('always increments version, even without expectedVersion (last-write-wins preserved)', async () => {
            const { writeApplicationStatus } = loadWriter();
            const prisma = makePrisma();
            await writeApplicationStatus({
                prisma,
                applicationId: 'app-1',
                fromStatus: 'DRAFT',
                toStatus: 'SUBMITTED',
                actorId: 'user-7',
            });
            const call = prisma.application.update.mock.calls[0][0];
            // No version predicate in WHERE — behaves like before.
            expect(call.where).toEqual({ id: 'app-1' });
            // But the column still advances.
            expect(call.data.version).toEqual({ increment: 1 });
        });

        test('scopes the update to expectedVersion when provided', async () => {
            const { writeApplicationStatus } = loadWriter();
            const prisma = makePrisma();
            await writeApplicationStatus({
                prisma,
                applicationId: 'app-1',
                fromStatus: 'DRAFT',
                toStatus: 'SUBMITTED',
                actorId: 'user-7',
                expectedVersion: 4,
            });
            const call = prisma.application.update.mock.calls[0][0];
            expect(call.where).toEqual({ id: 'app-1', version: 4 });
            expect(call.data.version).toEqual({ increment: 1 });
        });

        test('throws CONCURRENCY_CONFLICT when a racing writer already advanced the row (P2025)', async () => {
            const { writeApplicationStatus } = loadWriter();
            const prisma = {
                application: {
                    update: jest.fn(async () => {
                        const e = new Error('Record to update not found.');
                        e.code = 'P2025';
                        throw e;
                    }),
                },
            };
            await expect(
                writeApplicationStatus({
                    prisma,
                    applicationId: 'app-1',
                    fromStatus: 'DRAFT',
                    toStatus: 'SUBMITTED',
                    actorId: 'user-7',
                    expectedVersion: 4,
                }),
            ).rejects.toMatchObject({ code: 'CONCURRENCY_CONFLICT', applicationId: 'app-1', expectedVersion: 4 });
        });

        test('a P2025 WITHOUT expectedVersion is not masked as a conflict (re-thrown as-is)', async () => {
            const { writeApplicationStatus } = loadWriter();
            const prisma = {
                application: {
                    update: jest.fn(async () => {
                        const e = new Error('Record to update not found.');
                        e.code = 'P2025';
                        throw e;
                    }),
                },
            };
            await expect(
                writeApplicationStatus({
                    prisma,
                    applicationId: 'missing-app',
                    fromStatus: 'DRAFT',
                    toStatus: 'SUBMITTED',
                    actorId: 'user-7',
                }),
            ).rejects.toMatchObject({ code: 'P2025' });
        });

        test('ignores a non-integer expectedVersion (no version predicate)', async () => {
            const { writeApplicationStatus } = loadWriter();
            const prisma = makePrisma();
            await writeApplicationStatus({
                prisma,
                applicationId: 'app-1',
                fromStatus: 'DRAFT',
                toStatus: 'SUBMITTED',
                actorId: 'user-7',
                expectedVersion: 'not-a-number',
            });
            const call = prisma.application.update.mock.calls[0][0];
            expect(call.where).toEqual({ id: 'app-1' });
        });
    });
});

describe('application-status-writer — H1 formData.workflowState sync', () => {
    // prisma that supports the defensive findUnique pre-read the sync path uses.
    function makePrismaWithFindUnique(currentFormData) {
        return {
            application: {
                findUnique: jest.fn(async () => ({ formData: currentFormData })),
                update: jest.fn(async ({ where, data }) => ({ id: where.id, ...data })),
            },
        };
    }

    test('syncs formData.workflowState to the canonical state for the new status (merge, no clobber)', async () => {
        const { writeApplicationStatus } = loadWriter();
        const prisma = makePrismaWithFindUnique({ workflowState: 'PENDING_DOC_FEE', someOtherKey: 'keep-me' });

        await writeApplicationStatus({
            prisma,
            applicationId: 'app-doc',
            fromStatus: 'PENDING_DOC_FEE',
            toStatus: 'DOC_FEE_PAID',
            actorId: 'SYSTEM',
            actorRole: 'system',
            additionalData: { phase1Status: 'PAID' },
        });

        const data = prisma.application.update.mock.calls[0][0].data;
        expect(data.status).toBe('DOC_FEE_PAID');
        expect(data.formData.workflowState).toBe('DOC_FEE_PAID');
        expect(data.formData.someOtherKey).toBe('keep-me');
        expect(data.phase1Status).toBe('PAID');
    });

    test('does NOT overwrite an explicit caller-supplied formData', async () => {
        const { writeApplicationStatus } = loadWriter();
        const prisma = makePrismaWithFindUnique({ workflowState: 'PENDING_DOC_FEE' });

        await writeApplicationStatus({
            prisma,
            applicationId: 'app-x',
            // fromStatus supplied: the waiver-reopen fence pre-read (fires
            // ONLY on nullish fromStatus for non-system actors) stays out of
            // the way, keeping this H1-sync contract pinned in isolation.
            fromStatus: 'AUDIT_CONFIRMED',
            toStatus: 'AUDIT_PASSED',
            autoIssueCertificate: false,
            additionalData: { formData: { workflowState: 'AUDIT_PASSED', x: 1 } },
        });

        const data = prisma.application.update.mock.calls[0][0].data;
        expect(data.formData).toEqual({ workflowState: 'AUDIT_PASSED', x: 1 });
        // The sync block must have been skipped (caller formData present) →
        // no pre-read.
        expect(prisma.application.findUnique).not.toHaveBeenCalled();
    });

    test('falls back to a status-only write when prisma.application.findUnique is unavailable', async () => {
        const { writeApplicationStatus } = loadWriter();
        const prisma = {
            application: { update: jest.fn(async ({ where, data }) => ({ id: where.id, ...data })) },
        };

        await writeApplicationStatus({
            prisma,
            applicationId: 'app-legacy',
            toStatus: 'SUBMITTED',
            autoIssueCertificate: false,
        });

        const data = prisma.application.update.mock.calls[0][0].data;
        expect(data.status).toBe('SUBMITTED');
        expect(data.formData).toBeUndefined();
    });
});
