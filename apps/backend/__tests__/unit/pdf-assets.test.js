/**
 * Phase 2 dedup — services/pdf/pdf-assets.js is the single source for the DTAM
 * logo data URL, replacing three byte-identical getLogoDataUrl() copies in
 * application-/invoice-/certificate-template-service.
 */

const path = require('path');
const fs = require('fs');
const pdfAssets = require('../../services/pdf/pdf-assets');
const pdfGenerator = require('../../services/pdf/pdf-generator.service');

describe('pdf-assets.getLogoDataUrl', () => {
    it('returns a base64 data:image/png URI for the shared logo', () => {
        const url = pdfAssets.getLogoDataUrl();
        expect(url.startsWith('data:image/png;base64,')).toBe(true);
        // The payload must be the actual logo file, base64-encoded.
        const expected = `data:image/png;base64,${fs.readFileSync(pdfAssets.LOGO_PATH).toString('base64')}`;
        expect(url).toBe(expected);
    });

    it('memoises — repeated calls return the identical string reference', () => {
        const a = pdfAssets.getLogoDataUrl();
        const b = pdfAssets.getLogoDataUrl();
        expect(a).toBe(b);
    });

    it('LOGO_PATH points at the real shared asset that exists on disk', () => {
        expect(pdfAssets.LOGO_PATH).toBe(path.join(pdfAssets.SHARED_DIR, 'gacpthai-logo.png'));
        expect(fs.existsSync(pdfAssets.LOGO_PATH)).toBe(true);
    });

    it('every template service delegates to this single source', () => {
        // Anti-regression: none of them should re-declare a local getLogoDataUrl.
        //
        // Was "the three template services" and named application-template-service
        // first. That service built the summary PDF the platform invented for
        // itself; the /applications/:id/pdf door renders the ministry's own
        // แบบกัญชา กทล.๑ now, it lost its last caller, and it is deleted
        // (2026-09-05). The list is discovered rather than typed, so the next
        // template service is covered on the day it is written instead of the day
        // somebody remembers to add it here.
        const dir = path.join(__dirname, '..', '..', 'services', 'pdf');
        const services = fs.readdirSync(dir).filter((f) => f.endsWith('-template-service.js'));
        expect(services.length).toBeGreaterThanOrEqual(3);

        let delegating = 0;
        for (const file of services) {
            const src = fs.readFileSync(path.join(dir, file), 'utf8');

            // Applies to EVERY template service, always: a local copy is the
            // regression this test was written for.
            expect(src).not.toMatch(/function getLogoDataUrl\s*\(/);
            expect(src).not.toMatch(/@font-face\s*\{/);

            // Delegation applies to the ones that actually put a logo or a font
            // on the page. lot-label-template-service prints 100x100mm QR
            // stickers and references neither — requiring it to import an asset
            // module it does not use would be ceremony, not a guard.
            const usesBranding = /logo|font-family|Sarabun/i.test(src);
            if (usesBranding) {
                expect(src).toContain("require('./pdf-assets')");
                delegating += 1;
            }
        }
        // If this ever drops to zero the loop above has stopped checking anything.
        expect(delegating).toBeGreaterThanOrEqual(3);
    });
});

/**
 * Data sovereignty (2026-07-25) — Sarabun is vendored, not fetched.
 * Every PDF template used to @import the face from a foreign font CDN on every
 * render. These tests pin the replacement so it cannot quietly regress.
 */
describe('pdf-assets.getSarabunFontFaceCss — locally embedded Sarabun', () => {
    it('emits one @font-face per vendored face, all as data: URIs', () => {
        const css = pdfAssets.getSarabunFontFaceCss();
        // 6 faces (400/500/600/700/800 upright + 400 italic) × 2 subsets (thai, latin).
        expect((css.match(/@font-face/g) || []).length).toBe(12);
        expect(css).toContain("font-family:'Sarabun'");
        expect(css).toContain('font-style:italic');
        // Nothing but data: URIs — no remote host of any kind.
        expect(css).not.toMatch(/url\((?!data:)/);
        expect(css).not.toMatch(/https?:/);
    });

    it('memoises — repeated calls return the identical string reference', () => {
        expect(pdfAssets.getSarabunFontFaceCss()).toBe(pdfAssets.getSarabunFontFaceCss());
    });

    it('every required woff2 file is actually present in the vendored font dir', () => {
        for (const weight of [400, 500, 600, 700, 800]) {
            for (const subset of ['thai', 'latin']) {
                const f = path.join(pdfAssets.FONT_DIR, `sarabun-${subset}-${weight}-normal.woff2`);
                expect(fs.existsSync(f)).toBe(true);
            }
        }
        for (const subset of ['thai', 'latin']) {
            expect(fs.existsSync(path.join(pdfAssets.FONT_DIR, `sarabun-${subset}-400-italic.woff2`))).toBe(true);
        }
    });

    it('the generator injects the face block into <head> of every rendered document', () => {
        const html = '<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8"></head><body>ใบรับรอง</body></html>';
        const out = pdfGenerator.injectSarabunFontFace(html);
        expect(out).toContain('data-gacp-font="sarabun-local"');
        expect(out.indexOf('data-gacp-font')).toBeLessThan(out.indexOf('<body'));
        expect(out).toContain('ใบรับรอง');
    });

    it('no PDF template or report service references a remote font host', () => {
        const pdfDir = path.join(__dirname, '..', '..', 'services', 'pdf');
        const files = [
            ...fs.readdirSync(path.join(pdfDir, 'templates'))
                .filter((f) => f.endsWith('.html'))
                .map((f) => path.join(pdfDir, 'templates', f)),
            path.join(pdfDir, 'audit-report-service.js'),
            path.join(pdfDir, 'car-report-service.js'),
        ];
        for (const file of files) {
            const src = fs.readFileSync(file, 'utf8');
            // Strip comments — a comment explaining the past removal is fine,
            // a live @import is not.
            const live = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '');
            expect(live).not.toMatch(/@import\s+url\(/);
            expect(live).not.toMatch(/fonts\.(googleapis|gstatic)\.com/); // third-party-allow: asserts the host is absent
        }
    });
});
