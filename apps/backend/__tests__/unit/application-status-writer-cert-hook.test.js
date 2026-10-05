/**
 * application-status-writer — Certificate auto-generation hook.
 *
 * Product decision 2026-06-05: the two-person APPROVED step (former ISO/IEC
 * 17065 §7.6 SoD) was removed. The certificate is issued the moment the on-site
 * auditor records a PASS — i.e. on the AUDIT_PASSED write. APPROVED is kept as a
 * trigger too (idempotent) so any legacy/manual advance still issues.
 * This file zooms in on:
 *  - the cert hook firing on AUDIT_PASSED and APPROVED (exact call signature,
 *    tx-handle, probe, idempotency, opt-out, rollback to fromStatus on failure,
 *    I-003 onAudit);
 *  - the applicant "audit passed" fanout firing on AUDIT_PASSED carrying the
 *    certificate number the hook just minted.
 *
 * The existing application-status-writer.test.js owns the broader contract.
 */

'use strict';

const path = require('path');

const mockWfState = { canTransition: () => true };
jest.mock('../../services/workflow-transition-service', () => ({
    canTransition: (...args) => mockWfState.canTransition(...args),
}));

// I-008: the SUT lazily requires certificate-service AND consumes both
// findCertificateForApplication and generateCertificate. The mock MUST
// expose BOTH or the writer throws "X is not a function" at runtime.
const mockCertState = {
    findCertificateForApplication: jest.fn(async () => null),
    generateCertificate: jest.fn(async () => ({ id: 'cert-1', certificateNumber: 'GACP-TEST' })),
};
jest.mock('../../services/certificate-service', () => ({
    findCertificateForApplication: (...args) => mockCertState.findCertificateForApplication(...args),
    generateCertificate: (...args) => mockCertState.generateCertificate(...args),
}));

// V1-C / D10: the AUDIT_PASSED branch dispatches an APPLICANT_AUDIT_PASSED
// notification via notification-fanout-service. Mock the service so this test
// does not pull the full transport tree (redis, email, sms) into the process.
// I-008: expose `send` since that is the only function the SUT consumes.
const mockFanoutState = {
    send: jest.fn(async () => ({ dedupeKey: 'k', deduped: false })),
};
jest.mock('../../services/notification-fanout-service', () => ({
    send: (...args) => mockFanoutState.send(...args),
}));

const writerPath = path.resolve(__dirname, '../../services/application-status-writer.js');

function loadWriter() {
    jest.resetModules();
    jest.doMock('../../services/workflow-transition-service', () => ({
        canTransition: (...args) => mockWfState.canTransition(...args),
    }));
    jest.doMock('../../services/certificate-service', () => ({
        findCertificateForApplication: (...args) => mockCertState.findCertificateForApplication(...args),
        generateCertificate: (...args) => mockCertState.generateCertificate(...args),
    }));
    jest.doMock('../../services/notification-fanout-service', () => ({
        send: (...args) => mockFanoutState.send(...args),
    }));
    return require(writerPath);
}

function makePrisma() {
    return {
        application: {
            update: jest.fn(async ({ where, data }) => ({
                id: where.id,
                organizationId: 'org-1',
                healthId: 'health-canonical-1',
                applicationNumber: 'GACP-TEST-APP',
                ...data,
            })),
        },
        user: {
            // V1-C / D10: the AUDIT_PASSED fanout looks up User.id by the
            // application's healthId (canonicalId).
            findFirst: jest.fn(async () => ({ id: 'user-health-1' })),
        },
    };
}

