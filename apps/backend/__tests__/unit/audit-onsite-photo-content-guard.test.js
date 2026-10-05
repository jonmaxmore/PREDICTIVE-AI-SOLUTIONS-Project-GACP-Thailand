/**
 * audit-onsite-photo-content-guard.test.js — F-G4-08, third door.
 *
 * POST /api/audit/onsite/:auditId/photo checked only that `req.file` existed.
 * The 70-byte 1x1 transparent PNG that the G4 walk pushed through three
 * document slots went through here too, and this door is not a reviewer's
 * inbox: it feeds the photo COUNT that assertOnsiteEvidenceSufficient uses to
 * decide whether a certificate may be minted. Five pixels satisfied a gate whose
 * entire purpose is to prove an auditor stood on the farm.
 *
 * These tests drive the REAL router (routes/api/audit/onsite.js) through
 * supertest with only its collaborators mocked, and multer faked so each test
 * chooses the exact bytes that arrive. The service is mocked so its call args
 * can be asserted verbatim — the gps/itemId/caption contract a previous fix
 * restored must survive the guard being added in front of it.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const express = require('express');
const request = require('supertest');
const sharp = require('sharp');

// The bytes the faked multer hands the route, and an optional multer error to
// raise instead of delivering a file (LIMIT_FILE_SIZE etc). Each test sets
// these. The `mock` prefix is what lets the hoisted jest.mock factory below
// close over them.
let mockInjectedFile = null;
let mockInjectedError = null;

jest.mock('../../middleware/auth-middleware', () => {
    const u = (req, _res, next) => {
        req.user = { id: 'auditor-1', role: 'auditor', canonicalRole: 'auditor', organizationId: 'org-1' };
        next();
    };
    return {
        authenticateProvider: u,
        authenticateHealth: u,
        authenticateAny: u,
        requireRole: () => (_req, _res, next) => next(),
    };
});
jest.mock('../../shared/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock('../../services/prisma-database', () => ({ prisma: { auditChecklist: { findFirst: jest.fn(async () => null) } } }));

jest.mock('multer', () => {
    const m = () => ({
        single: () => (req, _res, next) => {
            if (mockInjectedError) { next(mockInjectedError); return; }
            req.file = mockInjectedFile;
            next();
        },
    });
    m.memoryStorage = () => ({});
    return m;
});

const onsiteService = require('../../services/audit-onsite-service');
jest.mock('../../services/audit-onsite-service', () => ({
    CHECKLIST_TEMPLATE_2026: [],
    startInspection: jest.fn(async () => ({ ok: true })),
    submitChecklistItem: jest.fn(async (a) => ({ id: 'row', ...a })),
    uploadPhoto: jest.fn(async () => ({ photoId: 'photo-1', url: '/uploads/audits/aud-1/x.jpg', fileHash: 'h' })),
    submitDecision: jest.fn(async () => ({ audit: {}, transition: {}, notify: null })),
    verifyGpsAgainstFarm: jest.fn(async () => ({ withinTolerance: true })),
}));

const uploadContentGuard = require('../../services/upload-content-guard');
const { MIN_DOCUMENT_BYTES } = require('@gacp/validation/upload-rules');

const router = require('../../routes/api/audit/onsite');
const app = express();
app.use(express.json());
app.use('/api/audit/onsite', router);

/** The exact 70-byte 1x1 transparent PNG the G4 walk used. */
const G4_PIXEL = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
);

/** A real 1200x900 photograph from the G4 audit walk (evidence/g4-rebuild-2026-08-25/a07). */
const REAL_PHOTO = fs.readFileSync(path.join(__dirname, '../fixtures/onsite-farm-photo.jpg'));

function fileOf(buffer, originalname = 'photo.jpg', mimetype = 'image/jpeg') {
    return { buffer, size: buffer.length, originalname, mimetype };
}

