/**
 * Dictionary parity tests (W3-C).
 *
 * Enforces structural symmetry between the TH and EN dictionaries so a
 * new key added to one side cannot silently land without the matching
 * translation on the other. Without this test the gap was caught only by
 * runtime fallback to the dotted-path string, which user-facing logs
 * tend to swallow.
 *
 * Approach: each dictionary is the union of section files merged at the
 * root level. We deep-walk both objects to collect every leaf path
 * (dot-separated) and compare the two sets. The escape hatch documented
 * in `types.ts` — `dashboard.status` is typed as `Record<string,string>`
 * on the TH side so future custom statuses don't break the type — is
 * still subject to parity: the runtime objects must agree on the set of
 * status keys, because mismatched keys would surface as the dotted path
 * in the UI.
 *
 * Per I-016 — no React rendering happens in this test, so the
 * stable-router caveat does not apply.
 */

import { describe, expect, it } from '@jest/globals';

import { en } from '../dictionaries/en';
import { th } from '../dictionaries/th';

type Walkable = Record<string, unknown>;

/**
 * Collect every leaf key path in the object, joined by dots.
 *
 * A leaf is anything that is not a plain object — strings, numbers,
 * booleans, null, undefined, arrays all count. Arrays are treated as
 * leaves because the dictionaries don't currently use them and adding
 * array support would require an indexed-key convention the parity
 * check would have to mirror exactly.
 */
function collectKeyPaths(obj: Walkable, prefix = ''): Set<string> {
    const out = new Set<string>();
    for (const [key, value] of Object.entries(obj)) {
        const path = prefix ? `${prefix}.${key}` : key;
        if (
            value !== null &&
            typeof value === 'object' &&
            !Array.isArray(value)
        ) {
            for (const sub of collectKeyPaths(value as Walkable, path)) {
                out.add(sub);
            }
        } else {
            out.add(path);
        }
    }
    return out;
}

/**
 * Cast helpers — both `en` and `th` are typed as nested objects, but
 * `collectKeyPaths` only needs the structural shape `Record<string, unknown>`.
 */
const enKeys = collectKeyPaths(en as unknown as Walkable);
const thKeys = collectKeyPaths(th as unknown as Walkable);

describe('dictionary parity (W3-C)', () => {
    it('every key in EN exists in TH', () => {
        const missingInTH = [...enKeys].filter((k) => !thKeys.has(k));
        // Failure message lists the exact paths so a developer can paste
        // them straight into the TH section file.
        expect(missingInTH).toEqual([]);
    });

    it('every key in TH exists in EN', () => {
        const missingInEN = [...thKeys].filter((k) => !enKeys.has(k));
        expect(missingInEN).toEqual([]);
    });

    it('TH and EN have identical key counts', () => {
        // Sanity check that complements the two set-difference checks
        // above — useful when scanning Jest output, because the count
        // line catches a category of regressions (typo'd nesting that
        // happens to balance) the diff checks already cover.
        expect(thKeys.size).toBe(enKeys.size);
    });
});