describe('application-status-writer-cert-hook (R2-D + WF-2)', () => {
    beforeEach(() => {
        mockWfState.canTransition = () => true;
        mockCertState.findCertificateForApplication = jest.fn(async () => null);
        mockCertState.generateCertificate = jest.fn(async () => ({
            id: 'cert-default',
            certificateNumber: 'GACP-TEST',
        }));
        mockFanoutState.send = jest.fn(async () => ({ dedupeKey: 'k', deduped: false }));
    });

    // ── Cert hook now fires on the two-person APPROVED step (WF-2) ───────────
    describe('call signature contract (APPROVED)', () => {
        test('passes applicationId, actorId, and the caller client (no skipInitialAssets — hook owns initial assets per C-1)', async () => {
            const { writeApplicationStatus } = loadWriter();
            const prisma = makePrisma();
            await writeApplicationStatus({
                prisma,
                applicationId: 'app-101',
                fromStatus: 'AUDIT_PASSED',
                toStatus: 'APPROVED',
                actorId: 'approver-42',
                actorRole: 'ADMIN',
            });

            expect(mockCertState.generateCertificate).toHaveBeenCalledTimes(1);
            const [appId, providerId, options] = mockCertState.generateCertificate.mock.calls[0];
            expect(appId).toBe('app-101');
            expect(providerId).toBe('approver-42');
            // BE-T1: the hook threads its client to generateCertificate so cert
            // issuance joins the caller's transaction. C-1 still holds — it must
            // NOT pass skipInitialAssets, so the hook keeps owning asset creation.
            expect(options).toEqual({ prisma });
            expect(options.skipInitialAssets).toBeUndefined();
        });

        test('probes findCertificateForApplication BEFORE generateCertificate', async () => {
            const callOrder = [];
            mockCertState.findCertificateForApplication = jest.fn(async (id) => {
                callOrder.push(`find:${id}`);
                return null;
            });
            mockCertState.generateCertificate = jest.fn(async (id) => {
                callOrder.push(`gen:${id}`);
                return { id: 'cert-z' };
            });

            const { writeApplicationStatus } = loadWriter();
            await writeApplicationStatus({
                prisma: makePrisma(),
                applicationId: 'app-102',
                fromStatus: 'AUDIT_PASSED',
                toStatus: 'APPROVED',
                actorId: 'approver-42',
            });

            expect(callOrder).toEqual(['find:app-102', 'gen:app-102']);
        });
    });

    describe('idempotency', () => {
        test('re-call returns existing cert via findCertificateForApplication probe', async () => {
            const existing = { id: 'cert-existing', certificateNumber: 'GACP-OLD' };
            mockCertState.findCertificateForApplication = jest.fn(async () => existing);
            mockCertState.generateCertificate = jest.fn(async () => {
                throw new Error('generateCertificate MUST NOT be called when cert exists');
            });

            const { writeApplicationStatus } = loadWriter();
            await writeApplicationStatus({
                prisma: makePrisma(),
                applicationId: 'app-201',
                fromStatus: 'AUDIT_PASSED',
                toStatus: 'APPROVED',
                actorId: 'approver-7',
            });

            // 2026-09-05: the probe now takes the writer's client, so it reads the same
            // database the issuance writes to. Asserting the id alone would pass again
            // the day somebody drops the client.
            expect(mockCertState.findCertificateForApplication)
                .toHaveBeenCalledWith('app-201', expect.objectContaining({ prisma: expect.anything() }));
            expect(mockCertState.generateCertificate).not.toHaveBeenCalled();
        });

        test('H-1: emits CERT_AUTO_GEN_SKIPPED_EXISTING via onAudit when cert exists', async () => {
            const existing = { id: 'cert-x', certificateNumber: 'GACP-EXIST-1' };
            mockCertState.findCertificateForApplication = jest.fn(async () => existing);
            const onAudit = jest.fn(async () => undefined);

            const { writeApplicationStatus } = loadWriter();
            await writeApplicationStatus({
                prisma: makePrisma(),
                applicationId: 'app-skip-1',
                fromStatus: 'AUDIT_PASSED',
                toStatus: 'APPROVED',
                actorId: 'approver-9',
                actorRole: 'ADMIN',
                onAudit,
            });

            const skipEmit = onAudit.mock.calls
                .map(([evt]) => evt)
                .find((evt) => evt && evt.event === 'CERT_AUTO_GEN_SKIPPED_EXISTING');
            expect(skipEmit).toBeDefined();
            expect(skipEmit.applicationId).toBe('app-skip-1');
            expect(skipEmit.certificateNumber).toBe('GACP-EXIST-1');
            expect(skipEmit.actorId).toBe('approver-9');
            expect(skipEmit.actorRole).toBe('ADMIN');
        });

        test('double-write of the same APPROVED transition is safe', async () => {
            const existingCert = { id: 'cert-dup', certificateNumber: 'GACP-DUP' };
            let findCallCount = 0;
            mockCertState.findCertificateForApplication = jest.fn(async () => {
                findCallCount += 1;
                return findCallCount === 1 ? null : existingCert;
            });
            mockCertState.generateCertificate = jest.fn(async () => existingCert);

            const { writeApplicationStatus } = loadWriter();
            const prisma = makePrisma();

            await writeApplicationStatus({
                prisma,
                applicationId: 'app-202',
                fromStatus: 'AUDIT_PASSED',
                toStatus: 'APPROVED',
                actorId: 'approver-7',
            });
            await writeApplicationStatus({
                prisma,
                applicationId: 'app-202',
                fromStatus: 'AUDIT_PASSED',
                toStatus: 'APPROVED',
                actorId: 'approver-7',
            });

            expect(mockCertState.generateCertificate).toHaveBeenCalledTimes(1);
            expect(mockCertState.findCertificateForApplication).toHaveBeenCalledTimes(2);
        });
    });

    describe('rollback on failure (reverts APPROVED → fromStatus)', () => {
        test('cert-gen throw rolls status back to fromStatus and re-throws wrapped', async () => {
            const certErr = new Error('certificate-service unavailable');
            certErr.code = 'CERT_SERVICE_DOWN';
            mockCertState.findCertificateForApplication = jest.fn(async () => null);
            mockCertState.generateCertificate = jest.fn(async () => { throw certErr; });

            const { writeApplicationStatus } = loadWriter();
            const prisma = makePrisma();

            const promise = writeApplicationStatus({
                prisma,
                applicationId: 'app-301',
                fromStatus: 'AUDIT_PASSED',
                toStatus: 'APPROVED',
                actorId: 'approver-7',
                actorRole: 'ADMIN',
            });

            await expect(promise).rejects.toThrow(/cert-auto-gen failed; status rolled back/);
            await expect(promise).rejects.toMatchObject({
                code: 'CERT_SERVICE_DOWN',
            });

            // Two update calls: first APPROVED, then revert to AUDIT_PASSED.
            expect(prisma.application.update).toHaveBeenCalledTimes(2);
            const [firstCall, rollbackCall] = prisma.application.update.mock.calls;
            expect(firstCall[0].data.status).toBe('APPROVED');
            expect(rollbackCall[0].where).toEqual({ id: 'app-301' });
            expect(rollbackCall[0].data.status).toBe('AUDIT_PASSED');
        });

        test('rollback failure is swallowed (logged), original cert error still re-thrown', async () => {
            const certErr = new Error('cert failed');
            mockCertState.generateCertificate = jest.fn(async () => { throw certErr; });

            const prisma = makePrisma();
            let updateCallCount = 0;
            prisma.application.update = jest.fn(async ({ where, data }) => {
                updateCallCount += 1;
                if (updateCallCount >= 2) {
                    throw new Error('rollback DB unavailable');
                }
                return { id: where.id, organizationId: 'org-1', ...data };
            });

            const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

            const { writeApplicationStatus } = loadWriter();
            await expect(
                writeApplicationStatus({
                    prisma,
                    applicationId: 'app-302',
                    fromStatus: 'AUDIT_PASSED',
                    toStatus: 'APPROVED',
                    actorId: 'approver-7',
                }),
            ).rejects.toThrow(/cert-auto-gen failed/);

            expect(prisma.application.update).toHaveBeenCalledTimes(2);
            expect(errSpy).toHaveBeenCalledWith(
                expect.stringContaining('CRITICAL — rollback after cert-gen failure also failed'),
            );

            errSpy.mockRestore();
        });

        test('rollback uses prisma.application.update directly (no recursive writeApplicationStatus)', async () => {
            mockCertState.findCertificateForApplication = jest.fn(async () => null);
            mockCertState.generateCertificate = jest.fn(async () => { throw new Error('boom'); });

            const { writeApplicationStatus } = loadWriter();
            const prisma = makePrisma();
            await expect(
                writeApplicationStatus({
                    prisma,
                    applicationId: 'app-303',
                    fromStatus: 'AUDIT_PASSED',
                    toStatus: 'APPROVED',
                    actorId: 'approver-7',
                }),
            ).rejects.toThrow(/cert-auto-gen failed/);

            expect(mockCertState.findCertificateForApplication).toHaveBeenCalledTimes(1);
        });
    });

    describe('opt-out via autoIssueCertificate: false', () => {
        test('hook does not fire when explicitly opted out', async () => {
            const { writeApplicationStatus } = loadWriter();
            await writeApplicationStatus({
                prisma: makePrisma(),
                applicationId: 'app-401',
                fromStatus: 'AUDIT_PASSED',
                toStatus: 'APPROVED',
                actorId: 'approver-7',
                autoIssueCertificate: false,
            });

            expect(mockCertState.findCertificateForApplication).not.toHaveBeenCalled();
            expect(mockCertState.generateCertificate).not.toHaveBeenCalled();
        });

        test('default true means hook fires on APPROVED with no explicit flag', async () => {
            const { writeApplicationStatus } = loadWriter();
            await writeApplicationStatus({
                prisma: makePrisma(),
                applicationId: 'app-402',
                fromStatus: 'AUDIT_PASSED',
                toStatus: 'APPROVED',
                actorId: 'approver-7',
                // autoIssueCertificate intentionally omitted — default true
            });

            expect(mockCertState.findCertificateForApplication).toHaveBeenCalledTimes(1);
            expect(mockCertState.generateCertificate).toHaveBeenCalledTimes(1);
        });
    });

    describe('cert hook fires on APPROVED only — never on AUDIT_PASSED (ISO/IEC 17065 §7.6)', () => {
        // F-CERT-SOD (2026-09-10). This block used to assert the opposite: that
        // AUDIT_PASSED issues the certificate, per the 2026-06-05 single-auditor
        // decision. operator reversed that — a certificate that exists before anyone
        // has decided to grant it makes the decision meaningless, and §7.6 is the
        // clause a certification body is itself audited against.
        test('AUDIT_PASSED does NOT issue a certificate — passing the audit is not the decision', async () => {
            const { writeApplicationStatus } = loadWriter();
            await writeApplicationStatus({
                prisma: makePrisma(),
                applicationId: 'app-ap-1',
                fromStatus: 'AUDIT_CONFIRMED',
                toStatus: 'AUDIT_PASSED',
                actorId: 'auditor-7',
            });

            expect(mockCertState.generateCertificate).not.toHaveBeenCalled();
        });

        test('APPROVED DOES issue it — that hop is the certification decision', async () => {
            const { writeApplicationStatus } = loadWriter();
            await writeApplicationStatus({
                prisma: makePrisma(),
                applicationId: 'app-ap-1',
                fromStatus: 'AUDIT_PASSED',
                toStatus: 'APPROVED',
                actorId: 'approver-9',
            });

            expect(mockCertState.findCertificateForApplication)
                .toHaveBeenCalledWith('app-ap-1', expect.objectContaining({ prisma: expect.anything() }));
            expect(mockCertState.generateCertificate).toHaveBeenCalledTimes(1);
            const [appId, providerId, options] = mockCertState.generateCertificate.mock.calls[0];
            expect(appId).toBe('app-ap-1');
            // ผู้ที่ถูกบันทึกว่าออกใบ คือผู้ตัดสิน ไม่ใช่ผู้ประเมิน
            expect(providerId).toBe('approver-9');
            expect(options).toEqual({ prisma: expect.anything() });
        });

        test('SUBMITTED transition is a no-op for the cert hook', async () => {
            const { writeApplicationStatus } = loadWriter();
            await writeApplicationStatus({
                prisma: makePrisma(),
                applicationId: 'app-501',
                fromStatus: 'REGISTERED',
                toStatus: 'SUBMITTED',
                actorId: 'user-7',
            });

            expect(mockCertState.findCertificateForApplication).not.toHaveBeenCalled();
            expect(mockCertState.generateCertificate).not.toHaveBeenCalled();
        });

        test('CAR_PENDING (audit failure path) is a no-op for the cert hook', async () => {
            const { writeApplicationStatus } = loadWriter();
            await writeApplicationStatus({
                prisma: makePrisma(),
                applicationId: 'app-502',
                fromStatus: 'AUDIT_CONFIRMED',
                toStatus: 'CAR_PENDING',
                actorId: 'auditor-7',
            });

            expect(mockCertState.findCertificateForApplication).not.toHaveBeenCalled();
            expect(mockCertState.generateCertificate).not.toHaveBeenCalled();
        });
    });

    describe('I-003 transaction-handle behaviour', () => {
        test('cert hook uses the same prisma handle the caller supplied (tx-aware)', async () => {
            const txUpdate = jest.fn(async ({ where, data }) => ({
                id: where.id,
                organizationId: 'org-tx',
                ...data,
            }));
            const tx = { application: { update: txUpdate } };

            mockCertState.findCertificateForApplication = jest.fn(async () => null);
            mockCertState.generateCertificate = jest.fn(async () => { throw new Error('cert fail'); });

            const { writeApplicationStatus } = loadWriter();
            await expect(
                writeApplicationStatus({
                    prisma: tx,
                    applicationId: 'app-601',
                    fromStatus: 'AUDIT_PASSED',
                    toStatus: 'APPROVED',
                    actorId: 'approver-7',
                }),
            ).rejects.toThrow(/cert-auto-gen failed/);

            // Both the original update AND the rollback use the tx handle.
            expect(txUpdate).toHaveBeenCalledTimes(2);
        });

        test('rollback onAudit fires through caller-supplied callback (NOT auditLogger.log directly)', async () => {
            const captured = [];
            const onAudit = jest.fn(async (entry) => { captured.push(entry); });

            mockCertState.findCertificateForApplication = jest.fn(async () => null);
            mockCertState.generateCertificate = jest.fn(async () => { throw new Error('boom'); });

            const { writeApplicationStatus } = loadWriter();
            await expect(
                writeApplicationStatus({
                    prisma: makePrisma(),
                    applicationId: 'app-602',
                    fromStatus: 'AUDIT_PASSED',
                    toStatus: 'APPROVED',
                    actorId: 'approver-7',
                    actorRole: 'ADMIN',
                    onAudit,
                }),
            ).rejects.toThrow(/cert-auto-gen failed/);

            // First entry: original audit log of the APPROVED write.
            // Second entry: rollback audit log emitted by the cert hook.
            expect(captured).toHaveLength(2);
            expect(captured[1]).toMatchObject({
                event: 'APPLICATION_STATUS_TRANSITION',
                applicationId: 'app-602',
                fromStatus: 'APPROVED',
                toStatus: 'AUDIT_PASSED',
                reason: 'APPROVED_ROLLBACK_CERT_FAILURE',
                actorRole: 'ADMIN',
            });
        });

        test('rollback onAudit failure does NOT mask the original cert error', async () => {
            const onAudit = jest.fn(async (entry) => {
                if (entry.reason === 'APPROVED_ROLLBACK_CERT_FAILURE') {
                    throw new Error('audit DB down during rollback');
                }
            });

            mockCertState.generateCertificate = jest.fn(async () => {
                const e = new Error('original cert failure');
                e.code = 'ORIGINAL_CODE';
                throw e;
            });

            const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

            const { writeApplicationStatus } = loadWriter();
            await expect(
                writeApplicationStatus({
                    prisma: makePrisma(),
                    applicationId: 'app-603',
                    fromStatus: 'AUDIT_PASSED',
                    toStatus: 'APPROVED',
                    actorId: 'approver-7',
                    onAudit,
                }),
            ).rejects.toMatchObject({
                message: expect.stringContaining('original cert failure'),
                code: 'ORIGINAL_CODE',
            });

            warnSpy.mockRestore();
        });
    });

    // V1-C / D10 — APPLICANT_AUDIT_PASSED fanout dispatch.
    //
    // The fanout fires on AUDIT_PASSED (the applicant passed the on-site audit).
    // F-CERT-SOD (2026-09-10): the certificate is no longer minted on that write, so
    // the payload's certificateNumber is null there. That is the honest value — telling
    // an applicant their certificate number before anyone has decided to grant it was
    // the notification promising something that did not exist yet. The dispatch is
    // best-effort: failures MUST NOT block the status write.
    describe('D10 APPLICANT_AUDIT_PASSED fanout dispatch', () => {
        test('fires on AUDIT_PASSED with NO certificate number — there is none yet', async () => {
            const { writeApplicationStatus } = loadWriter();
            const prisma = makePrisma();
            await writeApplicationStatus({
                prisma,
                applicationId: 'app-d10-1',
                fromStatus: 'AUDIT_CONFIRMED',
                toStatus: 'AUDIT_PASSED',
                actorId: 'auditor-7',
                actorRole: 'AUDITOR',
            });

            // No certificate at this hop — the decision has not been made yet.
            expect(mockCertState.generateCertificate).not.toHaveBeenCalled();

            expect(prisma.user.findFirst).toHaveBeenCalledWith({
                // detokenize: Application.healthId is the canonicalId TOKEN; the
                // fanout resolves the User by canonicalId, not the (now-encrypted) healthId.
                where: { canonicalId: 'health-canonical-1' },
                select: { id: true },
            });
            expect(mockFanoutState.send).toHaveBeenCalledTimes(1);
            expect(mockFanoutState.send).toHaveBeenCalledWith({
                userId: 'user-health-1',
                type: 'APPLICANT_AUDIT_PASSED',
                payload: {
                    applicationId: 'app-d10-1',
                    applicationNumber: 'GACP-TEST-APP',
                    // null by design: the decision hop (APPROVED) mints the certificate,
                    // and it has not happened yet at AUDIT_PASSED
                    certificateNumber: null,
                },
            });
        });

        test('still fires on AUDIT_PASSED even when autoIssueCertificate=false (fanout is decoupled from cert-gen)', async () => {
            const { writeApplicationStatus } = loadWriter();
            await writeApplicationStatus({
                prisma: makePrisma(),
                applicationId: 'app-d10-2',
                fromStatus: 'AUDIT_CONFIRMED',
                toStatus: 'AUDIT_PASSED',
                actorId: 'auditor-7',
                autoIssueCertificate: false,
            });

            // The fanout is gated on AUDIT_PASSED, not on the cert flag, so it
            // still notifies the applicant that they passed the audit.
            expect(mockFanoutState.send).toHaveBeenCalledTimes(1);
            expect(mockFanoutState.send.mock.calls[0][0].payload.certificateNumber).toBeNull();
            expect(mockCertState.generateCertificate).not.toHaveBeenCalled();
        });

        test('fanout failure does NOT throw to caller and does NOT roll back the status write', async () => {
            mockFanoutState.send = jest.fn(async () => {
                throw new Error('fanout transport down');
            });
            const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

            const { writeApplicationStatus } = loadWriter();
            const prisma = makePrisma();
            const result = await writeApplicationStatus({
                prisma,
                applicationId: 'app-d10-3',
                fromStatus: 'AUDIT_CONFIRMED',
                toStatus: 'AUDIT_PASSED',
                actorId: 'auditor-7',
            });

            // Single update call (no rollback path entered).
            expect(prisma.application.update).toHaveBeenCalledTimes(1);
            expect(result.status).toBe('AUDIT_PASSED');
            expect(warnSpy).toHaveBeenCalledWith(
                expect.stringContaining('APPLICANT_AUDIT_PASSED fanout failed'),
            );
            warnSpy.mockRestore();
        });

        test('skips silently when prisma stub lacks user.findFirst (e.g. legacy test mocks)', async () => {
            const { writeApplicationStatus } = loadWriter();
            const prisma = {
                application: {
                    update: jest.fn(async ({ where, data }) => ({
                        id: where.id,
                        organizationId: 'org-1',
                        healthId: 'h',
                        applicationNumber: 'APP-X',
                        ...data,
                    })),
                },
                // no `user` namespace
            };
            await writeApplicationStatus({
                prisma,
                applicationId: 'app-d10-4',
                fromStatus: 'AUDIT_CONFIRMED',
                toStatus: 'AUDIT_PASSED',
                actorId: 'auditor-7',
            });
            expect(mockFanoutState.send).not.toHaveBeenCalled();
        });

        test('skips silently when healthId is missing on the updated row', async () => {
            const { writeApplicationStatus } = loadWriter();
            const prisma = {
                application: {
                    update: jest.fn(async ({ where, data }) => ({
                        id: where.id,
                        organizationId: 'org-1',
                        // healthId intentionally absent
                        applicationNumber: 'APP-X',
                        ...data,
                    })),
                },
                user: { findFirst: jest.fn() },
            };
            await writeApplicationStatus({
                prisma,
                applicationId: 'app-d10-5',
                fromStatus: 'AUDIT_CONFIRMED',
                toStatus: 'AUDIT_PASSED',
                actorId: 'auditor-7',
            });
            expect(prisma.user.findFirst).not.toHaveBeenCalled();
            expect(mockFanoutState.send).not.toHaveBeenCalled();
        });

        test('does NOT fire on non-AUDIT_PASSED transitions (SUBMITTED, CERTIFIED, APPROVED)', async () => {
            const { writeApplicationStatus } = loadWriter();
            const transitions = [
                { from: 'REGISTERED', to: 'SUBMITTED' },
                { from: 'APPROVED', to: 'CERTIFIED' },
                { from: 'AUDIT_PASSED', to: 'APPROVED' },
            ];
            for (const { from, to } of transitions) {
                await writeApplicationStatus({
                    prisma: makePrisma(),
                    applicationId: `app-non-passed-${to}`,
                    fromStatus: from,
                    toStatus: to,
                    actorId: 'user-1',
                });
            }
            expect(mockFanoutState.send).not.toHaveBeenCalled();
        });
    });
});