/** Structurally a PNG, but padded rather than photographed. */
function paddedPng(totalBytes) {
    const buf = Buffer.alloc(totalBytes, 0x41);
    G4_PIXEL.subarray(0, 8).copy(buf, 0);
    return buf;
}

/**
 * Files built once, with a real encoder, for the tests that need a file that is
 * genuinely what it claims to be.
 *
 * Built rather than committed as blobs so each one's shape is readable here:
 * what makes REAL_PNG_PHOTO acceptable and PADDED_ONE_PIXEL_PNG unacceptable is
 * one property (its dimensions), and a pair of opaque .png fixtures would hide
 * that.
 */
let REAL_PNG_PHOTO;
let PADDED_ONE_PIXEL_PNG;

/**
 * A real 1x1 PNG carried past this door's BYTE floor by a valid tEXt chunk.
 *
 * This is the file that proves the byte floor and the decode are different
 * checks: it is a structurally perfect PNG that any viewer opens, it clears
 * MIN_ONSITE_PHOTO_BYTES, and it is still one pixel of nothing.
 */
function padOnePixelPng(base, padBytes) {
    const type = Buffer.from('tEXt');
    const data = Buffer.concat([Buffer.from('Comment\0'), Buffer.alloc(padBytes, 0x41)]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(Buffer.concat([type, data])));
    // Ancillary chunks are legal anywhere before IEND, which is the last 12 bytes.
    const iendAt = base.length - 12;
    return Buffer.concat([base.subarray(0, iendAt), length, type, data, crc, base.subarray(iendAt)]);
}

beforeAll(async () => {
    REAL_PNG_PHOTO = await sharp(REAL_PHOTO).resize(800, 600).png().toBuffer();
    const onePixel = await sharp({
        create: { width: 1, height: 1, channels: 3, background: { r: 200, g: 200, b: 200 } },
    }).png().toBuffer();
    PADDED_ONE_PIXEL_PNG = padOnePixelPng(onePixel, 5000);
});

function postPhoto(body = {}) {
    return request(app).post('/api/audit/onsite/aud-1/photo').send(body);
}

beforeEach(() => {
    jest.clearAllMocks();
    mockInjectedFile = null;
    mockInjectedError = null;
});

