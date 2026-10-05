/**
 * A public scan answers about the thing that was scanned — not with the
 * platform's primary keys.
 *
 * ── THE RULE, AND WHOSE IT IS ─────────────────────────────────────────────────
 * design note 2026-09-05-tnt-data-scope §1, approved principle 1:
 * "ข้อมูลเปิดมีไว้ให้ตรวจสอบคุณภาพ ไม่ใช่ให้สืบเจ้าของ" — open data exists so a
 * consumer can check quality, not so anyone can investigate the owner. The table
 * marks internal farm/application ids ❌, "เป็นมือจับสำหรับไล่เดา" — a handle for
 * guessing — and notes that `toPublicFarm` already omits them, correctly.
 *
 * ── WHAT WAS ACTUALLY SHIPPED ─────────────────────────────────────────────────
 * The generic `/trace/:qrCode` path was audited when that spec was written. The
 * batch and lot paths were not, and they build their payloads inline. Both hand
 * an anonymous scanner:
 *
 *     farm.id                the farm's primary key
 *     source.plot.plotId     internal ids for rows the scanner did not scan
 *     source.plot.cyclePlotId
 *     source.cycle.cycleId
 *
 * The farm key is the one that matters. A scan is of ONE package; with the farm's
 * id a scanner can correlate every batch and lot of that farm across scans, and
 * `/trace/verify/FARM/<id>` will confirm the row exists. Nothing on the public
 * pages renders any of them — they were passed through because the row was
 * already loaded.
 *
 * Lot and batch ids stay: they ARE the public addresses. The QR printed on the
 * package points at /trace/lot/<id>, so handing them back is the feature.
 *
 * ── SCOPE ─────────────────────────────────────────────────────────────────────
 * Structural, over the route sources, because the alternative is standing up the
 * whole trace stack to assert an absence. An absence is exactly what a leak test
 * has to prove, and the payload shape is written literally in these files.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const BACKEND = path.join(__dirname, '..', '..');
const ROUTES = path.join(BACKEND, 'routes', 'api', 'trace');

/**
 * 2026-09-06: the payload is no longer written only in the route files. The farm block
 * and the lab block moved into shared projections when the second public scan path was
 * brought up to the same ruling, so a file list that stops at `routes/api/trace` would
 * let a leak in by RELOCATION — the guard would keep passing while the field it forbids
 * moved one require away.
 */
const PROJECTIONS = [
    path.join(BACKEND, 'services', 'trace-service', 'public-farm.js'),
    path.join(BACKEND, 'services', 'lab-evidence-service.js'),
];

/** The response-building region only — request handling above it is not payload. */
function payloadSource(file) {
    const src = fs.readFileSync(path.isAbsolute(file) ? file : path.join(ROUTES, file), 'utf8');
    return src.split('\n')
        // Declarations, not mentions: a comment explaining why an id is absent
        // must not read as the id being present.
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
        .join('\n');
}

describe('the batch and lot scans carry no key the scanner did not scan', () => {
    const src = payloadSource('trace-batch-lot-routes.js');

    test('the farm\'s primary key is not published', () => {
        // `id: batch.farm.id` / `id: lot.batch.farm.id` — the exact leak.
        expect(src).not.toMatch(/farm\s*:\s*[^;]*?\bid\s*:/s);
        expect(src).not.toMatch(/\.farm\.id/);
    });

    test.each([
        ['plotId'],
        ['cyclePlotId'],
        ['cycleId'],
    ])('%s — an internal key for a row with no public page — is not published', (field) => {
        expect(src).not.toMatch(new RegExp(`\\b${field}\\s*:`));
    });

    test('plot and cycle names are not public either (operator ruling 2026-09-05)', () => {
        // The first version of this file kept them, on the developer's judgement
        // that a name helps traceability and is not PII. The operator ruled
        // otherwise: "ไม่ควรเห็น — ตัดออกจากหน้าสาธารณะ". They are the farm's own
        // internal labelling — a plot name can carry a person ("แปลงหลังบ้านลุงมี")
        // and a cycle name reveals production cadence — and a consumer checking
        // quality does not need to know which plot the produce came from.
        expect(src).not.toContain('plotName');
        expect(src).not.toContain('cycleName');
    });

    test('the farm name stays — that is what a consumer checks the produce against', () => {
        // 2026-09-06: the route stopped hand-writing the farm block and now hands the row
        // to the one shared projection, so the literal moved. The claim is unchanged — the
        // name must still reach the scanner — so the assertion follows it rather than
        // being deleted, and it is proved by CALLING the projection, not by grepping it.
        expect(src).toMatch(/farm\s*:\s*toPublicFarm\(/);
        const { toPublicFarm } = require('../../services/trace-service/public-farm');
        expect(toPublicFarm({ farmName: 'สวนทดสอบ', district: 'อ', province: 'จ' }).name)
            .toBe('สวนทดสอบ');
    });

    test('the addresses the QR itself points at are still returned', () => {
        // lotId and batchId are the public trace addresses printed on packaging;
        // withholding them would break the very navigation the QR exists for.
        expect(src).toMatch(/\blotId\s*:/);
        expect(src).toMatch(/\bbatchId\s*:/);
    });
});

describe('no public trace route publishes grower PII or a projection', () => {
    const FILES = [
        'trace.js', 'trace-batch-lot-routes.js', 'trace-verification-routes.js', 'lots.js',
        ...PROJECTIONS,
    ];
    const FORBIDDEN = [
        // §1: GPS leads to a person's home; a projection is a business position.
        'latitude', 'longitude', 'gpsCoordinates', 'estimatedYield',
        // §1: the grower's identity is never open data.
        'nationalId', 'idCardNumber', 'ownerName', 'farmerName',
    ];

    test.each(FILES)('%s', (file) => {
        const src = payloadSource(file);
        const found = FORBIDDEN.filter((f) => new RegExp(`\\b${f}\\b`).test(src));
        expect(found).toEqual([]);
    });
});

describe('the public surface is enumerated, so a new door cannot be quiet', () => {
    test('every route file under routes/api/trace is covered above', () => {
        const files = fs.readdirSync(ROUTES).filter((f) => f.endsWith('.js'));
        // If a file appears here that the PII sweep does not name, this fails and
        // the new door gets read before it ships.
        expect(files.sort()).toEqual(
            ['lots.js', 'trace-batch-lot-routes.js', 'trace-verification-routes.js', 'trace.js'].sort(),
        );
    });
});
