/**
 * [R-HOTFIX-PDPA] shared/legal-hold-guard — the reusable rule every retention
 * sweep must inherit.
 *
 * The PDPA retention sweep (jobs/pdpa-retention-job.js) used to select purely on
 * `retainUntil <= now` and then null both the identity columns AND their hash
 * columns. Applied to a row under legal hold that is irreversible and
 * un-correlatable — it destroys the exact evidence the hold exists to preserve.
 *
 * The fix must not live only inside that one job: five other models carry a
 * `legalHold` column today with no sweep of their own, and whoever writes the
 * next sweep needs to inherit the rule rather than rediscover the incident. This
 * suite pins the shared helper and, critically, pins the MODEL LIST against the
 * Prisma schema so a seventh `legalHold` column cannot appear unnoticed.
 */

const fs = require('fs');
const path = require('path');

const {
    LEGAL_HOLD_MODELS,
    legalHoldExclusion,
    legalHoldSelection,
    isUnderLegalHold,
} = require('../../shared/legal-hold-guard');

describe('[R-HOTFIX-PDPA] legal-hold-guard — Prisma fragments', () => {
    it('legalHoldExclusion() is the where-fragment that skips held rows', () => {
        expect(legalHoldExclusion()).toEqual({ legalHold: false });
    });

    it('legalHoldSelection() is the select-fragment that fetches the column', () => {
        expect(legalHoldSelection()).toEqual({ legalHold: true });
    });

    it('returns a fresh object each call so a caller cannot poison the guard', () => {
        const first = legalHoldExclusion();
        first.legalHold = true;
        expect(legalHoldExclusion()).toEqual({ legalHold: false });

        const firstSelect = legalHoldSelection();
        firstSelect.legalHold = false;
        expect(legalHoldSelection()).toEqual({ legalHold: true });
    });
});

describe('[R-HOTFIX-PDPA] legal-hold-guard — row predicate', () => {
    it('flags a row whose legalHold is true', () => {
        expect(isUnderLegalHold({ id: 'u1', legalHold: true })).toBe(true);
    });

    it('clears a row whose legalHold is false', () => {
        expect(isUnderLegalHold({ id: 'u1', legalHold: false })).toBe(false);
    });

    it('clears a row that did not select the column, and tolerates null/undefined rows', () => {
        // A caller that forgot `legalHoldSelection()` gets `undefined` here. The
        // query-layer filter is the primary guard; this predicate is the race
        // backstop, so an unselected column must not crash the sweep.
        expect(isUnderLegalHold({ id: 'u1' })).toBe(false);
        expect(isUnderLegalHold(null)).toBe(false);
        expect(isUnderLegalHold(undefined)).toBe(false);
    });
});

describe('[R-HOTFIX-PDPA] legal-hold-guard — model list tracks the schema', () => {
    /**
     * Parse `prisma/schema/*.prisma` and return every model that declares a
     * `legalHold` column. Deriving the list rather than restating it keeps the
     * Prisma schema the single source of truth (the project rules 3.6).
     */
    function modelsWithLegalHoldColumn() {
        const schemaDir = path.join(__dirname, '..', '..', 'prisma', 'schema');
        const found = new Set();

        for (const file of fs.readdirSync(schemaDir)) {
            if (!file.endsWith('.prisma')) {continue;}
            let current = null;
            for (const line of fs.readFileSync(path.join(schemaDir, file), 'utf8').split('\n')) {
                const modelStart = line.match(/^model\s+(\w+)\s*\{/);
                if (modelStart) {
                    current = modelStart[1];
                    continue;
                }
                if (line.startsWith('}')) {
                    current = null;
                    continue;
                }
                if (current && /^\s*legalHold\s+Boolean\b/.test(line)) {
                    found.add(current);
                }
            }
        }
        return [...found].sort();
    }

    it('names every model that carries a legalHold column — no more, no less', () => {
        // If this fails, a model gained or lost `legalHold`. Do NOT just edit the
        // constant: check whether that model has a sweep/erasure path that now
        // needs this guard wired in.
        expect([...LEGAL_HOLD_MODELS].sort()).toEqual(modelsWithLegalHoldColumn());
    });

    it('is frozen so no caller can shrink the list at runtime', () => {
        expect(Object.isFrozen(LEGAL_HOLD_MODELS)).toBe(true);
    });
});
