/**
 * Self-test for the closing-patterns CI gate.
 *
 * A gate is only useful if it actually FIRES on regressions. We exercise
 * each rule with synthetic source content to prove:
 *   1. Clean source ⇒ no violation
 *   2. Reintroducing the bad pattern ⇒ violation reported
 *   3. The bad pattern inside a comment ⇒ no violation (intentional — historical
 *      context shouldn't false-positive)
 *
 * The actual production source is also exercised via the production-rules
 * sweep, so any drift in the live codebase shows up here too.
 */

const path = require('path');
const fs = require('fs');

const SCRIPT_PATH = path.resolve(__dirname, '..', '..', '..', '..', 'scripts', 'ci', 'check-closing-patterns.js');
const { RULES, checkRule, stripComments } = require(SCRIPT_PATH);

describe('[ClosingGate] stripComments', () => {
    it('removes line comments', () => {
        const out = stripComments('foo();\n// mfaSecret should be ignored here\nbar();');
        expect(out).not.toMatch(/mfaSecret/);
        expect(out).toMatch(/foo\(\)/);
        expect(out).toMatch(/bar\(\)/);
    });

    it('removes block comments', () => {
        const out = stripComments('a\n/* mfaSecret in block comment\n   spanning multiple lines */\nb');
        expect(out).not.toMatch(/mfaSecret/);
        expect(out).toMatch(/a/);
        expect(out).toMatch(/b/);
    });

    it('preserves URL-style :// inside strings', () => {
        const out = stripComments("const url = 'https://example.com/foo';");
        expect(out).toMatch(/https:\/\/example\.com\/foo/);
    });
});

describe('[ClosingGate] live source — every rule produces zero violations against current repo', () => {
    for (const rule of RULES) {
        it(`rule "${rule.id}" finds no violations in production source`, () => {
            const violations = checkRule(rule);
            if (violations.length > 0) {
                // Surface the violation details so test output is actionable.
                const detail = violations.map((v) => `${v.kind} @ ${v.file}: ${v.detail}`).join('\n');
                throw new Error(`Rule ${rule.id} regressed:\n${detail}`);
            }
            expect(violations).toEqual([]);
        });
    }
});

describe('[ClosingGate] synthetic regressions — gate fires when bad patterns reappear', () => {
    /**
     * We can't easily inject content into the real file system without
     * disturbing the repo. Instead, we synthesize a rule-local check by
     * calling `checkRule` against a temporary file we write then delete.
     */
    const TMP_DIR = path.resolve(__dirname, '..', '..', '..', '..', '.tmp-closing-gate-tests');

    beforeAll(() => {
        if (!fs.existsSync(TMP_DIR)) {
            fs.mkdirSync(TMP_DIR, { recursive: true });
        }
    });

    afterAll(() => {
        try {
            fs.rmSync(TMP_DIR, { recursive: true, force: true });
        } catch (_) {
            // best effort
        }
    });

    function writeTempAndCheck(relRepoPath, content, rule) {
        // The rule looks up files relative to REPO_ROOT. We write the file at
        // that path INSIDE the tmp dir, but to keep the existing checkRule
        // function honest we instead synthesize a minimal rule with the temp
        // path and exercise it via the same primitives.
        const tmpPath = path.join(TMP_DIR, path.basename(relRepoPath));
        fs.writeFileSync(tmpPath, content, 'utf8');

        // Build a derived rule that points at the absolute temp path. We need
        // the check to resolve the file: easiest path is to read+strip+match
        // here directly (the production checkRule resolves via REPO_ROOT).
        const stripped = stripComments(content);
        if (rule.required) {
            return rule.required.test(stripped)
                ? { violations: 0 }
                : { violations: 1, kind: 'REQUIRED_PATTERN_MISSING' };
        }

        const lines = stripped.split('\n');
        let hits = 0;
        for (const line of lines) {
            if (rule.pattern.test(line)) {
                hits += 1;
            }
        }
        return { violations: hits };
    }

    it('fires on mfaSecret reappearing as live code', () => {
        const rule = RULES.find((r) => r.id === 'mfa-legacy-secret-column');
        const bad = 'const x = await prisma.user.update({ data: { mfaSecret: secret } });';
        const result = writeTempAndCheck('mfa.js', bad, rule);
        expect(result.violations).toBeGreaterThan(0);
    });

    it('does NOT fire on mfaSecret inside a // comment', () => {
        const rule = RULES.find((r) => r.id === 'mfa-legacy-secret-column');
        const ok = '// historical note: the old column was mfaSecret\nconst x = 1;';
        const result = writeTempAndCheck('mfa.js', ok, rule);
        expect(result.violations).toBe(0);
    });

    it('does NOT fire on mfaSecret inside a /* */ block comment', () => {
        const rule = RULES.find((r) => r.id === 'mfa-legacy-secret-column');
        const ok = '/**\n * The old name was mfaSecret — kept for historical context.\n */\nconst x = 1;';
        const result = writeTempAndCheck('mfa.js', ok, rule);
        expect(result.violations).toBe(0);
    });

    it('fires on actorIdentity raw healthId access in live code', () => {
        const rule = RULES.find((r) => r.id === 'raw-healthId-in-actorIdentity');
        const bad = 'await audit({ actorIdentity: req.user.healthId, action: "X" });';
        const result = writeTempAndCheck('handler.js', bad, rule);
        expect(result.violations).toBeGreaterThan(0);
    });

    it('does NOT fire when actorIdentity wraps healthId in maskThaiId', () => {
        const rule = RULES.find((r) => r.id === 'raw-healthId-in-actorIdentity');
        const ok = 'await audit({ actorIdentity: maskThaiId(req.user.healthId), action: "X" });';
        const result = writeTempAndCheck('handler.js', ok, rule);
        expect(result.violations).toBe(0);
    });

    it('fires when admin override falls back to non-transactional auditLogger.log', () => {
        const rule = RULES.find((r) => r.id === 'admin-override-non-transactional-audit');
        const bad = `
            await prisma.application.update({ data: { status: 'X' } });
            try {
                await auditLogger.log({
                    category: AuditCategory.ADMIN,
                    action: 'STATUS_OVERRIDE',
                });
            } catch (e) { /* gap */ }
        `;
        const result = writeTempAndCheck('applications.js', bad, rule);
        expect(result.violations).toBeGreaterThan(0);
    });

    it('does NOT fire when admin override uses auditLogger.logWithin inside $transaction', () => {
        const rule = RULES.find((r) => r.id === 'admin-override-non-transactional-audit');
        const ok = `
            await prisma.$transaction(async (tx) => {
                await tx.application.update({ data: { status: 'X' } });
                await auditLogger.logWithin({ action: 'STATUS_OVERRIDE' }, tx);
            });
        `;
        const result = writeTempAndCheck('applications.js', ok, rule);
        expect(result.violations).toBe(0);
    });

    it('inverted rule fires when $transaction wrapper is missing from admin override', () => {
        const rule = RULES.find((r) => r.id === 'admin-override-missing-tx-wrapper');
        const bad = 'await prisma.application.update({ data: { status: "X" } });';
        const result = writeTempAndCheck('applications.js', bad, rule);
        expect(result.violations).toBe(1);
        expect(result.kind).toBe('REQUIRED_PATTERN_MISSING');
    });

    it('inverted rule passes when $transaction wrapper is present', () => {
        const rule = RULES.find((r) => r.id === 'admin-override-missing-tx-wrapper');
        const ok = 'await prisma.$transaction(async (tx) => { /* ... */ });';
        const result = writeTempAndCheck('applications.js', ok, rule);
        expect(result.violations).toBe(0);
    });
});
