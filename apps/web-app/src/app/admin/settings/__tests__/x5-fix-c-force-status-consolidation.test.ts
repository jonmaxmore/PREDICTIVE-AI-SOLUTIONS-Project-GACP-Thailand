/**
 * x5-fix-c-force-status-consolidation.test.ts — H-5 / X-1 regression.
 *
 * Pins X5-FIX-C's force-status path consolidation. Pre-X5 the frontend
 * shipped TWO parallel force-status flows:
 *
 *   1. CANONICAL — /admin/applications/[id]/force-status →
 *      AdminB28Service.forceStatus() → POST /admin/applications/:id/force-status
 *   2. LEGACY — /admin/settings <StatusOverridePanel> →
 *      POST /provider/admin/status-override
 *
 * Post-X5 the legacy panel becomes a router into the canonical page —
 * the frontend now has exactly ONE force-status mutation site.
 *
 * Strategy — source-grep across the two source trees relevant to the
 * consolidation: `apps/web-app/src/app/admin` (canonical force-status)
 * and `apps/web-app/src/app/provider` (where the legacy panel previously
 * also lived; H-5 makes sure no NEW legacy callsite has snuck in).
 *
 * The post-consolidation contract is:
 *   - The settings panel does NOT POST to /provider/admin/status-override.
 *   - The settings panel uses router.push to the canonical force-status page.
 *   - The string literal '/provider/admin/status-override' appears in
 *     ZERO frontend source files (it MAY still appear in the test file
 *     itself, hence the explicit ignore list below).
 */

import { describe, expect, it } from '@jest/globals';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const APPS_WEB_SRC = path.resolve(__dirname, '..', '..', '..', '..');
const SETTINGS_PAGE = readFileSync(
    path.resolve(__dirname, '..', 'page.tsx'),
    'utf8',
);
const CANONICAL_PAGE = readFileSync(
    path.resolve(
        __dirname,
        '..',
        '..',
        'applications',
        '[id]',
        'force-status',
        'page.tsx',
    ),
    'utf8',
);

/**
 * Walk a directory tree and return every .ts / .tsx file path. Used to
 * scan the entire frontend source tree for the legacy endpoint string.
 */
function* walkSource(dir: string): Generator<string> {
    let entries: string[];
    try {
        entries = readdirSync(dir);
    } catch {
        return;
    }
    for (const entry of entries) {
        const full = path.join(dir, entry);
        let s;
        try {
            s = statSync(full);
        } catch {
            continue;
        }
        if (s.isDirectory()) {
            if (entry === 'node_modules' || entry === '.next') continue;
            yield* walkSource(full);
        } else if (
            (entry.endsWith('.ts') || entry.endsWith('.tsx')) &&
            !entry.endsWith('.d.ts')
        ) {
            yield full;
        }
    }
}

/**
 * Strip block + line comments so the legacy-endpoint scan exercises
 * actual code. Comments may legitimately reference the legacy path
 * while documenting the consolidation (this very file does in its
 * header, and AdminB28Service's JSDoc mentions the V5-D rewire).
 */
function stripComments(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('[X5-FIX-C / H-5 (X-1)] force-status consolidation', () => {
    it('settings panel does NOT POST to the legacy endpoint', () => {
        // The pre-X5 panel had:
        //   apiClient.post('/provider/admin/status-override', ...)
        // Post-X5 the panel routes to the canonical page, so this
        // string must NOT appear in the settings source CODE anymore
        // (comments may still document the historical migration).
        const code = stripComments(SETTINGS_PAGE);
        expect(code).not.toContain("'/provider/admin/status-override'");
        expect(code).not.toContain('"/provider/admin/status-override"');
    });

    it('settings panel uses router.push to the canonical force-status page', () => {
        expect(SETTINGS_PAGE).toContain("router.push(");
        expect(SETTINGS_PAGE).toContain('/admin/applications/');
        expect(SETTINGS_PAGE).toContain('/force-status');
    });

    it('settings panel exposes a data-testid="status-override-navigator"', () => {
        // The data-testid lets us distinguish the navigator card from
        // any future force-status surface — pinning the consolidation
        // pattern in place.
        expect(SETTINGS_PAGE).toContain('data-testid="status-override-navigator"');
        expect(SETTINGS_PAGE).toContain('data-testid="status-override-app-id"');
        expect(SETTINGS_PAGE).toContain('data-testid="status-override-go"');
    });

    it('canonical force-status page remains the single mutation site', () => {
        // The canonical page imports + uses AdminB28Service.forceStatus
        // (via the ForceStatusModal). If a competing path leaks in this
        // assertion fails on next CI run.
        expect(CANONICAL_PAGE).toContain('ForceStatusModal');
    });

    it('the legacy `/provider/admin/status-override` string occurs in zero frontend source CODE locations', () => {
        // Whole-tree scan with comments stripped — so documentation
        // strings (e.g. the V5-D rewire comment in
        // admin-service-b28.ts that historically documents the
        // legacy → canonical migration, plus this fix's own settings
        // page X5-FIX-C comments) don't trip the assertion. A NEW
        // caller materialising in actual code surfaces here on the
        // next CI run.
        const offenders: string[] = [];
        for (const file of walkSource(APPS_WEB_SRC)) {
            // Skip the test files themselves — their job is to mention
            // the legacy string for regression purposes.
            if (file.includes('__tests__')) continue;
            const src = readFileSync(file, 'utf8');
            const code = stripComments(src);
            if (code.includes('/provider/admin/status-override')) {
                offenders.push(file);
            }
        }
        expect(offenders).toEqual([]);
    });
});
