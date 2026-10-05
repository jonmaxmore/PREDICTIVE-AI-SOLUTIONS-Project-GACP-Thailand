/**
 * W3 (real-qr-codes, 2026-08-22) — decode-proof for the shared QR renderer.
 *
 * Everything else in this suite mocks `qrcode` (jsdom's canvas is a no-op —
 * see `src/__tests__/health-certificate-detail.test.tsx`). This file is the
 * ONE exception: it deliberately does NOT mock `qrcode`, so it exercises the
 * exact code path `QrImage` runs in production — `QRCode.toDataURL()` — then
 * independently DECODES the resulting PNG with a real QR reader (`jsqr`) and
 * asserts the decoded payload equals the URL we asked it to encode.
 *
 * This is real proof, not a trust-the-library assertion: if `QrImage`'s
 * options ever produced a code too small / too low-contrast / wrongly
 * encoded to scan, this test fails on the DECODE step, not just on "did
 * toDataURL resolve".
 *
 * Library note: `qrcode`'s Node entry point (`qrcode/lib/server.js`, see
 * package.json "main") renders PNGs via `pngjs` with no `<canvas>` — so
 * `QRCode.toDataURL` genuinely works under plain Node/Jest without a canvas
 * shim. `jsqr` + `pngjs` are added as devDependencies (test-only; not used by
 * any shipped page) purely to decode the PNG back into pixels for this proof.
 *
 * Fix-round 1 (review 6712f985): options come from `QrImage`'s own exported
 * `qrRenderOptions`, not a retyped copy — if the component's real options
 * ever drift, this test drifts with them instead of silently testing
 * something else.
 */

import QRCode from 'qrcode';
import { PNG } from 'pngjs';
import jsQR from 'jsqr';
import { qrRenderOptions } from '@/lib/qr/qr-render-options';

async function decodeDataUrl(dataUrl: string): Promise<string | null> {
    const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
    const buffer = Buffer.from(base64, 'base64');
    const png = PNG.sync.read(buffer);
    const result = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
    return result?.data ?? null;
}

describe('QrImage — real QR generation decodes back to the exact source value', () => {
    it('a certificate verify URL round-trips through generate -> decode', async () => {
        const value = 'https://gacpth.com/verify/GACP-TH-2569-85B448';
        const dataUrl = await QRCode.toDataURL(value, qrRenderOptions(176));
        expect(dataUrl.startsWith('data:image/png;base64,')).toBe(true);
        const decoded = await decodeDataUrl(dataUrl);
        expect(decoded).toBe(value);
    });

    it('a staging-host verify URL (the request-host build path) also round-trips', async () => {
        const value = 'https://staging.gacpth.com/verify/GACP-TH-2569-A3F7B2';
        const dataUrl = await QRCode.toDataURL(value, qrRenderOptions(176));
        const decoded = await decodeDataUrl(dataUrl);
        expect(decoded).toBe(value);
    });
});
