/**
 * F-G4-08 — the browser half of the upload rules.
 *
 * Two things have to be true at once and they pull in opposite directions:
 *
 *   - a file that is wrong must be refused HERE, so the farmer hears why the
 *     moment they pick it rather than after a slow upload on a phone;
 *   - a browser that cannot read the bytes must refuse NOTHING, because the
 *     server is the gate and a browser quirk must never be the reason someone
 *     cannot file an application.
 *
 * jsdom has no Blob.arrayBuffer, which is also true of Safari before 14, so
 * these tests exercise the FileReader path a real old phone would take.
 */

import { checkUploadInBrowser, readUploadHead } from '../client-upload-check';

/** The exact 70-byte pixel from the G4 walk. */
const WALK_PIXEL_PNG = Uint8Array.from(
    Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        'base64',
    ),
);

function realPdf(bytes = 14029): Uint8Array {
    const header = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n', 'utf8');
    return Uint8Array.from(Buffer.concat([header, Buffer.alloc(Math.max(0, bytes - header.length), 0x20)]));
}

function realJpeg(bytes = 40000): Uint8Array {
    const soi = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
    return Uint8Array.from(Buffer.concat([soi, Buffer.alloc(Math.max(0, bytes - soi.length), 0x11)]));
}

const asFile = (bytes: Uint8Array, name: string, type = '') =>
    new File([bytes], name, ...(type ? [{ type }] : []));

describe('reading the leading bytes in a browser', () => {
    test('works through FileReader when Blob.arrayBuffer is missing (jsdom, Safari < 14)', async () => {
        const head = await readUploadHead(asFile(WALK_PIXEL_PNG, 'pixel.png'));
        expect(head).not.toBeNull();
        expect(Array.from(head!.subarray(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
    });
});

describe('the walk pixel, refused before it is ever sent', () => {
    test('a PDF-only slot says it is the wrong kind of file', async () => {
        const verdict = await checkUploadInBrowser(asFile(WALK_PIXEL_PNG, 'pixel.png', 'image/png'), {
            slotType: 'PDF',
        });
        expect(verdict.ok).toBe(false);
        expect(verdict.code).toBe('FILE_TYPE_MISMATCH');
        expect(verdict.message).toContain('PDF');
    });

    test('a purpose-licence slot refuses it by slot id alone', async () => {
        const verdict = await checkUploadInBrowser(asFile(WALK_PIXEL_PNG, 'pixel.png'), { slotId: 'licence_pt11' });
        expect(verdict.ok).toBe(false);
        expect(verdict.code).toBe('FILE_TYPE_MISMATCH');
    });

    test('a photo slot refuses it for having no content in it', async () => {
        const verdict = await checkUploadInBrowser(asFile(WALK_PIXEL_PNG, 'pixel.png'), { slotId: 'EXTERIOR_PHOTOS' });
        expect(verdict.ok).toBe(false);
        expect(verdict.code).toBe('FILE_TOO_SMALL');
    });
});

describe('a sender who renames the file', () => {
    test('photo.png saved as deed.pdf with a PDF content type is still a photo', async () => {
        const padded = Uint8Array.from(Buffer.concat([Buffer.from(WALK_PIXEL_PNG), Buffer.alloc(60000)]));
        const verdict = await checkUploadInBrowser(asFile(padded, 'deed.pdf', 'application/pdf'), {
            slotId: 'LAND_TITLE',
        });
        expect(verdict.ok).toBe(false);
        expect(verdict.code).toBe('FILE_TYPE_MISMATCH');
    });
});

describe('the legitimate cases pass', () => {
    test('a real permit PDF fills a PDF slot', async () => {
        expect(await checkUploadInBrowser(asFile(realPdf(), 'ภท.11.pdf'), { slotId: 'LICENCE_PT11' }))
            .toEqual({ ok: true });
    });

    test('a phone photo fills a photo slot', async () => {
        expect(await checkUploadInBrowser(asFile(realJpeg(), 'IMG_0431.jpg'), { slotId: 'EXTERIOR_PHOTOS' }))
            .toEqual({ ok: true });
    });
});

describe('when the browser cannot read the bytes at all', () => {
    test('nothing is refused — the server answers instead', async () => {
        // A File-like object with no slice, which is what an exotic or very old
        // runtime hands us. Refusing here would lock a farmer out of the wizard
        // over a browser quirk; the server still applies the identical rules.
        const unreadable = { name: 'scan.pdf', size: 12, type: 'application/pdf' } as unknown as File;
        expect(await readUploadHead(unreadable)).toBeNull();
        expect(await checkUploadInBrowser(unreadable, { slotId: 'LICENCE_PT11' })).toEqual({ ok: true });
    });
});