describe('POST /photo refuses anything that is not a photograph of a site', () => {
    test('the 70-byte G4 pixel is refused, and never reaches the service', async () => {
        mockInjectedFile = fileOf(G4_PIXEL, 'IMG_0001.png', 'image/png');

        const res = await postPhoto({ gps: JSON.stringify({ latitude: 13.75, longitude: 100.5 }) });

        expect(res.status).toBe(400);
        expect(res.body.code).toBe('FILE_TOO_SMALL');
        expect(onsiteService.uploadPhoto).not.toHaveBeenCalled();
        // The refusal names the cause AND the next action, in Thai, and quotes
        // the file back so the auditor can check it against what they picked.
        expect(res.body.error).toContain('IMG_0001.png');
        expect(res.body.error).toContain('70 ไบต์');
        expect(res.body.error).toContain('ภาพถ่ายจากหน้างานจริง');
        expect(res.body.error).toContain('คุณสามารถ');
        // api-client shows `error`; both fields carry the sentence, never a bare code.
        expect(res.body.message).toBe(res.body.error);
    });

    test('a padded file above the DOCUMENT floor but below this door\'s floor is still refused', async () => {
        // 2,500 bytes clears MIN_DOCUMENT_BYTES (1,835) — proof the floor applied
        // here is the photo population's own number, not the document one reused.
        const padded = paddedPng(2500);
        expect(padded.length).toBeGreaterThan(MIN_DOCUMENT_BYTES);
        mockInjectedFile = fileOf(padded, 'padded.png', 'image/png');

        const res = await postPhoto();

        expect(res.status).toBe(400);
        expect(res.body.code).toBe('FILE_TOO_SMALL');
        expect(onsiteService.uploadPhoto).not.toHaveBeenCalled();
    });

    test('a PDF is refused: a document is not evidence of a site visit', async () => {
        // Declared image/jpeg, so the mimetype whitelist passes it; the bytes do not.
        const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(60000, 0x20)]);
        mockInjectedFile = fileOf(pdf, 'report.jpg', 'image/jpeg');

        const res = await postPhoto();

        expect(res.status).toBe(400);
        expect(res.body.code).toBe('FILE_TYPE_MISMATCH');
        expect(res.body.error).toContain('ไฟล์ PDF');
        expect(onsiteService.uploadPhoto).not.toHaveBeenCalled();
    });

    test('bytes matching no image signature are refused as unreadable', async () => {
        mockInjectedFile = fileOf(Buffer.alloc(60000, 0x41), 'photo.jpg', 'image/jpeg');

        const res = await postPhoto();

        expect(res.status).toBe(400);
        expect(res.body.code).toBe('FILE_TYPE_UNREADABLE');
        expect(onsiteService.uploadPhoto).not.toHaveBeenCalled();
    });

    test('an empty file is refused', async () => {
        mockInjectedFile = fileOf(Buffer.alloc(0), 'photo.jpg', 'image/jpeg');

        const res = await postPhoto();

        expect(res.status).toBe(400);
        expect(res.body.code).toBe('FILE_EMPTY');
        expect(onsiteService.uploadPhoto).not.toHaveBeenCalled();
    });

    test('a photo past the 10 MB ceiling is refused by the guard, not only by multer', async () => {
        const huge = Buffer.alloc(uploadContentGuard.MAX_ONSITE_PHOTO_BYTES + 1);
        REAL_PHOTO.subarray(0, 16).copy(huge, 0);
        mockInjectedFile = fileOf(huge, 'huge.jpg', 'image/jpeg');

        const res = await postPhoto();

        expect(res.status).toBe(400);
        expect(res.body.code).toBe('FILE_TOO_LARGE');
        expect(res.body.error).toContain('10 MB');
        expect(onsiteService.uploadPhoto).not.toHaveBeenCalled();
    });

    test('multer aborting an oversize write answers 413 in Thai, not a 500 in English', async () => {
        const err = new Error('File too large');
        err.code = 'LIMIT_FILE_SIZE';
        mockInjectedError = err;

        const res = await postPhoto();

        // 413 since BACK-16 (2026-09-17), like every other multer size refusal.
        expect(res.status).toBe(413);
        expect(res.body.code).toBe('FILE_TOO_LARGE');
        expect(res.body.error).toContain('10 MB');
        expect(res.body.error).toContain('คุณสามารถ');
    });

    test('a part whose declared type is not an image answers 400 in Thai', async () => {
        const err = new Error('Only JPEG/PNG/WebP image uploads are allowed');
        err.code = 'INVALID_FILE_TYPE';
        err.statusCode = 400;
        mockInjectedError = err;

        const res = await postPhoto();

        expect(res.status).toBe(400);
        expect(res.body.code).toBe('FILE_TYPE_MISMATCH');
        expect(res.body.error).toContain('คุณสามารถ');
    });

    test('no file at all still answers PHOTO_FILE_REQUIRED (the guard did not swallow it)', async () => {
        mockInjectedFile = null;

        const res = await postPhoto();

        expect(res.status).toBe(400);
        expect(res.body.code).toBe('PHOTO_FILE_REQUIRED');
    });
});

