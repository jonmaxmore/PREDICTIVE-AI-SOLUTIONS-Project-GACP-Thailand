/**
 * One QR identifier format across the platform: a UUID.
 *
 * Operator ruling, 2026-09-05: "รวมเป็น uuid อย่างเดียว."
 *
 * ── WHAT THERE WAS ────────────────────────────────────────────────────────────
 * Two formats for one idea:
 *
 *   crypto.randomUUID()                 planting cycles, harvest batches, lots,
 *                                       the auto-trace bootstrap — six files
 *   `TR-<base36 time>-<8 hex>`          generateQRCodeString(prefix), with 'CY'
 *                                       and 'BT' variants — two files
 *
 * The second is guessable in a way the first is not: the time component narrows
 * the search to whatever was created that second, leaving 4 random bytes. On a
 * public trace address that is the difference between "you must have scanned the
 * package" and "you can try".
 *
 * ── AND ONE OF THE TWO CALLERS THREW ITS RESULT AWAY ──────────────────────────
 * POST /api/trace/generate computed the string before branching, then the CYCLE
 * branch returned `cycle.uuid` and never used it. Only the BATCH branch persisted
 * it — which is how both formats ended up in one column.
 *
 * ── COMPATIBILITY, CHECKED BEFORE DELETING ────────────────────────────────────
 * Queried on the real database first: zero rows in harvest_batches or lots carry
 * a PREFIX-format code. Nothing existing has to keep resolving, so this is a
 * removal rather than a migration.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8')
    .split('\n')
    // Declarations, not mentions — the note recording the removal names it.
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n');

describe('the prefix format is gone', () => {
    test.each([
        ['services/trace-service/common.js'],
        ['routes/api/trace/trace.js'],
        ['routes/api/trace/trace-verification-routes.js'],
    ])('%s no longer defines, exports or calls generateQRCodeString', (rel) => {
        expect(read(rel)).not.toContain('generateQRCodeString');
    });

    test('nothing builds a TR-/CY-/BT- code any more', () => {
        ['services/trace-service/common.js', 'routes/api/trace/trace-verification-routes.js']
            .forEach((rel) => {
                const src = read(rel);
                expect(src).not.toMatch(/['"`](TR|CY|BT)-/);
                expect(src).not.toMatch(/toString\(36\)\.toUpperCase\(\)/);
            });
    });
});

describe('the one format is the UUID the rest of the platform already used', () => {
    test('the regenerate door mints a UUID', () => {
        const src = read('routes/api/trace/trace-verification-routes.js');
        expect(src).toMatch(/generateQRCodeId\s*\(/);
    });

    test('it is minted where it is USED, not before the branch that ignores it', () => {
        // The old code computed the id at the top of the handler; the CYCLE
        // branch then returned cycle.uuid and dropped it. A value computed for
        // nobody is how the second format survived unnoticed.
        const src = read('routes/api/trace/trace-verification-routes.js');
        const handler = src.slice(src.indexOf("router.post('/generate'"));
        const mintAt = handler.indexOf('generateQRCodeId');
        const batchAt = handler.indexOf("type === 'BATCH'");
        expect(mintAt).toBeGreaterThan(batchAt);
    });

    test('the qrcode service is still the one place a trace id is minted', () => {
        const src = read('services/qrcode/qrcode-service.js');
        expect(src).toMatch(/generateQRCodeId\s*\(\s*\)\s*\{/);
        expect(src).toContain('crypto.randomUUID()');
    });
});
