#!/usr/bin/env node

/**
 * Enforcement Guardrails — CI Script
 * Prevents drift of auth, RBAC, and schema conventions.
 * Run: node scripts/ci/check-enforcement-guardrails.js
 * Exit code: 0 = pass, 1 = violations found
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const {
    CANONICAL_SCHEMA_DIR,
    listTrackedPrismaFiles,
    evaluateSchemaSources,
} = require('./lib/prisma-schema-sources');

const ROOT = path.resolve(__dirname, '..', '..');
let violations = 0;
let passed = 0;

function grep(pattern, searchPath, includes = '') {
    try {
        const incl = includes ? `--include="${includes}"` : '';
        const cmd = `git grep -rn "${pattern}" -- "${searchPath}" ${incl}`;
        const result = execSync(cmd, { cwd: ROOT, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
        return result.trim().split('\n').filter(Boolean);
    } catch {
        return []; // grep returns exit 1 when no matches
    }
}

// How many TRACKED files a grep target actually covers.
// `git grep` on a path that no longer exists exits 1 and prints nothing, which
// grep() above turns into [] — indistinguishable from "searched and found
// nothing". That is how G-07 kept printing PASS after
// apps/backend/routes/api/auth-provider.js moved into routes/api/auth/ (2026-08-14
// rules audit): zero files searched, reported as zero violations. Every grep-based
// guard below therefore states its target size, and an empty target is a FAILURE —
// the same contract G-04 already applies to the .prisma file list.
function targetFiles(searchPath) {
    try {
        const out = execSync(`git ls-files -- "${searchPath}"`, {
            cwd: ROOT, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
        });
        return out.trim().split('\n').filter(Boolean);
    } catch {
        return [];
    }
}

// check() over a grep whose search path must resolve to at least one tracked file.
// `matcher` (optional) post-filters the raw `path:line:text` matches.
function checkGrep(id, desc, pattern, searchPath, contextMsg, { includes = '', matcher = null } = {}) {
    const files = targetFiles(searchPath);
    if (files.length === 0) {
        violations += 1;
        console.error(`${id}: ${desc} — nothing to check`);
        console.error(`   Search path "${searchPath}" matches 0 tracked files: this guard has been`);
        console.error('   passing over an empty set. Repoint it at the path the code moved to, or delete it.');
        console.error('');
        return;
    }
    let matches = grep(pattern, searchPath, includes);
    if (matcher) matches = matches.filter(matcher);
    check(id, `${desc} (${files.length} file${files.length === 1 ? '' : 's'} searched)`, matches, contextMsg);
}

function check(id, desc, matches, contextMsg) {
    if (matches.length > 0) {
        violations += 1;
        console.error(`${id}: ${desc}`);
        console.error(`   ${contextMsg}`);
        matches.forEach(m => console.error(`   → ${m}`));
        console.error('');
    } else {
        passed += 1;
        console.log(`${id}: ${desc}`);
    }
}

console.log('╔══════════════════════════════════════════════╗');
console.log('║     Enforcement Guardrails — CI Check        ║');
console.log('╚══════════════════════════════════════════════╝\n');

// G-01: No localStorage auth tokens in web-app provider/admin pages
checkGrep(
    'G-01',
    'No localStorage auth in provider/admin pages',
    'localStorage.getItem.*provider_token\\|localStorage.getItem.*accessToken',
    'apps/web-app/src/app/provider',
    'Provider pages must use apiClient (cookie-based), not localStorage tokens',
    { includes: '*.tsx' }
);

// G-02: No raw fetch with Bearer header in web-app src
checkGrep(
    'G-02',
    'No raw fetch with Bearer + localStorage',
    'Authorization.*Bearer.*localStorage',
    'apps/web-app/src',
    'Use apiClient instead of raw fetch with Bearer header from localStorage'
);

// G-03: No duplicate role alias maps (validDTAMRoles, providerRoleAlias)
checkGrep(
    'G-03',
    'No duplicate role alias maps',
    'validDTAMRoles\\|providerRoleAlias',
    'apps/',
    'Use canonical-rbac.js (backend) or canonical-roles.ts (frontend) only'
);

// G-04: Schema single source — every .prisma file lives in the schema folder.
// The rule is unchanged since 2026-03-06; only its reach is. It used to ask git
// for "**schema.prisma", which stopped matching anything on 2026-03-12 when the
// monolith was split into apps/backend/prisma/schema/ (c145f65d) and deleted
// (3120e673). An empty match list reads as zero violations, so the check passed
// on an empty set from then on. It now enumerates the .prisma files that exist,
// prints how many it looked at, and treats "found none" as a failure.
try {
    const prismaFiles = listTrackedPrismaFiles(ROOT);
    const verdict = evaluateSchemaSources(prismaFiles);

    if (verdict.checked === 0) {
        violations += 1;
        console.error('G-04: Schema single source — nothing to check');
        console.error(`   ${verdict.reason}`);
        console.error('');
    } else {
        check(
            'G-04',
            `Schema single source (${verdict.summary})`,
            verdict.strays,
            `Prisma loads every file in ${CANONICAL_SCHEMA_DIR}; a schema outside it is either dead or a competing source of truth. Move the models in, or delete the file.`,
        );
    }
} catch (e) {
    // A silent catch is how the old version could never fail. If the file list
    // cannot be produced, the gate has verified nothing and says so.
    violations += 1;
    console.error('G-04: Schema single source — could not list .prisma files');
    console.error(`   ${e.message?.slice(0, 200)}`);
    console.error('');
}

// G-04b: No command points --schema at the deleted monolith.
// G-04 above guards the schema FILES; nothing guarded the schema ARGUMENTS, so
// .github/workflows/production.yml:279 sat for months pointing `migrate deploy`
// at the monolith path that was deleted on 2026-03-12. Nothing caught it: the
// workflow only runs on a real production deploy, and no lint reads a --schema
// value. The one correct argument in this repo is the folder (see
// apps/backend/Dockerfile), so the rule is: a --schema argument may never name
// the old monolith file. Matching the argument, not the bare word, keeps prose
// that merely mentions the retired filename out of the results.
checkGrep(
    'G-04b',
    'No --schema pointing at the deleted schema.prisma',
    'schema\\.prisma',
    '.',
    'The schema is the folder apps/backend/prisma/schema/. Pass --schema prisma/schema (relative to apps/backend) — apps/backend/prisma/schema.prisma does not exist and G-04 forbids recreating it.',
    {
        matcher: (m) => {
            const [file, , ...rest] = m.split(':');
            // evidence/ and reports/ are dated records of commands that were
            // actually run; rewriting history there would be the lie, not the fix.
            if (/^(evidence|reports)\//.test(file)) return false;
            return /--schema[= ]\S*schema\.prisma/.test(rest.join(':'));
        },
    }
);

// G-05: No req.user._id (except safe fallbacks with `|| req.user._id`)
checkGrep(
    'G-05',
    'No direct req.user._id usage (use req.user.id)',
    'req\\.user\\._id',
    'apps/backend/',
    'Prisma uses .id, not MongoDB ._id. Safe fallback "id || _id" is allowed.',
    { matcher: m => !m.includes('|| req.user._id') && !m.includes('req.user.id || req.user._id') }
);

// G-06: Prisma validates
try {
    execSync('npx prisma validate', {
        cwd: path.join(ROOT, 'apps/backend'),
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
    });
    passed += 1;
    console.log('G-06: Prisma schema validates');
} catch (e) {
    violations += 1;
    console.error('G-06: Prisma schema validation failed');
    console.error(`   ${e.message?.slice(0, 200)}`);
}

// G-07: No token in provider login response body.
// Path fixed 2026-08-14: the route moved to routes/api/auth/auth-provider.js and
// this guard kept grepping the old location — 0 files searched, printed as PASS.
checkGrep(
    'G-07',
    'No token in provider login response body',
    'token',
    'apps/backend/routes/api/auth/auth-provider.js',
    'Provider login should set httpOnly cookie only, not return token in body',
    {
        matcher: m => {
            // Allow: provider_token (cookie name), token variable declaration, token signing
            // Disallow: `token` or `token,` in response data
            const line = m.split(':').slice(1).join(':').trim();
            return /data:.*token[,\s}]/.test(line) || /^\s*token[,\s]/.test(line);
        },
    }
);

console.log('');
console.log('━'.repeat(50));
console.log(`Results: ${passed} passed, ${violations} failed`);
console.log('━'.repeat(50));

process.exit(violations > 0 ? 1 : 0);
