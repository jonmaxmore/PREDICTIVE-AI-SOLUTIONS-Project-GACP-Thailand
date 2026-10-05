/**
 * audit-service.wire.test.ts — Task 12 (fixes B10, FE half).
 *
 * B10: prior FE tests never asserted the exact wire shape AuditService
 * sends to apiClient — a wholesale `jest.mock('audit-service')` (or
 * asserting only the parsed *response*, never the outgoing request) would
 * have let a body-shape regression (B3), a route-key regression (B2), or a
 * vocabulary regression (B4) ship invisibly on the FE side, mirroring
 * exactly how B10 let them ship invisibly on the BE side.
 *
 * This suite spies at the `apiClient` module boundary ONLY (the single
 * FE/BE seam) — AuditService itself is the REAL module under test, not
 * mocked — and asserts the literal outgoing `(path, body)` pairs.
 *
 * Sibling coverage: audit-service.checklist.test.ts already pins the
 * checklist/getOnsiteContext/verifyGps wire shapes in detail. This file
 * is the Task-12 companion asserting the THREE shapes the brief calls
 * out explicitly — startInspection's nested `{gps}` body (fixes B6 on
 * the FE-emission side), getOnsiteContext's applicationId route (pins
 * the Task-5 id-source — carried Ruling requirement C: this must GET
 * `/audit/onsite/application/:applicationId/context`, the applicationId
 * route, never an auditId route), and submitDecision's raw passthrough
 * body.
 */
import { describe, expect, it, jest, beforeEach } from '@jest/globals';

const post = jest.fn(async () => ({ success: true, data: {} }));
const get = jest.fn(async () => ({ success: true, data: {} }));
jest.mock('@/lib/api/api-client', () => ({ apiClient: { post: (...a: unknown[]) => post(...a), get: (...a: unknown[]) => get(...a) } }));

import { AuditService } from '../audit-service';

beforeEach(() => { post.mockClear(); get.mockClear(); });

describe('AuditService outgoing wire shapes (Task 12 — real seam, no service-level mock)', () => {
    it('startInspection posts {gps:{...}} nested, not flat gpsLat/gpsLng (fixes B6 on the FE-emission side)', async () => {
        await AuditService.startInspection('aud-1', { latitude: 13.75, longitude: 100.5, accuracy: 5, capturedAt: 't' });
        expect(post).toHaveBeenCalledWith('/audit/onsite/aud-1/start', { gps: { latitude: 13.75, longitude: 100.5, accuracy: 5, capturedAt: 't' } });
    });

    it('getOnsiteContext GETs the applicationId route, not an auditId route (carried Ruling requirement C / pins Task-5 id-source)', async () => {
        get.mockResolvedValueOnce({ success: true, data: { audit: { id: 'a' }, checklist: [] } });
        await AuditService.getOnsiteContext('app-1');
        expect(get).toHaveBeenCalledWith('/audit/onsite/application/app-1/context');
    });

    it('submitDecision posts the decision payload verbatim', async () => {
        await AuditService.submitDecision('aud-1', { decision: 'PASS', summary: 'ok', criticalFindings: [] });
        expect(post).toHaveBeenCalledWith('/audit/onsite/aud-1/decision', { decision: 'PASS', summary: 'ok', criticalFindings: [] });
    });

    it('uploadPhoto multipart body carries gps as a JSON string field (matches the BE string-JSON.parse branch, fixes B7 on the FE-emission side)', async () => {
        const file = new File(['x'], 'p.jpg', { type: 'image/jpeg' });
        await AuditService.uploadPhoto('aud-1', file, { itemId: '4.1', gps: { latitude: 13.75, longitude: 100.5, accuracy: 5, capturedAt: 't' } });
        expect(post).toHaveBeenCalledTimes(1);
        const [path, body] = post.mock.calls[0] as [string, FormData];
        expect(path).toBe('/audit/onsite/aud-1/photo');
        expect(body).toBeInstanceOf(FormData);
        expect(body.get('itemId')).toBe('4.1');
        expect(body.get('gps')).toBe(JSON.stringify({ latitude: 13.75, longitude: 100.5, accuracy: 5, capturedAt: 't' }));
        expect(body.get('photo')).toBeInstanceOf(File);
    });
});
