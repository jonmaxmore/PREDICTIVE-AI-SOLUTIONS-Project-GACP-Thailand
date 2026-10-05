'use strict';

/**
 * The fingerprint has to survive what a cryptographic hash cannot.
 *
 * Onsite evidence is counted by distinct SHA-256 of the file bytes. An adversarial review on
 * 2026-08-26 defeated that with one photograph re-saved five times: five distinct digests,
 * five accepted uploads, a minimum of five satisfied. A perceptual hash is the layer that
 * answers "is this the same photograph?" instead of "are these the same bytes?".
 *
 * These tests build their images rather than reading fixtures, for a reason discovered while
 * writing them: the repo's only photo set (evidence/g4-rebuild-2026-08-25/a07) is generated
 * by scripts/g4/make-photo-fixture.js — five labelled frames on one layout, visually near
 * identical by construction. Measured against them, a re-encode and a "different" photo are
 * indistinguishable (1-7 bits vs 8-11), which is the hash reporting the truth about those
 * images and useless as a test of whether it can tell photographs apart. Shapes that
 * genuinely differ are what prove the property.
 *
 * Nothing here asserts that a near-duplicate is REFUSED, because it must not be — see the
 * module header. The subject is measurement, not enforcement.
 */

const sharp = require('sharp');
const {
    perceptualHash,
    hammingDistance,
    isNearDuplicate,
    HASH_BITS,
} = require('../../services/crypto/perceptual-hash');

const jpeg = (svg, quality = 90) => sharp(Buffer.from(svg)).jpeg({ quality }).toBuffer();

const CIRCLE = '<svg width="640" height="480"><rect width="640" height="480" fill="#111"/>'
    + '<circle cx="160" cy="120" r="90" fill="#fff"/></svg>';
const RECTANGLE = '<svg width="640" height="480"><rect width="640" height="480" fill="#fff"/>'
    + '<rect x="400" y="300" width="200" height="150" fill="#000"/></svg>';
const GRADIENT = '<svg width="640" height="480"><defs><linearGradient id="g">'
    + '<stop offset="0%" stop-color="#000"/><stop offset="100%" stop-color="#fff"/>'
    + '</linearGradient></defs><rect width="640" height="480" fill="url(#g)"/></svg>';

describe('perceptualHash', () => {
    it('is 64 bits, written as 16 hex characters', async () => {
        const hash = await perceptualHash(await jpeg(CIRCLE));

        expect(HASH_BITS).toBe(64);
        expect(hash).toMatch(/^[0-9a-f]{16}$/);
    });

    it('is stable: the same bytes always give the same hash', async () => {
        const bytes = await jpeg(CIRCLE);

        expect(await perceptualHash(bytes)).toBe(await perceptualHash(bytes));
    });

    it('refuses bytes that are not a decodable image, rather than inventing a hash', async () => {
        // The upload door decides what refusal MEANS; this module only declines to guess.
        const notAnImage = Buffer.concat([
            Buffer.from([0xff, 0xd8, 0xff, 0xe0]),      // a JPEG hat on random bytes — the
            Buffer.alloc(4000, 7),                       // exact shape that passed the byte
        ]);                                              // sniffer in the review.

        await expect(perceptualHash(notAnImage)).rejects.toThrow();
        await expect(perceptualHash(Buffer.alloc(0))).rejects.toThrow(TypeError);
        await expect(perceptualHash(null)).rejects.toThrow(TypeError);
    });
});

describe('the re-encode attack no longer produces a new photograph', () => {
    // Each case is a way to change every byte of a file without changing what it shows.
    it.each([95, 88, 85, 75, 60, 55])('survives a JPEG re-encode at quality %i', async (quality) => {
        const original = await jpeg(CIRCLE);
        const resaved = await sharp(original).jpeg({ quality }).toBuffer();

        // Sanity: the bytes really did change, or this test proves nothing.
        expect(resaved.equals(original)).toBe(false);

        expect(hammingDistance(
            await perceptualHash(original), await perceptualHash(resaved),
        )).toBeLessThanOrEqual(5);
    });

    it('survives a resize', async () => {
        const original = await jpeg(CIRCLE);
        const smaller = await sharp(original).resize({ width: 200 }).toBuffer();

        expect(hammingDistance(
            await perceptualHash(original), await perceptualHash(smaller),
        )).toBeLessThanOrEqual(5);
    });

    it('survives EXIF being stripped, which a re-encode does for free', async () => {
        const withExif = await sharp(Buffer.from(CIRCLE))
            .withMetadata({ exif: { IFD0: { Software: 'gacp-test' } } })
            .jpeg({ quality: 90 })
            .toBuffer();
        const stripped = await sharp(withExif).jpeg({ quality: 90 }).toBuffer();

        expect(hammingDistance(
            await perceptualHash(withExif), await perceptualHash(stripped),
        )).toBeLessThanOrEqual(5);
    });
});

describe('genuinely different pictures stay far apart', () => {
    it.each([
        ['circle vs rectangle', CIRCLE, RECTANGLE],
        ['circle vs gradient', CIRCLE, GRADIENT],
        ['rectangle vs gradient', RECTANGLE, GRADIENT],
    ])('%s', async (_name, a, b) => {
        const distance = hammingDistance(
            await perceptualHash(await jpeg(a)), await perceptualHash(await jpeg(b)),
        );

        // Comfortably outside the transformation band above, which is what makes the
        // highlighting threshold meaningful rather than arbitrary.
        expect(distance).toBeGreaterThan(10);
    });
});

describe('hammingDistance', () => {
    it('counts differing bits, not differing characters', () => {
        expect(hammingDistance('0000000000000000', '0000000000000000')).toBe(0);
        // 'f' vs '0' is four bits, in one character.
        expect(hammingDistance('f000000000000000', '0000000000000000')).toBe(4);
        expect(hammingDistance('ffffffffffffffff', '0000000000000000')).toBe(64);
    });

    it('is case-insensitive and tolerates surrounding whitespace', () => {
        expect(hammingDistance(' ABCDEF0123456789 ', 'abcdef0123456789')).toBe(0);
    });

    it('refuses to compare things that are not comparable', () => {
        expect(() => hammingDistance('abc', 'abcd')).toThrow(TypeError);
        expect(() => hammingDistance('', '')).toThrow(TypeError);
        expect(() => hammingDistance('zzzzzzzzzzzzzzzz', '0000000000000000')).toThrow(TypeError);
    });
});

describe('isNearDuplicate', () => {
    it('answers on the distance, and the caller may set its own threshold', async () => {
        const a = await perceptualHash(await jpeg(CIRCLE));
        const b = await perceptualHash(await sharp(await jpeg(CIRCLE)).jpeg({ quality: 55 }).toBuffer());
        const far = await perceptualHash(await jpeg(RECTANGLE));

        expect(isNearDuplicate(a, b)).toBe(true);
        expect(isNearDuplicate(a, far)).toBe(false);
        // A caller that wants only exact visual matches can say so.
        expect(isNearDuplicate(a, far, 64)).toBe(true);
    });
});
