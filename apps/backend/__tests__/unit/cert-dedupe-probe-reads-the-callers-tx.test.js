/**
 * The probe that decides whether to issue a certificate must read the SAME
 * database the issuance writes to.
 *
 * BE-T1 threaded the caller's transaction handle into generateCertificate so the
 * certificate commits or rolls back with the status flip that triggered it. The
 * check standing immediately before it — findCertificateForApplication, the
 * idempotency probe — kept reading through the module-level singleton, so inside a
 * transaction the two lines look at two different databases:
 *
 *     existingCert = await certificateService.findCertificateForApplication(id)   ← singleton
 *     if (!existingCert) await certificateService.generateCertificate(id, actor, { prisma })   ← tx
 *
 * The failure it allows is the one this probe exists to prevent. A transaction that
 * has already voided the old certificate (an audit-pass reversal followed by a
 * re-pass in one unit of work) still sees it through the singleton, concludes a
 * certificate exists, and skips issuance — the application ends up passed with no
 * certificate, and the applicant is told they hold one that was never minted.
 * The mirror case writes two.
 *
 * voidCertificateForApplication already takes `{ prisma }` for exactly this reason.
 * The probe now takes the same option, and the writer passes it.
 */
'use strict';

jest.mock('../../services/prisma-database', () => ({
    prisma: { certificate: { findFirst: jest.fn(async () => ({ id: 'from-the-singleton' })) } },
}));
jest.mock('../../shared/logger', () => {
    const l = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    return { ...l, createLogger: () => l };
});

const { prisma: singleton } = require('../../services/prisma-database');
const certificateService = require('../../services/certificate-service');

const txClient = { certificate: { findFirst: jest.fn(async () => ({ id: 'from-the-transaction' })) } };

beforeEach(() => jest.clearAllMocks());

describe('findCertificateForApplication', () => {
    test('reads through the caller\'s transaction when one is handed to it', async () => {
        const found = await certificateService.findCertificateForApplication('app-1', { prisma: txClient });
        expect(found).toEqual({ id: 'from-the-transaction' });
        expect(txClient.certificate.findFirst).toHaveBeenCalledTimes(1);
        expect(singleton.certificate.findFirst).not.toHaveBeenCalled();
    });

    test('still uses the singleton when no client is handed to it', async () => {
        const found = await certificateService.findCertificateForApplication('app-1');
        expect(found).toEqual({ id: 'from-the-singleton' });
        expect(singleton.certificate.findFirst).toHaveBeenCalledTimes(1);
    });

    test('the filter is unchanged — a revoked cert still does not block a fresh one', async () => {
        await certificateService.findCertificateForApplication('app-1', { prisma: txClient });
        const where = txClient.certificate.findFirst.mock.calls[0][0].where;
        expect(where).toMatchObject({
            applicationId: 'app-1',
            isDeleted: false,
            status: { notIn: ['revoked', 'REVOKED'] },
        });
    });

    test('an empty applicationId still short-circuits without touching any database', async () => {
        expect(await certificateService.findCertificateForApplication('', { prisma: txClient })).toBeNull();
        expect(txClient.certificate.findFirst).not.toHaveBeenCalled();
        expect(singleton.certificate.findFirst).not.toHaveBeenCalled();
    });
});

describe('the writer hands its own client to the probe', () => {
    const fs = require('fs');
    const src = fs.readFileSync(require.resolve('../../services/application-status-writer.js'), 'utf8');

    test('the issuance hook probes with the same client it issues with', () => {
        // Both calls in one statement pair; reading the source is how we prove the
        // pairing without standing up the whole writer graph. The behaviour that the
        // probe CAN take a client is proved above.
        expect(src).toMatch(/findCertificateForApplication\(\s*applicationId,\s*\{\s*prisma\s*\}\s*\)/);
    });
});
