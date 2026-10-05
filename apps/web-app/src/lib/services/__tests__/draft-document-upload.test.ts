/**
 * draft-document-upload.test.ts
 *
 * One place decides what "uploaded" means.
 *
 * The wizard had two upload paths. Step 4 and step 8 used
 * InlineDocumentUpload, which POSTs to /applications/draft-documents and only
 * reports success when the server returns a fileUrl. Step 5's land-title and
 * water-test pickers had no upload path at all — they wrote the File into
 * React state, showed a green "attached" chip, and the bytes were gone on
 * reload. DTAM received neither document.
 *
 * Two paths meant one of them could be wrong without anyone noticing. This
 * module is the single path, and these tests pin the one rule that matters:
 * a URL is returned only when the server actually produced one. Every other
 * outcome — a rejection, a malformed response, an oversized file — must
 * surface as an error the caller has to render, never as a silent success.
 */

import { describe, expect, it, jest } from '@jest/globals';

import { uploadDraftDocument } from '../draft-document-upload';

const file = (name = 'chanote.pdf', size = 1024) =>
    ({ name, size, type: 'application/pdf' }) as unknown as File;

describe('uploadDraftDocument', () => {
    it('returns the url the server produced', async () => {
        const post = jest.fn(async () => ({ success: true, data: { fileUrl: '/uploads/drafts/a/chanote.pdf' } }));
        const result = await uploadDraftDocument(
            { file: file(), slotId: 'CHANOTE', stepKey: 'farm_info' },
            { post: post as never },
        );
        expect(result).toEqual({ url: '/uploads/drafts/a/chanote.pdf', error: null });
        expect(post).toHaveBeenCalledTimes(1);
    });

    it('reports an error when the server replies without a fileUrl', async () => {
        // A 200 with no url is not a success. Treating it as one is how the
        // original bug shipped: the UI believed it, the server had nothing.
        const post = jest.fn(async () => ({ success: true, data: {} }));
        const result = await uploadDraftDocument(
            { file: file(), slotId: 'CHANOTE' },
            { post: post as never },
        );
        expect(result.url).toBeNull();
        expect(result.error).toBeTruthy();
    });

    it('reports an error when the request is rejected', async () => {
        const post = jest.fn(async () => ({ success: false, data: null }));
        const result = await uploadDraftDocument(
            { file: file(), slotId: 'CHANOTE' },
            { post: post as never },
        );
        expect(result.url).toBeNull();
        expect(result.error).toBeTruthy();
    });

    it('reports an error when the request throws, rather than propagating', async () => {
        // The farmer is mid-form; an unhandled rejection would blank the step.
        const post = jest.fn(async () => { throw new Error('network down'); });
        const result = await uploadDraftDocument(
            { file: file(), slotId: 'CHANOTE' },
            { post: post as never },
        );
        expect(result.url).toBeNull();
        expect(result.error).toBeTruthy();
    });

    it('rejects an oversized file without sending it', async () => {
        const post = jest.fn(async () => ({ success: true, data: { fileUrl: '/uploads/x' } }));
        const result = await uploadDraftDocument(
            { file: file('big.pdf', 11 * 1024 * 1024), slotId: 'CHANOTE', maxSizeMB: 10 },
            { post: post as never },
        );
        expect(result.url).toBeNull();
        expect(result.error).toContain('10');
        expect(post).not.toHaveBeenCalled();
    });

    it('states its errors in Thai — these reach the applicant directly', async () => {
        const post = jest.fn(async () => { throw new Error('boom'); });
        const result = await uploadDraftDocument(
            { file: file(), slotId: 'CHANOTE' },
            { post: post as never },
        );
        expect(result.error).not.toMatch(/[A-Za-z]{4,}/);
    });

    it('sends the slot and step so the server can file the document', async () => {
        const captured: Array<[string, FormData]> = [];
        const post = jest.fn(async (path: string, body: FormData) => {
            captured.push([path, body]);
            return { success: true, data: { fileUrl: '/uploads/x' } };
        });
        await uploadDraftDocument(
            { file: file(), slotId: 'WATER_TEST', stepKey: 'farm_info', draftId: 'draft-1' },
            { post: post as never },
        );
        const [path, form] = captured[0]!;
        expect(path).toBe('/applications/draft-documents');
        expect(form.get('slotId')).toBe('WATER_TEST');
        expect(form.get('stepKey')).toBe('farm_info');
        expect(form.get('draftId')).toBe('draft-1');
    });

    it('omits draftId when there is none, rather than sending the string "undefined"', async () => {
        const captured: FormData[] = [];
        const post = jest.fn(async (_path: string, body: FormData) => {
            captured.push(body);
            return { success: true, data: { fileUrl: '/uploads/x' } };
        });
        await uploadDraftDocument({ file: file(), slotId: 'CHANOTE' }, { post: post as never });
        expect(captured[0]!.has('draftId')).toBe(false);
    });
});
