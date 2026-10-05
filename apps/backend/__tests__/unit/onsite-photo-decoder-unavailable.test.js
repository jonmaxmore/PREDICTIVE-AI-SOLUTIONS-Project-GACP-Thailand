/**
 * onsite-photo-decoder-unavailable.test.js — layer 4 fails CLOSED.
 *
 * The onsite photo door decodes every file before it can become certificate
 * evidence (upload-content-guard, layer 4). A guard that holds only while its
 * decoder loads is not a guard: if a broken deployment silently went back to
 * accepting whatever the first four bytes claimed, the review's noise buffers
 * would answer MINT ALLOWED again and nothing in the product would say so.
 *
 * Its own file because it needs sharp to be UNLOADABLE, and every other test of
 * this door needs the real decoder.
 */

'use strict';

// Not `{ virtual: true }`: sharp really is installed, and a virtual mock of an
// installed module registers under a key the resolver does not reach, so the
// real decoder answered whenever another suite had already loaded it — the mock
// held only when this file ran alone, which is the worst possible way for a
// fail-closed test to behave.
jest.mock('sharp', () => {
    // How a missing native binding actually presents: require() throws.
    throw new Error('Could not load the sharp module using the win32-x64 runtime');
});

jest.mock('../../shared/logger', () => ({
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));
jest.mock('../../services/storage-service', () => ({ resolveWithinUploads: () => null }));

const fs = require('fs');
const path = require('path');
const logger = require('../../shared/logger');
const uploadContentGuard = require('../../services/upload-content-guard');

const REAL_PHOTO = fs.readFileSync(path.join(__dirname, '../fixtures/onsite-farm-photo.jpg'));

describe('when the image decoder cannot be loaded', () => {
    test('a real photograph is refused rather than waved through unchecked', async () => {
        const verdict = await uploadContentGuard.inspectOnsitePhotoUpload({
            buffer: REAL_PHOTO,
            size: REAL_PHOTO.length,
            originalname: 'IMG_2041.jpg',
            mimetype: 'image/jpeg',
        });

        expect(verdict.ok).toBe(false);
        expect(verdict.code).toBe('IMAGE_INSPECTION_UNAVAILABLE');
        // The auditor did nothing wrong, so the next action is not "re-shoot".
        expect(verdict.message).toContain('แจ้งผู้ดูแลระบบ');
        expect(verdict.message).not.toContain('ถ่ายภาพใหม่ด้วยกล้อง');
        // And the server says so loudly, so a broken deployment is visible to
        // the people who can fix it. Asserted in this test rather than its own,
        // because the decoder is loaded once per process: the load, and its one
        // log line, happen on the first photo only.
        expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Image decoder unavailable'));
    });

    test('the cheap layers still answer first, so their refusals keep their own reasons', async () => {
        // A decoder failure must not turn every refusal into one blanket code:
        // an auditor who picked a PDF is still told it is a PDF.
        const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(60000, 0x20)]);
        const verdict = await uploadContentGuard.inspectOnsitePhotoUpload({
            buffer: pdf,
            size: pdf.length,
            originalname: 'report.jpg',
            mimetype: 'image/jpeg',
        });

        expect(verdict.code).toBe('FILE_TYPE_MISMATCH');
    });
});
