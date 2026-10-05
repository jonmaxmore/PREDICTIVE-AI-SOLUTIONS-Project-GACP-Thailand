/**
 * AdminService.listCertificates — R3-C contract tests.
 *
 * Mocks the apiClient.get so we can assert:
 *   (a) URL shape (no `take` vs `?take=100`)
 *   (b) success path reads `res.data` (apiClient already unwraps one
 *       envelope level — the /api/certificates list route returns
 *       single-level `{ success, count, data: [...] }`, certificates.js:82)
 *   (c) `res.success === false` returns []
 *   (d) missing `data` returns []
 *
 * Pattern mirrors active-entity-storage-sync.test.ts in this same folder
 * (mock-of-pure-helper style — no React, no apiClient hoisting via jest
 * module factory rather than jest.mock-of-the-whole-module since the SUT
 * is a small static object).
 */

import { AdminService } from '../admin-service';
import { apiClient } from '@/lib/api/api-client';

jest.mock('@/lib/api/api-client', () => ({
    apiClient: {
        get: jest.fn(),
    },
}));

const mockedGet = apiClient.get as jest.MockedFunction<typeof apiClient.get>;

describe('AdminService.listCertificates', () => {
    beforeEach(() => {
        mockedGet.mockReset();
    });

    it('calls /api/certificates/ with no query string when take is not provided', async () => {
        mockedGet.mockResolvedValueOnce({ success: true, data: [] });
        await AdminService.listCertificates();
        expect(mockedGet).toHaveBeenCalledWith('/api/certificates/');
    });

    it('appends ?take= when take is provided', async () => {
        mockedGet.mockResolvedValueOnce({ success: true, data: [] });
        await AdminService.listCertificates({ take: 100 });
        expect(mockedGet).toHaveBeenCalledWith('/api/certificates/?take=100');
    });

    it('returns the unwrapped data array on success', async () => {
        const rows = [
            {
                id: 'cert-1',
                certificateNumber: 'GACP-2026-0001',
                applicationId: 'app-1',
                farmName: 'ฟาร์มสมุนไพรอีสาน',
                cropType: 'Cannabis',
                status: 'ACTIVE',
                issuedDate: '2026-01-15T00:00:00.000Z',
                expiryDate: '2029-01-14T00:00:00.000Z',
            },
        ];
        mockedGet.mockResolvedValueOnce({ success: true, data: rows });

        const out = await AdminService.listCertificates({ take: 100 });

        expect(out).toEqual(rows);
        expect(out).toHaveLength(1);
        expect(out[0].certificateNumber).toBe('GACP-2026-0001');
    });

    it('returns [] when the API responds with success=false', async () => {
        mockedGet.mockResolvedValueOnce({ success: false, error: 'Forbidden' });
        const out = await AdminService.listCertificates();
        expect(out).toEqual([]);
    });

    it('returns [] when success=true but data is missing', async () => {
        // Backend bug / shape drift: route returns `{ success: true }` with
        // no body. Caller still gets an array, not a crash.
        mockedGet.mockResolvedValueOnce({ success: true });
        const out = await AdminService.listCertificates();
        expect(out).toEqual([]);
    });

    it('returns [] when data is not an array (defensive)', async () => {
        mockedGet.mockResolvedValueOnce({
            success: true,
            data: 'oops-not-an-array' as unknown as never,
        });
        const out = await AdminService.listCertificates();
        expect(out).toEqual([]);
    });
});

describe('AdminService.getCertificate', () => {
    beforeEach(() => {
        mockedGet.mockReset();
    });

    const sampleDetail = {
        id: 'cert-42',
        certificateNumber: 'GACP-TH-2569-A3F7B2',
        applicationId: 'app-9',
        farmName: 'ฟาร์มสมุนไพรเหนือ',
        cropType: 'กระท่อม',
        status: 'ACTIVE',
        issuedDate: '2026-02-01T00:00:00.000Z',
        expiryDate: '2029-01-31T00:00:00.000Z',
        revokedAt: null,
        revokedReason: null,
    };

    it('returns null when called with an empty id (defensive — no API call)', async () => {
        const out = await AdminService.getCertificate('');
        expect(out).toBeNull();
        expect(mockedGet).not.toHaveBeenCalled();
    });

    it('encodes the id and hits /api/certificates/:id', async () => {
        mockedGet.mockResolvedValueOnce({ success: true, data: { data: sampleDetail } });
        await AdminService.getCertificate('cert/with weird chars');
        expect(mockedGet).toHaveBeenCalledWith('/api/certificates/cert%2Fwith%20weird%20chars');
    });

    it('unwraps `{ data: { data: cert } }` envelope on success', async () => {
        mockedGet.mockResolvedValueOnce({ success: true, data: { data: sampleDetail } });
        const out = await AdminService.getCertificate('cert-42');
        expect(out).toEqual(sampleDetail);
        expect(out?.certificateNumber).toBe('GACP-TH-2569-A3F7B2');
    });

    it('accepts a flat `{ data: cert }` envelope (gateway projection)', async () => {
        // Some API gateways flatten `{ success, data: cert }` instead of
        // `{ success, data: { data: cert } }`. Caller should accept both.
        mockedGet.mockResolvedValueOnce({ success: true, data: sampleDetail });
        const out = await AdminService.getCertificate('cert-42');
        expect(out).toEqual(sampleDetail);
    });

    it('returns null when the API responds with success=false', async () => {
        mockedGet.mockResolvedValueOnce({ success: false, error: 'Not found' });
        const out = await AdminService.getCertificate('missing-cert');
        expect(out).toBeNull();
    });

    it('returns null when success=true but data is missing', async () => {
        mockedGet.mockResolvedValueOnce({ success: true });
        const out = await AdminService.getCertificate('cert-42');
        expect(out).toBeNull();
    });

    it('surfaces revokedAt / revokedReason for REVOKED certificates', async () => {
        const revoked = {
            ...sampleDetail,
            status: 'REVOKED',
            revokedAt: '2026-04-15T08:30:00.000Z',
            revokedReason: 'ตรวจพบการละเมิดมาตรฐาน GACP',
            revokedBy: 'admin-user-1',
        };
        mockedGet.mockResolvedValueOnce({ success: true, data: { data: revoked } });
        const out = await AdminService.getCertificate('cert-42');
        expect(out?.status).toBe('REVOKED');
        expect(out?.revokedAt).toBe('2026-04-15T08:30:00.000Z');
        expect(out?.revokedReason).toBe('ตรวจพบการละเมิดมาตรฐาน GACP');
    });
});
