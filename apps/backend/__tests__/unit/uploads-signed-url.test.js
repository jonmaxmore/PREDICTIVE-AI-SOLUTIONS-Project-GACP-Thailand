/**
 * W1-2 — short-lived signed URLs for the private `/uploads` mount.
 *
 * WHY: a browser `<img src="/uploads/x.png">` cannot send an Authorization
 * header — it sends cookies only. `middleware/uploads-access.js` (correctly)
 * requires a session for every PDPA-sensitive `/uploads` path, so every private
 * uploaded image renders broken and every download link fails, even for the
 * file's own owner ("อัปโหลดไฟล์ หรือรูปไม่ได้").
 *
 * The fix is the standard mechanism, NOT a weakened gate: an authenticated
 * endpoint mints a URL that carries a time-limited signature, and the static
 * route accepts EITHER a valid unexpired signature OR an authenticated session.
 *
 * This suite pins the SIGNING MECHANISM that `services/storage-service.js`
 * owns, so it works for both storage providers (`local` HMAC / `minio` native
 * presign). Gate wiring is pinned in uploads-access-signed.test.js; entitlement
 * at mint time in uploads-signed-url-route.test.js.
 */
'use strict';

const AVATAR_KEY = '1787283122887-5591b610-37b1-4e9c-a7cf-d8ead4c460b7.png';
const SLIP_KEY = 'slips/1716000000000-def456.pdf';

