#!/usr/bin/env node

/**
 * Closing-review pattern check.
 *
 * How this runs (2026-08-14): by hand only — `pnpm check:closing-patterns`
 * (package.json:35) is the single invoker. There is no CI job behind it:
 * GitHub Actions is permanently unavailable (the change log 2026-08-14), and
 * this script appears in neither scripts/ci/local-gate.sh nor
 * scripts/ci/full-gate-checks.txt. Until it lands in one of those, a clean run
 * is a fact about the moment someone typed the command, not a merge gate.
 *
 * Day-end consensus (2026-05-15) surfaced four NEW bugs that all share a
 * pattern: somewhere in the codebase, a regex sweep against a known-bad
 * pattern would have caught the regression instantly. The fix surface was
 * shipped; this script makes the FUTURE-regression surface impossible.
 *
 * Each rule scans a curated set of target files, strips comments, and
 * exits non-zero if the bad pattern reappears. Per-rule file allowlists carve
 * out legitimate exceptions (e.g. the legacy-fallback shim that ACCEPTS
 * an old field as a safety net).
 *
 * Run:
 *     node scripts/ci/check-closing-patterns.js
 *
 * Exit codes:
 *     0 - all checks passed
 *     1 - one or more violations found
 *     2 - tool error (missing file, etc.)
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

/**
 * Strip JS/TS block and line comments. The patterns we scan for are all
 * code references; allowing comments means historical context (e.g. the
 * mfa.js file header explaining the original bug) doesn't false-positive.
 */