describe('POST /photo still accepts a real photograph, with its contract intact', () => {
    test('a real onsite JPEG passes and reaches the service with gps, itemId and caption', async () => {
        mockInjectedFile = fileOf(REAL_PHOTO, 'IMG_2041.jpg', 'image/jpeg');

        const res = await request(app).post('/api/audit/onsite/aud-1/photo').send({
            gps: JSON.stringify({ latitude: 13.75, longitude: 100.5, capturedAt: '2026-08-26T02:00:00Z' }),
            itemId: '4.1',
            caption: 'แปลงปลูกด้านทิศเหนือ',
        });

        expect(res.status).toBe(200);
        // The B7 contract: nested gps parsed to finite numbers, itemId carried
        // as checklistItemCode, caption preserved. A guard in front of the
        // handler must not quietly drop any of it.
        expect(onsiteService.uploadPhoto).toHaveBeenCalledWith(expect.objectContaining({
            auditId: 'aud-1',
            fileName: 'IMG_2041.jpg',
            mimeType: 'image/jpeg',
            gpsLat: 13.75,
            gpsLng: 100.5,
            checklistItemCode: '4.1',
            caption: 'แปลงปลูกด้านทิศเหนือ',
            uploadedBy: 'auditor-1',
            organizationId: 'org-1',
        }));
        const forwarded = onsiteService.uploadPhoto.mock.calls[0][0];
        expect(Buffer.isBuffer(forwarded.fileBuffer)).toBe(true);
        // The bytes the service hashes are the bytes the guard inspected.
        expect(forwarded.fileBuffer.equals(REAL_PHOTO)).toBe(true);
        expect(res.body.data).toEqual({ photoId: 'photo-1', url: '/uploads/audits/aud-1/x.jpg', fileHash: 'h' });
    });

    test('a real PNG photograph is accepted too (the pixel is caught by the floor, not by its format)', async () => {
        // A genuine 800x600 PNG, not a PNG signature with padding behind it:
        // since layer 4 landed, "structurally a PNG" is no longer the same claim
        // as "is a PNG", and this test is about the format being allowed.
        mockInjectedFile = fileOf(REAL_PNG_PHOTO, 'shot.png', 'image/png');

        const res = await postPhoto({ gps: JSON.stringify({ latitude: 13.75, longitude: 100.5 }) });

        expect(res.status).toBe(200);
        expect(onsiteService.uploadPhoto).toHaveBeenCalled();
    });
});

/* ── Layer 4: the file has to DECODE ─────────────────────────────────────────
 *
 * The adversarial review of 2026-08-26: five buffers of FFD8FFE0 followed by
 * 4,000 random bytes each were ACCEPTED here as kind=jpeg, hashed to five
 * distinct SHA-256s, and the evidence gate answered MINT ALLOWED with
 * photoCount=5. Every layer this door had read only what the first bytes
 * CLAIMED. sharp().metadata() throws on all five: they are not images.
 */
