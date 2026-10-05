/**
 * audit-service.checklist.test.ts
 *
 * B3+B4: the checklist auto-save POSTed a raw `{itemId, answer, ...}` object
 * while the backend (`onsite.js:458-465`) destructures `req.body.items` —
 * every write silently 400'd, swallowed by the auto-save's `.catch()`. The
 * UI vocab (`YES`/`NO`/`NA`) also never matched the backend's stored vocab
 * (`PASS`/`FAIL`/`NA`). This test asserts the exact wire body
 * `submitChecklistItem` sends, at the single FE canonicalization point.
 */
import { describe, expect, it, jest, beforeEach } from '@jest/globals';

const post = jest.fn(async () => ({ success: true, data: [] }));
const get = jest.fn(async () => ({ success: true, data: {} }));
jest.mock('@/lib/api/api-client', () => ({ apiClient: { post: (...a: unknown[]) => post(...a), get: (...a: unknown[]) => get(...a) } }));

import { AuditService } from '../audit-service';

beforeEach(() => { post.mockClear(); });

describe('submitChecklistItem wire contract', () => {
    it('wraps in {items:[...]} and maps YES->PASS, itemId->itemCode', async () => {
        await AuditService.submitChecklistItem('aud-9', { itemId: '4.1', answer: 'YES', notes: 'ok', photoIds: ['p1'] });
        expect(post).toHaveBeenCalledWith('/audit/onsite/aud-9/checklist', {
            items: [{ itemCode: '4.1', response: 'PASS', notes: 'ok', photoIds: ['p1'] }],
        });
    });
    it('maps NO->FAIL and NA->NA, omits empty notes', async () => {
        await AuditService.submitChecklistItem('aud-9', { itemId: '1.1', answer: 'NO' });
        expect(post.mock.calls[0][1]).toEqual({ items: [{ itemCode: '1.1', response: 'FAIL' }] });
        post.mockClear();
        await AuditService.submitChecklistItem('aud-9', { itemId: '2.1', answer: 'NA' });
        expect(post.mock.calls[0][1]).toEqual({ items: [{ itemCode: '2.1', response: 'NA' }] });
    });
});

describe('getOnsiteContext savedAnswers read contract', () => {
    it('maps BE response->UI answer and preserves photoIds', async () => {
        get.mockResolvedValueOnce({ success: true, data: {
            audit: { id: 'aud-9', applicationId: 'app-9', applicationNumber: 'A-9', applicantName: 'x', farmAddress: '' },
            checklist: [], startedAt: undefined,
            savedAnswers: [{ itemId: '4.1', response: 'PASS', notes: 'n', photoIds: ['p1'] }],
        }});
        const res = await AuditService.getOnsiteContext('app-9');
        expect(res.data!.savedAnswers).toEqual([{ itemId: '4.1', answer: 'YES', notes: 'n', photoIds: ['p1'] }]);
    });
});

describe('verifyGps wire', () => {
    it('GETs gps-verify with lat/lng query params', async () => {
        get.mockResolvedValueOnce({ success: true, data: { withinTolerance: true } });
        await AuditService.verifyGps('aud-9', 13.75, 100.5);
        expect(get).toHaveBeenCalledWith('/audit/onsite/aud-9/gps-verify?lat=13.75&lng=100.5');
    });
});