describe('storage-service — signed object URLs (local provider / HMAC)', () => {
    let storage;

    beforeEach(() => {
        jest.resetModules();
        jest.useRealTimers();
        storage = require('../../services/storage-service');
    });

    test('mints a URL for the object path with an expiry + signature, and no secret in it', async () => {
        const minted = await storage.createSignedObjectUrl(AVATAR_KEY, {
            subject: 'user-owner-1',
            expiresInSeconds: 300,
        });

        expect(minted).toMatchObject({ provider: 'local' });
        expect(typeof minted.url).toBe('string');
        expect(minted.url.startsWith(`/uploads/${AVATAR_KEY}?`)).toBe(true);

        const query = Object.fromEntries(new URLSearchParams(minted.url.split('?')[1]));
        expect(query.sig).toBeTruthy();
        expect(Number(query.exp)).toBeGreaterThan(Math.floor(Date.now() / 1000));

        // The raw subject must never appear in the URL — only an opaque digest.
        expect(minted.url).not.toContain('user-owner-1');
        // expiresAt is reported so callers can schedule a refresh.
        expect(new Date(minted.expiresAt).getTime()).toBeGreaterThan(Date.now());
    });

    test('a freshly minted signature verifies for its own object', async () => {
        const minted = await storage.createSignedObjectUrl(AVATAR_KEY, { subject: 'user-owner-1' });
        const query = Object.fromEntries(new URLSearchParams(minted.url.split('?')[1]));

        expect(storage.verifySignedObjectRequest(AVATAR_KEY, query)).toEqual({ valid: true });
    });

    test('an EXPIRED signature does not verify', async () => {
        const minted = await storage.createSignedObjectUrl(AVATAR_KEY, {
            subject: 'user-owner-1',
            expiresInSeconds: 1,
        });
        const query = Object.fromEntries(new URLSearchParams(minted.url.split('?')[1]));

        const realNow = Date.now;
        Date.now = () => realNow() + 5000;
        try {
            expect(storage.verifySignedObjectRequest(AVATAR_KEY, query)).toEqual({
                valid: false,
                reason: 'EXPIRED',
            });
        } finally {
            Date.now = realNow;
        }
    });

    test('a TAMPERED signature does not verify', async () => {
        const minted = await storage.createSignedObjectUrl(AVATAR_KEY, { subject: 'user-owner-1' });
        const query = Object.fromEntries(new URLSearchParams(minted.url.split('?')[1]));

        const tampered = { ...query, sig: `${query.sig.slice(0, -2)}AA` };
        expect(storage.verifySignedObjectRequest(AVATAR_KEY, tampered).valid).toBe(false);
    });

    test('extending the expiry without re-signing does not verify', async () => {
        const minted = await storage.createSignedObjectUrl(AVATAR_KEY, { subject: 'user-owner-1' });
        const query = Object.fromEntries(new URLSearchParams(minted.url.split('?')[1]));

        const stretched = { ...query, exp: String(Number(query.exp) + 86400) };
        expect(storage.verifySignedObjectRequest(AVATAR_KEY, stretched).valid).toBe(false);
    });

    test('a signature minted for ONE object does not unlock another', async () => {
        const minted = await storage.createSignedObjectUrl(AVATAR_KEY, { subject: 'user-owner-1' });
        const query = Object.fromEntries(new URLSearchParams(minted.url.split('?')[1]));

        expect(storage.verifySignedObjectRequest(SLIP_KEY, query)).toEqual({
            valid: false,
            reason: 'BAD_SIGNATURE',
        });
    });

    test('a missing signature is not "valid by omission"', () => {
        expect(storage.verifySignedObjectRequest(AVATAR_KEY, {}).valid).toBe(false);
        expect(storage.verifySignedObjectRequest(AVATAR_KEY, { sig: '', exp: '' }).valid).toBe(false);
    });

    test('the lifetime is capped in minutes, not hours', async () => {
        const minted = await storage.createSignedObjectUrl(AVATAR_KEY, {
            subject: 'user-owner-1',
            expiresInSeconds: 86400, // caller asks for a day
        });
        const query = Object.fromEntries(new URLSearchParams(minted.url.split('?')[1]));
        const ttl = Number(query.exp) - Math.floor(Date.now() / 1000);

        expect(ttl).toBeLessThanOrEqual(storage.SIGNED_URL_MAX_TTL_SECONDS);
        expect(storage.SIGNED_URL_MAX_TTL_SECONDS).toBeLessThanOrEqual(900);
    });

    test('the signing key is derived from the secret manager, never a literal in code', () => {
        const source = require('fs').readFileSync(
            require('path').join(__dirname, '..', '..', 'services', 'storage-service.js'),
            'utf8',
        );
        expect(source).toContain("require('../config/secrets')");
        // No inline fallback secret may exist in this file.
        expect(source).not.toMatch(/signing[_-]?key\s*=\s*['"`][^'"`]{8,}['"`]/i);
    });
});

describe('storage-service — signed object URLs (minio provider / native presign)', () => {
    const ORIGINAL_ENV = { ...process.env };

    afterEach(() => {
        process.env = { ...ORIGINAL_ENV };
        jest.resetModules();
    });

    test('delegates to MinIO presignedGetObject instead of the local HMAC scheme', async () => {
        const presignedGetObject = jest.fn().mockResolvedValue(
            'http://minio:9000/gacp-uploads/slips/x.pdf?X-Amz-Signature=abc',
        );
        jest.resetModules();
        jest.doMock('minio', () => ({
            Client: jest.fn().mockImplementation(() => ({ presignedGetObject })),
        }));

        process.env.STORAGE_PROVIDER = 'minio';
        process.env.S3_ACCESS_KEY = 'test-access-key';
        process.env.S3_SECRET_KEY = 'test-secret-key';
        process.env.S3_BUCKET = 'gacp-uploads';

        const storage = require('../../services/storage-service');
        const minted = await storage.createSignedObjectUrl('slips/x.pdf', {
            subject: 'user-owner-1',
            expiresInSeconds: 300,
        });

        expect(presignedGetObject).toHaveBeenCalledTimes(1);
        const [bucket, key, ttl] = presignedGetObject.mock.calls[0];
        expect(bucket).toBe('gacp-uploads');
        expect(key).toBe('slips/x.pdf');
        expect(ttl).toBe(300);
        expect(minted.provider).toBe('minio');
        expect(minted.url).toContain('X-Amz-Signature');
    });
});