describe('POST /photo refuses a file that only STARTS like a photograph', () => {
    /** The review's own buffer: a four-byte JPEG hat on random noise. */
    function jpegHatOnNoise(bodyBytes = 4000) {
        return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), crypto.randomBytes(bodyBytes)]);
    }

    test('the five buffers that produced MINT ALLOWED with photoCount=5 are all refused', async () => {
        const hashes = new Set();
        for (let i = 0; i < 5; i += 1) {
            const noise = jpegHatOnNoise();
            hashes.add(crypto.createHash('sha256').update(noise).digest('hex'));
            // Each one clears every cheap layer: it sniffs as JPEG and it is
            // 4,004 bytes, above this door's byte floor.
            expect(noise.length).toBeGreaterThan(uploadContentGuard.MIN_ONSITE_PHOTO_BYTES);
            mockInjectedFile = fileOf(noise, `IMG_400${i}.jpg`, 'image/jpeg');

            const res = await postPhoto({ gps: JSON.stringify({ latitude: 13.75, longitude: 100.5 }) });

            expect(res.status).toBe(400);
            expect(res.body.code).toBe('IMAGE_NOT_DECODABLE');
        }
        // Five DISTINCT files, so the gate's distinct-hash count would have seen
        // five photos, and not one of them reached the service.
        expect(hashes.size).toBe(5);
        expect(onsiteService.uploadPhoto).not.toHaveBeenCalled();
    });

    test('a decode failure answers 400 in Thai naming the cause and the next action, not a 500', async () => {
        mockInjectedFile = fileOf(jpegHatOnNoise(), 'IMG_4001.jpg', 'image/jpeg');

        const res = await postPhoto();

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.error).toContain('IMG_4001.jpg');
        expect(res.body.error).toContain('เป็นรูปภาพไม่ได้');
        expect(res.body.error).toContain('คุณสามารถ');
        expect(res.body.error).not.toMatch(/[A-Za-z]{5,}\s+[A-Za-z]{5,}/); // no English sentence leaked
        expect(res.body.message).toBe(res.body.error);
    });

    test('a REAL photograph\'s header on a random body is refused too', async () => {
        // The generalisation of the review's file, and the reason the probe
        // decode exists: metadata() reports 1200x900 for this buffer, because
        // the header really is a photograph's. Only reading the pixels finds out
        // there are none.
        const franken = Buffer.concat([REAL_PHOTO.subarray(0, 2000), crypto.randomBytes(50000)]);
        const meta = await sharp(franken, { limitInputPixels: false }).metadata();
        expect(meta.width).toBe(1200);
        mockInjectedFile = fileOf(franken, 'IMG_4100.jpg', 'image/jpeg');

        const res = await postPhoto();

        expect(res.status).toBe(400);
        expect(res.body.code).toBe('IMAGE_NOT_DECODABLE');
        expect(onsiteService.uploadPhoto).not.toHaveBeenCalled();
    });

    test('a perfectly valid 1x1 PNG, padded past the byte floor, is refused on its dimensions', async () => {
        expect(PADDED_ONE_PIXEL_PNG.length).toBeGreaterThan(uploadContentGuard.MIN_ONSITE_PHOTO_BYTES);
        // It decodes: this is a real image file, which is exactly why no byte
        // count and no signature check could ever have caught it.
        const meta = await sharp(PADDED_ONE_PIXEL_PNG).metadata();
        expect([meta.width, meta.height]).toEqual([1, 1]);
        mockInjectedFile = fileOf(PADDED_ONE_PIXEL_PNG, 'IMG_0002.png', 'image/png');

        const res = await postPhoto();

        expect(res.status).toBe(400);
        expect(res.body.code).toBe('IMAGE_DIMENSIONS_TOO_SMALL');
        expect(res.body.error).toContain('1 x 1 พิกเซล');
        expect(res.body.error).toContain('คุณสามารถ');
        expect(onsiteService.uploadPhoto).not.toHaveBeenCalled();
    });

    test('a real WebP photograph passes, so layer 4 admits every kind layer 1 does', async () => {
        // The decoder's format name and the byte sniffer's kind have to agree
        // for all three accepted kinds, or the door would refuse a format it
        // advertises. JPEG and PNG are covered above; this is the third.
        const webp = await sharp(REAL_PHOTO).resize(1024, 768).webp().toBuffer();
        mockInjectedFile = fileOf(webp, 'IMG_2043.webp', 'image/webp');

        const res = await postPhoto({ gps: JSON.stringify({ latitude: 13.75, longitude: 100.5 }) });

        expect(res.status).toBe(200);
        expect(onsiteService.uploadPhoto).toHaveBeenCalled();
    });

    test('a genuinely small but real photograph (VGA) still passes', async () => {
        // The auditor whose phone only shoots 640x480 must not be refused: layer
        // 4 is here to catch files that are not photographs, not to demand a
        // better camera than the one in the field.
        const vga = await sharp(REAL_PHOTO).resize(640, 480).jpeg({ quality: 60 }).toBuffer();
        mockInjectedFile = fileOf(vga, 'IMG_2042.jpg', 'image/jpeg');

        const res = await postPhoto({ gps: JSON.stringify({ latitude: 13.75, longitude: 100.5 }) });

        expect(res.status).toBe(200);
        expect(onsiteService.uploadPhoto).toHaveBeenCalled();
    });
});

