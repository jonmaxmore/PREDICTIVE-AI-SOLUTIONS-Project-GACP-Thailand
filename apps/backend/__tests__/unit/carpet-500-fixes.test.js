/**
 * Regression guards for the two HTTP-500 bugs found by the live staging API
 * carpet sweep (2026-06-05). Both were RUNTIME failures that the existing
 * static/auth tests did not catch, so these pin the specific code shapes that
 * caused the 500s.
 *
 * Source-assertion style (per application-audit-fixes.test.js) — the route
 * handlers wire prisma + auth middleware that are heavy to boot in jsdom, so we
 * assert the load-bearing source markers instead.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', '..', ...p), 'utf8');

describe('[carpet-500] BUG-1 — revision-deadline GET must not lose `this` on resolveHealthIdentity', () => {
    const src = read('routes', 'api', 'applications', 'revision-deadline.js');

    it('does NOT destructure resolveHealthIdentity off the service (drops `this` → 500)', () => {
        // The bug: `const { resolveHealthIdentity } = require('...application-service')`
        // then calling it bare lost the `this` binding, so the method's internal
        // `this.normalizeIdentityValue(...)` threw "is not a function" → 500 for
        // every health user.
        expect(src).not.toMatch(/const\s*\{\s*resolveHealthIdentity\s*\}\s*=\s*require/);
    });

    it('calls it bound on the service object with the canonical args', () => {
        expect(src).toMatch(/applicationService\.resolveHealthIdentity\(\s*req\.user\.id\s*,\s*getHealthScopeOptions\(req\.user\)/);
        expect(src).toMatch(/getHealthScopeOptions.*require\(.*applications-helpers/s);
    });
});

describe('[carpet-500] BUG-2 — lot print-label select must use only real Farm fields', () => {
    const svc = read('services', 'traceability-service.js');

    it('findLotPrintLabelPayload does NOT select the non-existent Farm.farmNameTH', () => {
        // The bug: selecting `farmNameTH` (which Farm does not have) made
        // prisma.lot.findUnique throw "Unknown field" for EVERY id, so
        // GET /api/lots/:id/qr/print returned 500 on all input.
        const fn = svc.slice(svc.indexOf('function findLotPrintLabelPayload'));
        const body = fn.slice(0, fn.indexOf('\n}'));
        // strip comments so an explanatory comment mentioning the field doesn't
        // false-trip the guard.
        const code = body.replace(/\/\/[^\n]*/g, '');
        expect(code).toContain('farm:');
        expect(code).not.toMatch(/farmNameTH:\s*true/);
        expect(code).toMatch(/farmName:\s*true/);
    });

    it('the lot print-label handler no longer reads farm.farmNameTH', () => {
        const route = read('routes', 'api', 'helpers', 'lots-utility-routes.js');
        expect(route).not.toContain('farm.farmNameTH');
    });
});
