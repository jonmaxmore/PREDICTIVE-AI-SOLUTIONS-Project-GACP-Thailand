/**
 * B2-followup (HIGH) — the interop trace-event feed projected
 * `reason: certificate.revokedReason` (decrypted plaintext) into the
 * CERTIFICATE_REVOKED event served by the partner-gated
 * GET /v1/trace/events/... . An admin revoke reason like
 * 'ปลอมแปลงโดย 1101700230705' leaks a 13-digit national ID to every partner.
 *
 * Fix: apply the same maskThaiIdsInText mask the PDPA cluster uses at the other
 * three revokedReason projections. (interoperability-trace-events.js:39)
 */
'use strict';

jest.mock('../../routes/api/interoperability/interoperability-core', () => ({
    prisma: {
        plantingCycle: { findFirst: jest.fn() },
        harvestBatch: { findFirst: jest.fn() },
        lot: { findFirst: jest.fn() },
        // No `plantUnit` delegate: the interoperability resolver stopped resolving a
        // PLANT_UNIT entity on 2026-08-25 (R8 of design notes
        // 2026-08-20-planting-tnt-design.md retires per-plant tracking). A re-added
        // branch fails loudly here instead of reading a mocked null.
        traceQrSecurity: { findFirst: jest.fn().mockResolvedValue(null) },
    },
    TRUST_STATUS: { REVOKED: 'REVOKED' },
    computeTrustStatus: () => 'REVOKED',
    // pass-through so the test can inspect exactly what the projection passed.
    createEvent: (e) => e,
    fetchCertificateByLookup: jest.fn(),
}));

const core = require('../../routes/api/interoperability/interoperability-core');
const { collectTraceEvents } = require('../../routes/api/interoperability/interoperability-trace-events');

const NATIONAL_ID = '1101700230705';

function revokedCert(reason) {
    return {
        certificateNumber: 'CERT-1',
        issuedDate: new Date('2026-01-01').toISOString(),
        issuedBy: 'issuer-uuid',
        status: 'REVOKED',
        revokedAt: new Date('2026-06-01').toISOString(),
        revokedBy: 'admin-uuid',
        revokedReason: reason,
        updatedAt: new Date('2026-06-01').toISOString(),
    };
}

function findRevokedEvent(events) {
    return (events || []).find((e) => e.eventType === 'CERTIFICATE_REVOKED');
}

beforeEach(() => {
    jest.clearAllMocks();
    core.prisma.traceQrSecurity.findFirst.mockResolvedValue(null);
});

describe('B2-followup — revokedReason is masked on the interop trace-event', () => {
    test('a reason containing a 13-digit national ID is masked (no 13-digit run)', async () => {
        core.fetchCertificateByLookup.mockResolvedValue(revokedCert(`ปลอมแปลงโดย ${NATIONAL_ID}`));
        const events = await collectTraceEvents('CERTIFICATE', 'CERT-1');
        const revoked = findRevokedEvent(events);
        expect(revoked).toBeDefined();
        expect(revoked.payload.reason).not.toMatch(/(?<!\d)\d{13}(?!\d)/);
        expect(revoked.payload.reason).not.toContain(NATIONAL_ID);
        // surrounding prose is preserved
        expect(revoked.payload.reason).toContain('ปลอมแปลงโดย');
    });

    test('a reason with no ID passes through unchanged', async () => {
        core.fetchCertificateByLookup.mockResolvedValue(revokedCert('เอกสารปลอม'));
        const events = await collectTraceEvents('CERTIFICATE', 'CERT-1');
        expect(findRevokedEvent(events).payload.reason).toBe('เอกสารปลอม');
    });

    test('a null reason stays null', async () => {
        core.fetchCertificateByLookup.mockResolvedValue(revokedCert(null));
        const events = await collectTraceEvents('CERTIFICATE', 'CERT-1');
        expect(findRevokedEvent(events).payload.reason).toBeNull();
    });
});
