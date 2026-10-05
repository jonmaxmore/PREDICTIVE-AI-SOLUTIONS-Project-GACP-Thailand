'use strict';

/**
 * The identity/role CI gate must keep its teeth.
 *
 * The gate's first version matched the raw role column only when it sat next to
 * a comparison operator on the same line. Two live authorization gates evaded it
 * — certificate revocation and provider-account creation — by assigning
 * `req.user?.role` to a local first and comparing the local. It also never
 * matched optional chaining at all, so even a DIRECT `req.user?.role === 'ADMIN'`
 * passed. The gate reported OK the whole time.
 *
 * A guardrail that misses the cases it was written for is worse than no
 * guardrail, because it is trusted. This test pins both directions: the shapes
 * that must be caught, and the idioms that must stay legal so the gate does not
 * become noise people learn to ignore.
 *
 * It asserts against the regexes in the SHIPPED script, not a copy, so the two
 * cannot drift.
 */

const fs = require('fs');
const path = require('path');

const GATE = path.join(__dirname, '../../../../scripts/ci/check-identity-field-usage.js');

function loadMatchers() {
    const src = fs.readFileSync(GATE, 'utf8');
    const rawSrc = src.match(/const RAW_ROLE_READ = (\/.*?\/);/s);
    const legalSrc = src.match(/const LEGAL_ROLE_READ = (new RegExp\(\[[\s\S]*?\]\.join\('\|'\)\));/);
    expect(rawSrc).not.toBeNull();
    expect(legalSrc).not.toBeNull();
    // eslint-disable-next-line no-eval
    return { raw: eval(rawSrc[1]), legal: eval(`(${legalSrc[1]})`) };
}

function flags(line) {
    const { raw, legal } = loadMatchers();
    return raw.test(line) && !legal.test(line);
}

describe('CI gate — raw req.user.role must not reach a decision', () => {
    describe('catches (these are the shapes that shipped real bugs)', () => {
        const CAUGHT = [
            ["const role = String(req.user?.role || '').toUpperCase();", 'the interoperability-core revoke-gate alias'],
            ["const currentUserRole = String(req.user?.role || '').toLowerCase();", 'the provider create-account alias'],
            ["if (req.user.role === 'ADMIN') {", 'a direct comparison'],
            ["if (req.user?.role === 'ADMIN') {", 'a direct comparison written with optional chaining'],
            ["if ('ADMIN' === req.user?.role) {", 'a reversed comparison'],
            ['const r = req.user.role;', 'a bare alias'],
        ];
        it.each(CAUGHT)('%s — %s', (line) => {
            expect(flags(line)).toBe(true);
        });
    });

    describe('allows (so the gate stays signal, not noise)', () => {
        const ALLOWED = [
            ['const r = normalizeRole(req.user?.canonicalRole || req.user?.role);', 'wrapped in the normaliser'],
            ['if (!isProviderRole(req.user?.role)) {', 'passed to a predicate that normalises internally'],
            ['const actorRole = req.user?.canonicalRole || req.user?.role || null;', 'the canonical-first fallback idiom'],
            ['actorRole: req.user.role,', 'recorded verbatim in an audit field'],
            ["role: req.user?.role || 'PUBLIC',", 'an audit payload property'],
            ['where: { role: req.user.role },', 'a legitimate raw-column Prisma filter'],
        ];
        it.each(ALLOWED)('%s — %s', (line) => {
            expect(flags(line)).toBe(false);
        });
    });

    it('the repository currently passes its own gate', () => {
        const { execFileSync } = require('child_process');
        const out = execFileSync('node', [GATE], {
            cwd: path.join(__dirname, '../../../..'),
            encoding: 'utf8',
        });
        expect(out).toMatch(/OK/);
    });
});
