'use strict';
/**
 * One catalogue (apps/backend/shared/instalment-service-names.js), one copy per client.
 *
 * Screens read names + coverage from the server (GET /api/pricing/fees `services`,
 * GET /applications/:id/quotations `copy.services`, GET /invoices/my `service`). Where a
 * client needs the words without a server answer, it reads exactly ONE local copy:
 *   web    apps/web-app/src/constants/fee-service-catalogue.json, exported to screens only
 *          through apps/web-app/src/lib/pricing/fee-services.ts
 *   mobile apps/mobile-app/lib/domain/fee_service_catalogue.dart
 * Both copies are pinned equal to the catalogue here, and no other web or mobile source
 * may spell a catalogue name, its noun (the name without "งวดที่ N ") or its coverage.
 *
 * round 5 (review): the previous version of this guard checked only the coverage strings,
 * while ~20 web files and 2 Dart files spelled the names — the guard said "one copy" and
 * the tree said otherwise.
 */

const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '../../../..');
const WEB_MIRROR = path.join(REPO, 'apps/web-app/src/constants/fee-service-catalogue.json');
const DART_COPY = path.join(REPO, 'apps/mobile-app/lib/domain/fee_service_catalogue.dart');
const ALLOWED = new Set([
    'apps/web-app/src/constants/fee-service-catalogue.json',
    'apps/web-app/src/lib/pricing/fee-services.ts',
    'apps/mobile-app/lib/domain/fee_service_catalogue.dart',
]);
const { SERVICE_CATALOGUE } = require('../../shared/instalment-service-names');

const noun = (name) => name.replace(/^งวดที่ \d+ /, '');
const LITERALS = Object.values(SERVICE_CATALOGUE).flatMap((e) => [noun(e.name), e.coverage]);

function walk(dir, exts, out = []) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) {
            if (!/^(node_modules|__tests__|__mocks__|generated|\.dart_tool|build)$/.test(ent.name)) { walk(full, exts, out); }
        } else if (exts.test(ent.name) && !/\.test\.|_test\.dart$/.test(ent.name)) {
            out.push(full);
        }
    }
    return out;
}

/** Lines that are code: `//` and `*` lines and block comments opening a line are skipped. */
function codeLines(text) {
    const out = [];
    let inBlock = false;
    text.split('\n').forEach((line, i) => {
        const t = line.trim();
        if (inBlock) { if (t.includes('*/')) { inBlock = false; } return; }
        if (t.startsWith('/*') || t.startsWith('{/*')) { if (!t.includes('*/')) { inBlock = true; } return; }
        if (t.startsWith('//') || t.startsWith('*')) { return; }
        out.push({ n: i + 1, line: line.replace(/(^|\s)\/\/(?!\/).*$/, '') });
    });
    return out;
}

describe('the client copies equal the catalogue', () => {
    test('web JSON mirror, field for field', () => {
        const mirror = JSON.parse(fs.readFileSync(WEB_MIRROR, 'utf8'));
        const pick = ({ name, nameEn, coverage, coverageEn }) => ({ name, nameEn, coverage, coverageEn });
        expect(Object.keys(mirror).sort()).toEqual(Object.keys(SERVICE_CATALOGUE).sort());
        for (const key of Object.keys(SERVICE_CATALOGUE)) {
            expect(mirror[key]).toEqual(pick(SERVICE_CATALOGUE[key]));
        }
    });

    test('mobile Dart copy: every name and coverage', () => {
        expect(fs.existsSync(DART_COPY)).toBe(true);
        const src = fs.readFileSync(DART_COPY, 'utf8');
        const value = (id) => {
            const m = new RegExp(`static const String ${id}\\s*=\\s*'([^']*)';`).exec(src);
            return m ? m[1] : null;
        };
        const map = { PHASE_1: 'phase1', PHASE_2: 'phase2', RENEWAL: 'renewal' };
        for (const [key, id] of Object.entries(map)) {
            expect(value(`${id}Name`)).toBe(SERVICE_CATALOGUE[key].name);
            expect(value(`${id}Coverage`)).toBe(SERVICE_CATALOGUE[key].coverage);
        }
    });
});

describe('no other web or mobile source spells the catalogue', () => {
    test('names, nouns and coverage appear only in the allowed files', () => {
        const files = [
            ...walk(path.join(REPO, 'apps/web-app/src'), /\.(ts|tsx|json)$/),
            ...walk(path.join(REPO, 'apps/mobile-app/lib'), /\.dart$/),
        ];
        expect(files.length).toBeGreaterThan(100);
        const hits = [];
        for (const file of files) {
            const rel = path.relative(REPO, file);
            if (ALLOWED.has(rel)) { continue; }
            for (const { n, line } of codeLines(fs.readFileSync(file, 'utf8'))) {
                for (const lit of LITERALS) {
                    if (line.includes(lit)) { hits.push(`${rel}:${n}  «${lit.slice(0, 40)}»`); }
                }
            }
        }
        expect(hits).toEqual([]);
    });
});
