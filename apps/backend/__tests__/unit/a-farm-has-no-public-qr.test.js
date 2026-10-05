/**
 * A farm has no public QR code, and may not grow one back.
 *
 * ── WHAT WAS THERE ────────────────────────────────────────────────────────────
 * `GET /api/farms/:id/qrcode` returned a printable HTML sticker whose QR pointed
 * at `${appBaseUrl()}/verify/farm/<farm.id>`. Two things were wrong with it:
 *
 *   1. That URL does not exist. There is no /verify/farm page in the web app and
 *      no backend route behind it. Every sticker anyone printed leads to a 404.
 *   2. It embedded the farm's PRIMARY KEY in the printed code — the same handle
 *      removed from /trace/batch and /trace/lot on 2026-09-05, because a scanner
 *      holding it can correlate a farm's produce across scans and confirm the row
 *      through /trace/verify/FARM/<id>. On a printed sticker it cannot be recalled.
 *
 * ── WHY REMOVED RATHER THAN FIXED ─────────────────────────────────────────────
 * Operator ruling, 2026-09-05: "ถอดทิ้ง — ฟาร์มไม่ควรมี QR สาธารณะ." What a consumer
 * needs to check is the PRODUCE in their hand, and the packaging lot QR answers
 * exactly that. A QR at farm level would invite scanning a whole holding, which
 * is the "สืบเจ้าของ" the T&T scope forbids in its first principle.
 *
 * The lot QR (services/pdf/lot-label-template-service.js) is untouched — that is
 * the one printed on a box, and it is the point of the traceability system.
 */

'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Declarations only.
 *
 * The comment left where the method used to be necessarily names it, and a guard
 * that reads a MENTION as a DECLARATION punishes the note explaining the removal
 * — the same flaw already filed against ratchet.sh's hardcode and env-direct
 * patterns. Strip the prose, read the code.
 */
const read = (rel) => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8')
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n');

describe('the farm QR is gone', () => {
    test('farm-service no longer generates one', () => {
        const src = read('services/farm-service.js');
        expect(src).not.toMatch(/generateQRCode\s*\(/);
        expect(src).not.toContain('QRCode.toDataURL');
    });

    test('the route is gone too — a service with no door is only half a removal', () => {
        const src = read('routes/api/cultivation/farms.js');
        expect(src).not.toContain("'/:id/qrcode'");
        expect(src).not.toMatch(/generateQRCode\s*\(/);
    });

    test('nothing anywhere builds a /verify/farm/ link', () => {
        // The dead target. If it reappears, either the page was built (fine, and
        // this test should be revisited deliberately) or the dead link is back.
        const files = [
            'services/farm-service.js',
            'routes/api/cultivation/farms.js',
            'services/qrcode/qrcode-service.js',
        ];
        files.forEach((rel) => {
            expect(read(rel)).not.toContain('/verify/farm/');
        });
    });
});

describe('the QR that matters is untouched', () => {
    test('the packaging-lot sticker still carries a QR — that is the one on the box', () => {
        const src = read('services/pdf/lot-label-template-service.js');
        expect(src).toContain('QRCode.toDataURL');
        expect(src).toContain('traceBaseUrl');
    });

    test('and the certificate still carries its verify QR', () => {
        expect(read('services/pdf/certificate-template-service.js')).toContain('QRCode.toDataURL');
    });
});