function stripComments(source) {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        // Line comments — but don't strip URL-style `://` inside strings.
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/**
 * Each rule:
 *   - id: short identifier (used in output and to allow `// eslint-disable-line` style overrides)
 *   - description: what the rule prevents
 *   - origin: which day-end-consensus item this guards
 *   - files: array of repo-relative paths to scan
 *   - pattern: RegExp to match in the comment-stripped source
 *   - allowedInFiles: subset of `files` where the pattern is legitimately allowed (with a reason)
 */
const RULES = [
    {
        id: 'mfa-legacy-secret-column',
        description:
            'Reference to the non-existent `mfaSecret` Prisma column. Canonical column is `twoFactorSecret` (auth.prisma:115).',
        origin: 'NEW-1 / NEW-5 (mfa.js + pdpa-retention + deleteMe)',
        files: [
            'apps/backend/routes/api/identity/mfa.js',
            'apps/backend/jobs/pdpa-retention-job.js',
            'apps/backend/controllers/auth-controller/auth-session-security-handlers.js',
        ],
        pattern: /\bmfaSecret\b/,
        allowedInFiles: {},
    },
    {
        id: 'mfa-legacy-backup-codes-column',
        description:
            'Reference to the non-existent `mfaBackupCodes` Prisma column. Canonical column is `twoFactorBackupCodes` (auth.prisma:117).',
        origin: 'NEW-1 / NEW-5',
        files: [
            'apps/backend/routes/api/identity/mfa.js',
            'apps/backend/jobs/pdpa-retention-job.js',
            'apps/backend/controllers/auth-controller/auth-session-security-handlers.js',
        ],
        pattern: /\bmfaBackupCodes\b/,
        allowedInFiles: {},
    },
    {
        id: 'mfa-legacy-enabled-column-in-routes',
        description:
            'Reference to the non-existent `mfaEnabled` Prisma column in route/job code. Canonical column is `twoFactorEnabled` (auth.prisma:116). The legacy alias is accepted ONLY by `prisma-auth-service.js` as an explicit safety fallback.',
        origin: 'NEW-1 / NEW-5',
        files: [
            'apps/backend/routes/api/identity/mfa.js',
            'apps/backend/jobs/pdpa-retention-job.js',
            'apps/backend/controllers/auth-controller/auth-session-security-handlers.js',
        ],
        pattern: /\bmfaEnabled\b/,
        allowedInFiles: {
            // The auth-service legacy fallback is explicit and documented.
            'apps/backend/services/prisma-auth-service.js':
                'Legacy fallback `user.twoFactorEnabled || user.mfaEnabled` — see closing-review NEW-1 comment block.',
        },
    },
    {
        id: 'raw-healthId-in-actorIdentity',
        description:
            'Raw `req.user.healthId` written to `actorIdentity` (a hash-chained audit field). PDPA forbids storing plaintext national IDs in audit rows — must wrap with `maskThaiId()`.',
        origin: 'NEW-2 (closing-review actorIdentity sweep)',
        files: [
            'apps/backend/routes/api/cultivation/harvest-batches.js',
            'apps/backend/routes/api/provider/handlers/auditor-audit-decision-handler.js',
            'apps/backend/routes/api/provider/handlers/auditor-inspection-start-handler.js',
            'apps/backend/routes/api/provider/handlers/scheduler-audit-schedules-post-handler.js',
            'apps/backend/routes/api/provider/handlers/workflow-revision-expirations-handler.js',
            'apps/backend/routes/api/provider/handlers/workflow-side-effects.js',
        ],
        // Match `actorIdentity: req.user.healthId` or `actorIdentity: reqUser.healthId`
        // (optional optional-chaining), where the value is NOT wrapped in maskThaiId.
        // Strategy: a positive match for the raw access, regardless of whether
        // maskThaiId appears elsewhere in the file. We rely on the matched line
        // not containing maskThaiId — done with a negative lookahead on the line.
        pattern: /actorIdentity:\s*(?!maskThaiId)(?:req\.user|reqUser)\??\.healthId\b/,
        allowedInFiles: {},
    },
    {
        id: 'admin-override-non-transactional-audit',
        description:
            'The admin status override endpoint must use `auditLogger.logWithin(event, tx)` inside a `prisma.$transaction` — never the best-effort `auditLogger.log()` with a try/catch fallback. Otherwise the status mutation can persist with no tamper-evident trail.',
        origin: 'NEW-6 / AC6 (admin override transactional)',
        files: [
            'apps/backend/routes/api/admin/applications.js',
        ],
        // Forbid plain `auditLogger.log({` calls (the new pattern uses `logWithin`).
        pattern: /auditLogger\.log\(\s*\{/,
        allowedInFiles: {},
    },
    {
        id: 'admin-override-missing-tx-wrapper',
        description:
            'The admin override file must contain a `prisma.$transaction(async (tx) =>` wrapper. Absence implies the transactional pattern was reverted.',
        origin: 'NEW-6 / AC6',
        files: [
            'apps/backend/routes/api/admin/applications.js',
        ],
        // This is an INVERTED pattern — we WANT to see this, fail if absent.
        // Encoded as a special `required` rule below for clarity.
        pattern: null,
        required: /prisma\.\$transaction\(\s*async\s*\(\s*tx\s*\)\s*=>/,
        allowedInFiles: {},
    },
];

function loadSource(relPath) {
    const fullPath = path.join(REPO_ROOT, relPath);
    if (!fs.existsSync(fullPath)) {
        return null;
    }
    return fs.readFileSync(fullPath, 'utf8');
}

function checkRule(rule) {
    const violations = [];

    for (const relPath of rule.files) {
        const source = loadSource(relPath);
        if (source === null) {
            violations.push({
                file: relPath,
                kind: 'MISSING_FILE',
                detail: 'File listed in rule does not exist — rule needs to be updated.',
            });
            continue;
        }

        const stripped = stripComments(source);

        // Required-pattern rules (inverted): fail if NOT present.
        if (rule.required) {
            if (!rule.required.test(stripped)) {
                violations.push({
                    file: relPath,
                    kind: 'REQUIRED_PATTERN_MISSING',
                    detail: `Required pattern not found: ${rule.required.source}`,
                });
            }
            continue;
        }

        // Forbidden-pattern rules: fail if present (unless allowlisted).
        if (rule.allowedInFiles && rule.allowedInFiles[relPath]) {
            continue; // explicitly allowed
        }

        // Match each line independently so we can show line numbers.
        const lines = stripped.split('\n');
        for (let idx = 0; idx < lines.length; idx += 1) {
            const line = lines[idx];
            if (rule.pattern.test(line)) {
                violations.push({
                    file: relPath,
                    kind: 'FORBIDDEN_PATTERN_PRESENT',
                    detail: `Line ${idx + 1}: ${line.trim()}`,
                });
            }
        }
    }

    return violations;
}

function main() {
    let totalViolations = 0;
    const reports = [];

    for (const rule of RULES) {
        const violations = checkRule(rule);
        if (violations.length > 0) {
            totalViolations += violations.length;
            reports.push({ rule, violations });
        }
    }

    if (totalViolations === 0) {
        console.log('[check-closing-patterns] OK — all closing-review patterns clean');
        return 0;
    }

    console.error('[check-closing-patterns] FAIL — closing-review regression(s) detected:\n');
    for (const { rule, violations } of reports) {
        console.error(`  x ${rule.id}`);
        console.error(`    Origin: ${rule.origin}`);
        console.error(`    Why:    ${rule.description}`);
        for (const v of violations) {
            console.error(`    - [${v.kind}] ${v.file}`);
            console.error(`        ${v.detail}`);
        }
        console.error('');
    }
    console.error(`[check-closing-patterns] ${totalViolations} violation(s) across ${reports.length} rule(s).`);
    return 1;
}

if (require.main === module) {
    try {
        process.exit(main());
    } catch (err) {
        console.error('[check-closing-patterns] tool error:', err.message);
        process.exit(2);
    }
}

module.exports = { RULES, checkRule, stripComments };