/* The dimension rule is exercised at the numbers rather than through files: a
 * test for the pixel CEILING would otherwise have to allocate the very
 * decompression bomb the ceiling exists to refuse. */
describe('the dimension rule admits cameras and refuses tokens', () => {
    const verdict = (width, height) => uploadContentGuard.onsitePhotoDimensionVerdict({
        width, height, fileName: 'x.jpg',
    });

    test.each([
        ['the G4 pixel', 1, 1],
        ['an 8x8 icon', 8, 8],
        ['a QVGA thumbnail no camera on the farm produced', 320, 240],
    ])('%s is refused', (_label, w, h) => {
        expect(verdict(w, h).code).toBe('IMAGE_DIMENSIONS_TOO_SMALL');
    });

    test.each([
        ['the smallest real downscale this door has measured', 480, 360],
        ['VGA, the lowest resolution a phone camera has ever produced', 640, 480],
        ['the same VGA frame shot in portrait', 480, 640],
        ['what the G4 walk actually captured', 1200, 900],
        ['a 48 MP full-resolution flagship frame', 8000, 6000],
    ])('%s is accepted', (_label, w, h) => {
        expect(verdict(w, h).ok).toBe(true);
    });

    test('a decompression bomb is refused on its DECLARED size, before anything decodes it', () => {
        const bomb = verdict(30000, 30000); // 900 MP, ~2.7 GB expanded
        expect(bomb.code).toBe('IMAGE_DIMENSIONS_TOO_LARGE');
        // The advice is one the auditor can act on standing in a field.
        expect(bomb.message).toContain('ความละเอียดต่ำลง');
    });

    test('a decoder that reports no dimensions is a refusal, not a pass', () => {
        expect(uploadContentGuard.onsitePhotoDimensionVerdict({}).code).toBe('IMAGE_NOT_DECODABLE');
    });

    test('the floor sits below every camera capture and above every token', () => {
        // 360 is the shorter edge of the 480x360 downscale that
        // MIN_ONSITE_PHOTO_BYTES was itself measured against, so the byte floor
        // and the pixel floor admit the same real photographs.
        expect(uploadContentGuard.MIN_ONSITE_PHOTO_EDGE_PX).toBe(360);
        expect(uploadContentGuard.MIN_ONSITE_PHOTO_EDGE_PX).toBeLessThan(480);
        expect(uploadContentGuard.MAX_ONSITE_PHOTO_PIXELS).toBe(50 * 1000 * 1000);
    });
});

describe('the floor on this door is derived from the photo population, not borrowed', () => {
    test('it is the geometric mean of the measured content-free and real photo bounds', () => {
        // Measured 2026-08-26. Content-free upper bound: the largest 1-pixel
        // file across the kinds this door accepts (1x1 JPEG = 267 bytes; the
        // 101 pixels in public/uploads are PNG at 67-70). Real lower bound: the
        // smallest photograph the G4 audit walk actually captured
        // (evidence/g4-rebuild-2026-08-25/a07/photos/photo-4.jpg = 45,611).
        const largestOnePixelFile = 267;
        const smallestRealOnsitePhoto = 45611;
        expect(uploadContentGuard.MIN_ONSITE_PHOTO_BYTES)
            .toBe(Math.round(Math.sqrt(largestOnePixelFile * smallestRealOnsitePhoto)));
    });

    test('it sits clear of both bounds, and below even a VGA-resolution real photo', () => {
        const floor = uploadContentGuard.MIN_ONSITE_PHOTO_BYTES;
        expect(floor).toBeGreaterThan(70 * 10);
        // A real onsite scene re-encoded at 640x480 q60 measures 9,359 bytes.
        // An auditor whose phone only shoots VGA must not be refused.
        expect(floor).toBeLessThan(9359);
        // It is a different number from the document floor for a different
        // population, not that constant reused.
        expect(floor).not.toBe(MIN_DOCUMENT_BYTES);
    });
});
