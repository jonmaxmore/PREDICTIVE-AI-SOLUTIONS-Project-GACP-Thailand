/**
 * Bug 8.4 — generatePlotCycleQrsForCycle must produce a REAL partial report and
 * not abort the whole cycle on the first plot failure.
 *
 * Before this fix:
 *   - the per-assignment `await qrcodeService.registerTraceIntegrity(...)` had no
 *     try/catch, so one plot's failure threw out of the loop and DISCARDED every
 *     QR already generated for the cycle;
 *   - `missingCount = generated.filter(i => !i.qrCode).length` was dead code —
 *     every pushed row always had a qrCode (`existing?.qrCode || generateQRCodeId()`),
 *     so missingCount was ALWAYS 0 and status was ALWAYS 'generated' — the
 *     'partial' branch could never fire.
 *
 * Fix: wrap each registration in try/catch, accumulate `generated` + `failed`,
 * and derive status from real failures (generated → all ok, partial → some ok
 * some failed, failed → none ok).
 */

'use strict';

jest.mock('../../services/prisma-database', () => ({
    prisma: {
        traceQrSecurity: { findMany: jest.fn(async () => []) },
        // 2026-09-06: การออกป้ายถามใบรับรองของรอบก่อน (QR_REQUIRES_ACTIVE_CERTIFICATE)
        // ชุดนี้ทดสอบรายงานแบบ partial ของรอบที่ "ออกป้ายได้อยู่แล้ว" จึงตอบใบที่ยังมีผล
        certificate: { findUnique: jest.fn(async () => ({ status: 'active', expiryDate: null, isDeleted: false, farmId: 'farm-1' })) },
    },
}));
jest.mock('../../services/qrcode/qrcode-service', () => ({
    generateQRCodeId: jest.fn(() => 'QR-NEW'),
    generatePublicTraceUrl: jest.fn((p) => `https://trace.example/${p}`),
    registerTraceIntegrity: jest.fn(async () => ({ ok: true })),
}));

const qrcodeService = require('../../services/qrcode/qrcode-service');
const { generatePlotCycleQrsForCycle } = require('../../services/planting-cycle-service');

const cycleWith = (ids) => ({
    id: 'cycle-1',
    cultivationType: 'OUTDOOR',
    farmId: 'farm-1',
    certificateId: 'cert-1',
    cyclePlots: ids.map((id) => ({ id, plot: { id: `${id}-plot`, name: id } })),
});

describe('Bug 8.4 — generatePlotCycleQrsForCycle partial report + no abort-on-first-error', () => {
    beforeEach(() => jest.clearAllMocks());

    test('one plot failing does NOT abort — returns the other successes + a partial report', async () => {
        // Fail the 2nd of 3 registrations.
        let call = 0;
        qrcodeService.registerTraceIntegrity.mockImplementation(async () => {
            call += 1;
            if (call === 2) { throw new Error('trace integrity write failed'); }
            return { ok: true };
        });

        const result = await generatePlotCycleQrsForCycle(cycleWith(['cp1', 'cp2', 'cp3']));

        expect(result.generated).toHaveLength(2);
        expect(result.failed).toHaveLength(1);
        expect(result.failed[0].cyclePlotId).toBe('cp2');
        expect(result.missingCount).toBe(1);
        expect(result.status).toBe('partial');
    });

    test('all succeed → status generated, missingCount 0, no failures', async () => {
        const result = await generatePlotCycleQrsForCycle(cycleWith(['cp1', 'cp2']));
        expect(result.generated).toHaveLength(2);
        expect(result.missingCount).toBe(0);
        expect(result.status).toBe('generated');
        expect(result.failed || []).toHaveLength(0);
    });

    test('all fail → status failed (with error), generated empty', async () => {
        qrcodeService.registerTraceIntegrity.mockImplementation(async () => { throw new Error('down'); });
        const result = await generatePlotCycleQrsForCycle(cycleWith(['cp1', 'cp2']));
        expect(result.generated).toHaveLength(0);
        expect(result.status).toBe('failed');
        expect(result.error).toBeTruthy();
    });

    test('no assignments → failed with error (unchanged)', async () => {
        const result = await generatePlotCycleQrsForCycle({ id: 'c', cyclePlots: [] });
        expect(result.status).toBe('failed');
        expect(result.error).toBeTruthy();
    });
});
