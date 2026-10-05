/**
 * audit-photo-upload.test.ts
 *
 * The auditor's camera produces a watermarked Blob. The panel used to POST the
 * photo's id, coordinates, accuracy, timestamp and byte sizes — and not the
 * image — then show "ถ่ายรูป + บันทึกแล้ว". The evidence for a certification
 * decision was thrown away at the moment the auditor was told it was kept, and
 * a farm visit cannot be repeated once the auditor has driven home.
 *
 * These assertions are all one rule: the image goes, and "saved" is only ever
 * said when the server hands back a photoId.
 */

import { uploadAuditPhoto } from '../audit-photo-upload';

// A real Blob, not a stand-in: FormData.append rejects anything else, and the
// point of these tests is that the actual bytes reach the request.
const blob = (size = 1024) => new Blob([new Uint8Array(size)], { type: 'image/jpeg' });

const ok = (photoId = 'photo-1', fileHash = 'sha256:abc') =>
    jest.fn().mockResolvedValue({ success: true, data: { photoId, fileHash } });

describe('uploadAuditPhoto', () => {
    it('sends the image itself, not a description of it', async () => {
        const post = ok();
        await uploadAuditPhoto({ auditId: 'a-1', blob: blob(), latitude: 13.7, longitude: 100.5 }, { post });

        const [, body] = post.mock.calls[0];
        expect(body).toBeInstanceOf(FormData);
        expect(body.get('photo')).toBeTruthy();
    });

    it('posts to the onsite photo endpoint for that audit', async () => {
        const post = ok();
        await uploadAuditPhoto({ auditId: 'a-1', blob: blob(), latitude: null, longitude: null }, { post });
        expect(post.mock.calls[0][0]).toBe('/audit/onsite/a-1/photo');
    });

    it('carries the GPS the watermark claims, so the stored record can be checked against the image', async () => {
        const post = ok();
        await uploadAuditPhoto({
            auditId: 'a-1', blob: blob(), latitude: 13.736717, longitude: 100.523186,
            capturedAt: '2026-07-25T10:00:00.000Z',
        }, { post });

        const [, body] = post.mock.calls[0];
        expect(body.get('gpsLat')).toBe('13.736717');
        expect(body.get('gpsLng')).toBe('100.523186');
        expect(body.get('capturedAt')).toBe('2026-07-25T10:00:00.000Z');
    });

    it('omits coordinates rather than sending a fabricated zero when GPS is unavailable', async () => {
        // 0,0 is a real place in the Gulf of Guinea. Sending it would put an
        // auditor's evidence 8,000 km from the farm.
        const post = ok();
        await uploadAuditPhoto({ auditId: 'a-1', blob: blob(), latitude: null, longitude: null }, { post });

        const [, body] = post.mock.calls[0];
        expect(body.get('gpsLat')).toBeNull();
        expect(body.get('gpsLng')).toBeNull();
    });

    it('returns the photoId the server assigned', async () => {
        const result = await uploadAuditPhoto(
            { auditId: 'a-1', blob: blob(), latitude: null, longitude: null },
            { post: ok('photo-42', 'sha256:def') },
        );
        expect(result).toEqual({ photoId: 'photo-42', fileHash: 'sha256:def', error: null });
    });

    it('reports failure when the server answers without a photoId', async () => {
        // A 200 with no id is not a save. Treating it as one is how the panel
        // came to promise something that had not happened.
        const post = jest.fn().mockResolvedValue({ success: true, data: {} });
        const result = await uploadAuditPhoto({ auditId: 'a-1', blob: blob(), latitude: null, longitude: null }, { post });
        expect(result.photoId).toBeNull();
        expect(result.error).toBeTruthy();
    });

    it('reports failure when the request throws, and does not rethrow', async () => {
        const post = jest.fn().mockRejectedValue(new Error('offline'));
        const result = await uploadAuditPhoto({ auditId: 'a-1', blob: blob(), latitude: null, longitude: null }, { post });
        expect(result.photoId).toBeNull();
        expect(result.error).toMatch(/สัญญาณ|ลองใหม่|ถ่ายใหม่/);
    });

    it('refuses an empty blob without contacting the server', async () => {
        const post = jest.fn();
        const result = await uploadAuditPhoto({ auditId: 'a-1', blob: blob(0), latitude: null, longitude: null }, { post });
        expect(post).not.toHaveBeenCalled();
        expect(result.photoId).toBeNull();
        expect(result.error).toBeTruthy();
    });
});
