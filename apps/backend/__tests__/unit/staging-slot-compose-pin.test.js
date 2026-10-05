'use strict';

/**
 * The whole safety of the staging slot rests on ONE fact: the marker exists in
 * the staging overlay and nowhere in the production compose. That fact lives
 * in YAML no unit test of auth-providers.js can see, so it is pinned here —
 * the same move as REQUIRED_VOLUMES in gacp-backup.selftest.sh, where the
 * test owns the list instead of deriving it from the thing under test.
 *
 * ถ้าเทสต์ที่สองแดง แปลว่ามีคนใส่ marker ลง compose ของ production จริง =
 * mock IdP เปิดได้บนโปรดักชัน — นั่นคือเหตุผลเดียวที่ไฟล์นี้มีอยู่
 * (คู่กับ describe('staging slot (GACP_DEPLOY_SLOT)') ใน
 * __tests__/unit/auth-providers-config.test.js ที่ปักฝั่ง logic)
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

describe('GACP_DEPLOY_SLOT placement', () => {
    test('the staging overlay sets the marker INSIDE the backend-staging service block', () => {
        // Scoped on an audit finding: the first version regex-matched the whole
        // file, so the marker moving to another service — or into a comment —
        // stayed green while the assertion's stated meaning was false. This
        // slices the backend-staging block (its service key up to the next
        // service key at the same indent) and requires a real environment line
        // inside it.
        const yml = read('docker-compose.staging.yml');
        const start = yml.indexOf('  backend-staging:');
        expect(start).toBeGreaterThan(-1);
        const rest = yml.slice(start + 2);
        const next = rest.search(/\n  [a-zA-Z][\w-]*:/);
        const block = next === -1 ? rest : rest.slice(0, next);
        expect(block).toMatch(/^\s*-\s*GACP_DEPLOY_SLOT=staging\s*$/m);
    });

    test('NO compose file except the staging overlay carries the marker — set discovered, not listed', () => {
        // Deep review: the original checked docker-compose.production.yml only,
        // while docker-compose.yml, .bluegreen, .qa, .local-prod and
        // .test.local also exist — a marker in any of them enables the mock
        // IdP wherever that file deploys. Discovery covers tomorrow's file too.
        const files = fs.readdirSync(ROOT).filter((f) => /^docker-compose.*.yml$/.test(f));
        expect(files).toContain('docker-compose.staging.yml');
        for (const f of files) {
            if (f === 'docker-compose.staging.yml') continue;
            expect({ file: f, hasMarker: /GACP_DEPLOY_SLOT/.test(read(f)) })
                .toEqual({ file: f, hasMarker: false });
        }
    });
});
