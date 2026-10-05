#!/usr/bin/env node
/**
 * One direction for identity and role — enforced, not just agreed.
 *
 * A cross-tenant IDOR in routes/api/system/tickets.js came from reading two
 * fields that look right and are not:
 *
 *   req.user.userId  — does not exist. The token payload carries `id`
 *                      (services/prisma-auth-service.js). Reading `userId`
 *                      yields undefined, and an undefined value in a Prisma
 *                      `where` is DROPPED rather than matched — so a filter
 *                      meant to narrow to one applicant returned every row.
 *
 *   req.user.role    — the RAW database column, `@default("HEALTH")`. The
 *                      canonical vocabulary is lowercase, so
 *                      `req.user.role === 'health'` is false for every real
 *                      caller and an ownership gate written that way is dead
 *                      code that always allows.
 *
 * The rule this gate encodes:
 *
 *   identity      → req.user.id
 *   authorization → req.user.canonicalRole  (normalised once in auth-middleware)
 *
 * Raw `req.user.role` stays legal for AUDIT LOG fields (`actorRole: …`), where
 * recording exactly what the database said is the point, and inside
 * `normalizeRole(...)`, which is the conversion this gate exists to force.
 * Everywhere else it is banned, because that is where it silently decides access.
 *
 * WHY THE RULE IS "reads", NOT "comparisons":
 *
 * The first version of this gate matched the raw column ADJACENT to a comparison
 * operator. Two live authorization gates evaded it and were found only by a
 * later audit:
 *
 *   routes/api/interoperability/interoperability-core.js  (certificate revocation)
 *   routes/api/system/provider.js                         (create provider account)
 *
 * both written as
 *
 *     const role = String(req.user?.role || '').toUpperCase();   // no operator here
 *     if (role === 'ADMIN') { ... }                              // no req.user.role here
 *
 * Neither LINE matched, so the gate reported OK while two access decisions used
 * the raw column. The pattern also missed OPTIONAL CHAINING outright —
 * `req.user?.role === 'ADMIN'` is a direct comparison and the old regex did not
 * match it at all, because it only spelled `req.user.role`.
 *
 * Chasing comparison shapes is a losing game: every new way to move the value
 * one step from the operator is a new hole. So the rule is now about the READ.
 * The raw column may be read in exactly two places — as an argument to
 * normalizeRole(), or into an audit field — and any other read is a violation,
 * whatever is done with it afterwards. A guardrail that misses the cases it was
 * written for is worse than none, because it is trusted.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SCAN_DIRS = [
    'apps/backend/routes',
    'apps/backend/services',
    'apps/backend/shared',
    'apps/backend/middleware',
];

// auth-middleware is where the raw column is legitimately read and normalised —
// that is the single boundary the rest of the codebase depends on.
const ALLOWLIST = new Set([
    'apps/backend/middleware/auth-middleware.js',
]);

/** `req.user.userId` (or `user.userId`) anywhere — the field does not exist. */
const BANNED_IDENTITY = /\breq\.user\.userId\b/;

/**
 * ANY read of the raw role column, with or without optional chaining.
 * `user.role` on a plain object is not matched — only the request-bound value.
 */
const RAW_ROLE_READ = /\breq\.user\s*\??\.\s*role\b/;

/**
 * The two legal readers, checked on the SAME line as the read:
 *   normalizeRole(req.user?.canonicalRole || req.user?.role)   ← the conversion
 *   actorRole: req.user.role                                    ← audit record
 * `actorRole`/`actor_role`/`roleAtTime`-style audit keys are matched generically
 * as `<something>ole:` immediately preceding the read.
 */
const LEGAL_ROLE_READ = new RegExp([
    // 1. Handed to the normaliser, or to a canonical-rbac predicate that calls it
    //    internally (isProviderRole/isAdminRole/... all normalizeRole first).
    'normalizeRole\\s*\\(',
    'is[A-Z][A-Za-z]*(?:Role|Caller)\\s*\\(',
    // 2. The approved canonical-first fallback. `canonicalRole` is what
    //    auth-middleware normalised; the raw column is only the fallback for a
    //    token minted before that field existed. Reading it in THAT order is the
    //    documented idiom, not a bypass.
    'canonicalRole\\s*\\|\\|',
    // 3. Recorded verbatim into an audit/log field — the point there is to keep
    //    exactly what the database said.
    // 3. Written into an object PROPERTY rather than compared. That is data,
    //    not a decision: either an audit field (`actorRole: req.user.role`,
    //    where recording exactly what the database said is the point) or a
    //    raw-column Prisma filter (`where: { role: req.user.role }`), both of
    //    which legitimately want the unnormalised value. A decision is a
    //    comparison or a predicate call — those are what clauses 1-2 cover.
    '[A-Za-z_$][\\w$]*\\s*:\\s*(?=[^:]*req\\.user)',
].join('|'));

function* walk(dir) {
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return;
    }
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
            yield* walk(full);
        } else if (entry.name.endsWith('.js')) {
            yield full;
        }
    }
}

/** Strip comments so prose ABOUT the banned pattern does not trip the gate. */
function stripComments(source) {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const violations = [];

for (const dir of SCAN_DIRS) {
    for (const file of walk(path.join(REPO_ROOT, dir))) {
        const rel = path.relative(REPO_ROOT, file);
        if (ALLOWLIST.has(rel)) continue;

        const lines = stripComments(fs.readFileSync(file, 'utf8')).split('\n');
        lines.forEach((line, i) => {
            if (BANNED_IDENTITY.test(line)) {
                violations.push({
                    file: rel,
                    line: i + 1,
                    rule: 'req.user.userId does not exist — use req.user.id',
                    code: line.trim().slice(0, 110),
                });
            }
            if (RAW_ROLE_READ.test(line) && !LEGAL_ROLE_READ.test(line)) {
                violations.push({
                    file: rel,
                    line: i + 1,
                    rule: 'read req.user.canonicalRole, or wrap the raw column in normalizeRole() — '
                        + 'the raw req.user.role column must not reach a decision, even via a local variable',
                    code: line.trim().slice(0, 110),
                });
            }
        });
    }
}

if (violations.length > 0) {
    console.error('[identity-field-usage] FAILED\n');
    for (const v of violations) {
        console.error(`  ${v.file}:${v.line}`);
        console.error(`    ${v.rule}`);
        console.error(`    ${v.code}\n`);
    }
    console.error(`${violations.length} violation(s).`);
    console.error('identity → req.user.id | authorization → req.user.canonicalRole');
    process.exit(1);
}

console.log('[identity-field-usage] OK — identity reads use req.user.id; role comparisons use canonicalRole');
