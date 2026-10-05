'use strict';

/**
 * Role filters accept canonical values only — the final step of
 * expand-migrate-contract.
 *
 * Sequence, all three parts now done:
 *   EXPAND   (#710)  eleven filters widened via dbRoleValuesFor() so they match
 *                    both spellings while rows of each exist.
 *   MIGRATE  (ops)   20260801000000 run against production: UPDATE 23, zero
 *                    legacy rows remain.
 *   CONTRACT (#713)  the four writers switched to canonical.
 *   CONTRACT (here)  the filters narrow to canonical-only.
 *
 * This step was held back deliberately until the migration was confirmed,
 * because a narrow filter against un-migrated rows returns an EMPTY LIST rather
 * than an error, and every caller reads empty as "nobody to notify" or "not
 * authorised". Verified on a real PostgreSQL 16 before #713: narrow filters
 * against un-migrated rows matched ZERO for DTAM accountants, schedulers, the
 * waiver approver and the auditor widget.
 *
 * The two hardcoded extras that survived the widening — 'EXECUTIVE' in the SLA
 * escalation filter and 'PROVIDER' in the provider-notify filter — go too. Both
 * are QUARANTINE_VALUES, and the migration ABORTS when a quarantined row
 * exists. It did not abort, so no row holds either value. They cannot match
 * anything, and leaving a dead value in an authorization filter invites the
 * next person to copy the pattern.
 */

const fs = require('fs');
const path = require('path');

const { CANONICAL_ROLES, normalizeRole } = require('../../shared/canonical-rbac');

const BACKEND_ROOT = path.join(__dirname, '../..');

/** Every filter the expand phase widened, and the roles it must still match. */
const NARROWED_FILTERS = [
    { file: 'services/metrics-service.js', constant: 'APPLICANT_ROLES', roles: ['health'] },
    { file: 'services/waiver-approvers.js', constant: 'WAIVER_APPROVER_DB_ROLES', roles: ['finance_officer_dtam', 'finance_officer_platform'] },
    { file: 'services/notification/domain-helpers.js', constant: 'SCHEDULER_NOTIFY_ROLES', roles: ['dispatcher', 'system_admin_dtam'] },
    { file: 'services/notification/domain-helpers.js', constant: 'SLA_ESCALATION_ROLES', roles: ['system_admin_dtam'] },
    { file: 'services/admin-dashboard-service.js', constant: 'AUDIT_STAFF_ROLES', roles: ['field_inspector', 'document_reviewer'] },
    { file: 'services/scheduler/job-scheduler.js', constant: 'APPLICANT_ROLES', roles: ['health'] },
    { file: 'services/application-service/application-review-revision-methods.js', constant: 'PROVIDER_NOTIFY_ROLES', roles: ['document_reviewer', 'system_admin_dtam'] },
    { file: 'services/provider-user-service.js', constant: 'ADMIN_ROLES', roles: ['system_admin_dtam'] },
    // services/subscription/subscription-order-service.js :: APPLICANT_ROLES —
    // ถอดโดย M3 (operator 2026-08-23, "ไม่มีค่าสมาชิก") ผู้อ่านรายเดียวคือ healthId fallback
    // ของ cron ต่ออายุ ซึ่งถูกลบไปพร้อมการเรียกเก็บ · ทั้งไฟล์หายไปแล้ว 2026-09-11
];

/** Values the migration refuses to map. No row holds one — it aborts if any does. */
const QUARANTINED = ['EXECUTIVE', 'PROVIDER', 'COORDINATOR', 'OFFICER'];

function readCode(rel) {
    return fs.readFileSync(path.join(BACKEND_ROOT, rel), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function productionFiles() {
    const out = [];
    const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (['node_modules', '__tests__', 'migrations'].includes(entry.name)) { continue; }
                walk(full);
            } else if (entry.name.endsWith('.js')) {
                out.push(path.relative(BACKEND_ROOT, full).split(path.sep).join('/')); // posix-normalised (Windows dev machines)
            }
        }
    };
    for (const dir of ['routes', 'services', 'jobs', 'shared', 'middleware', 'controllers']) {
        walk(path.join(BACKEND_ROOT, dir));
    }
    return out;
}

/**
 * A quoted value that IS a role but is NOT spelled canonically.
 *
 * normalizeRole returns null for anything that is not a role at all, which is
 * what keeps this scan off the other `role` columns in the schema:
 * EntityMember.role holds OWNER / MANAGER / VIEWER and ApplicationComment.role
 * holds PROVIDER — all null here, none of them flagged.
 */
/**
 * ค่าที่พบในตำแหน่ง "ตัวกรองบทบาท" แล้วไม่ใช่คำมาตรฐานปัจจุบันเป๊ะ ๆ
 *
 * นิยามเดิมคือ "แปลออก แต่ได้คำอื่น" ซึ่งใช้ได้ตอนที่คำเก่ายังมี alias · หลัง operator
 * สั่งตัดขาด 2026-09-10 คำเก่าแปลไม่ออกเลย (normalizeRole คืน null) ⇒ นิยามเดิมจะ
 * ปล่อยผ่านคำเก่าทุกคำ ซึ่งเป็นสิ่งที่ไฟล์นี้มีไว้จับพอดี
 */
/** คำบทบาทที่ถูกปลดระวาง 2026-09-10 — ทุกสะกด ทุกตัวพิมพ์ */
const RETIRED_ROLE_WORDS = new Set([
    'admin', 'super_admin', 'platform_admin', 'platform_owner',
    'account', 'accountant', 'finance',
    'account_dtam', 'accountant_dtam', 'dtam_account', 'finance_dtam',
    'account_platform', 'accountant_platform', 'platform_account', 'finance_platform',
    'auditor', 'inspector', 'audit', 'head_auditor',
    'scheduler', 'reviewer', 'reviewer_auditor',
    'approver', 'final_approver', 'applicant', 'farmer',
]);

/**
 * ค่านี้เป็นคำบทบาทที่ปลดระวางแล้วหรือไม่
 *
 * นิยามเดิมคือ "แปลออก แต่ได้คำอื่น" ซึ่งใช้ได้ตอนที่คำเก่ายังมี alias · หลัง operator
 * สั่งตัดขาด 2026-09-10 คำเก่าแปลไม่ออกเลย (normalizeRole คืน null) ⇒ นิยามเดิมจะ
 * ปล่อยผ่านคำเก่าทุกคำ ซึ่งเป็นสิ่งที่ไฟล์นี้มีไว้จับพอดี
 *
 * นิยามใหม่จึงระบุรายการตรง ๆ ไม่ใช่ "อะไรก็ตามที่ไม่ใช่คำมาตรฐาน" — ไม่งั้นจะจับ
 * ข้อความ log และสตริงอื่นที่บังเอิญอยู่ในตำแหน่งเดียวกันไปด้วย (วัดแล้ว)
 */
function isLegacyRoleSpelling(value) {
    return RETIRED_ROLE_WORDS.has(String(value || '').trim().toLowerCase());
}

describe('the widening helpers are gone from production code', () => {
    test('no production file calls dbRoleValuesFor / dbRoleValuesForAny', () => {
        const offenders = productionFiles()
            .filter((rel) => rel !== 'shared/role-migration-map.js')
            .filter((rel) => /dbRoleValuesFor(Any)?\s*\(/.test(readCode(rel)))
            .sort();
        expect(offenders).toEqual([]);
    });

    test('no DB read path converts a canonical role to its legacy spelling', () => {
        // user-groups.js was the last read-widener. With the column canonical it
        // has nothing left to widen.
        //
        // Scoped to DB paths on purpose. Two callers legitimately still convert:
        // routes/api/system/provider.js serves the role picker's option VALUES
        // and provider-directory-utils.js labels a directory row. Both are the
        // WIRE contract the Flutter client already speaks, and both feed writers
        // that normalise on the way in. Narrowing them is an API change, not a
        // migration cleanup, so it is deliberately out of scope here.
        const WIRE_CONTRACT = [
            'routes/api/system/provider.js',
            'routes/api/provider/provider-directory-utils.js',
        ];
        const offenders = productionFiles()
            // canonical-rbac.js DEFINES the function — that is not a call site.
            .filter((rel) => rel !== 'shared/canonical-rbac.js')
            .filter((rel) => !WIRE_CONTRACT.includes(rel))
            .filter((rel) => /canonicalToLegacyRole\s*\(/.test(readCode(rel)))
            .sort();
        expect(offenders).toEqual([]);
    });

    test('the scan reads real files (guards against a vacuous pass)', () => {
        const files = productionFiles();
        expect(files.length).toBeGreaterThan(100);
        expect(files).toContain('services/provider-user-service.js');
    });
});

/**
 * The sites below are NOT the eleven the expand phase widened. They hardcoded
 * the legacy UPPERCASE spelling directly, so `dbRoleValuesFor` never touched
 * them and the widening never covered them — which means the production
 * migration silently broke each one the moment it ran. Postgres comparison is
 * case-sensitive: `role = 'finance_officer_platform'` against a column holding 'finance_officer_platform'
 * matches nothing, and every one of these callers reads an empty result as
 * "nobody to notify" rather than as an error.
 *
 * One of them fails the other way: `role: { not: 'HEALTH' }` matched nothing
 * before and now matches EVERY row, so the admin console's provider-staff tab
 * lists applicants.
 */
describe('no prisma.user query filters on a legacy role spelling', () => {
    const PRISMA_OPS = 'findMany|findFirst|findUnique|count|updateMany|update|create|createMany|upsert|aggregate|groupBy|deleteMany';

    /**
     * `role:` in a prisma.user call, in every shape the codebase uses:
     *   role: 'X'                  role: { equals: 'X' }
     *   role: { not: 'X' }         role: { in: ['X', 'Y'] }
     *   role: IDENTIFIER           role: { in: IDENTIFIER }
     * `role: true` (a select projection) and `role: someExpr.role` do not match.
     */
    const ROLE_CLAUSE = /\brole\s*:\s*(?:\{\s*(?:in|equals|not)\s*:\s*)?(\[[^\]]*\]|'[^']*'|[A-Z][A-Z0-9_]{2,})/g;

    /** Resolve `const ACCOUNT_ROLE = 'finance_officer_platform'` so an aliased literal cannot hide. */
    function moduleLevelStringConsts(source) {
        const out = {};
        for (const m of source.matchAll(/^\s*const\s+([A-Z][A-Z0-9_]*)\s*=\s*'([^']*)'\s*;/gm)) {
            out[m[1]] = m[2];
        }
        return out;
    }

    function scan() {
        const offenders = [];
        for (const rel of productionFiles()) {
            const source = readCode(rel);
            const consts = moduleLevelStringConsts(source);
            const callRe = new RegExp(`prisma\\.user\\.(?:${PRISMA_OPS})`, 'g');
            for (const call of source.matchAll(callRe)) {
                const window = source.slice(call.index, call.index + 900);
                for (const clause of window.matchAll(ROLE_CLAUSE)) {
                    const captured = clause[1];
                    const values = captured.startsWith('[') || captured.startsWith("'")
                        ? [...captured.matchAll(/'([^']*)'/g)].map((m) => m[1])
                        : [consts[captured]].filter((v) => v !== undefined);
                    for (const value of values) {
                        if (isLegacyRoleSpelling(value)) {
                            // No line number: comments are stripped before the
                            // scan, so any offset computed here would point at
                            // the wrong line in the real file. The value is what
                            // you grep for.
                            offenders.push(`${rel} -> '${value}' (canonical: '${normalizeRole(value)}')`);
                        }
                    }
                }
            }
        }
        return [...new Set(offenders)].sort();
    }

    test('every role literal in a prisma.user filter is already canonical', () => {
        expect(scan()).toEqual([]);
    });

    test('the scanner actually resolves aliased literals (guards the guard)', () => {
        // If this stops finding the shape, the scan above passes vacuously.
        const consts = moduleLevelStringConsts("const LEGACY_ROLE = 'ACCOUNT';\n");
        expect(consts.LEGACY_ROLE).toBe('ACCOUNT');
        // คำที่ปลดระวางแล้วต้องถูกจับได้ · คำปัจจุบันต้องไม่ถูกจับ
        expect(isLegacyRoleSpelling('ACCOUNT')).toBe(true);
        expect(isLegacyRoleSpelling('finance_officer_platform')).toBe(false);
        expect(isLegacyRoleSpelling('finance_officer_platform')).toBe(false);
        // The other `role` columns must stay invisible to this scan.
        expect(isLegacyRoleSpelling('OWNER')).toBe(false);
        expect(isLegacyRoleSpelling('VIEWER')).toBe(false);
        expect(isLegacyRoleSpelling('PROVIDER')).toBe(false);
    });
});

/**
 * Comparisons that never reach a prisma call — the value is already in memory,
 * read out of `User.role`, and compared against a legacy literal in JS. Same
 * migration, same breakage, different shape, so the scanner above cannot see
 * them. Pinned by site.
 */
describe('in-memory User.role comparisons use the canonical spelling', () => {
    const SITES = [
        {
            file: 'routes/api/admin/users.js',
            extract: /function roleFilterFromCanonical[\s\S]*?\n\}/,
            why: 'every branch returned a legacy spelling, so filtering the admin user list by ANY role returned an empty page',
        },
        {
            file: 'services/entity-service.js',
            extract: /async function listMembershipsForUserWithHeal[\s\S]*?\n\}/,
            why: "user.role !== 'HEALTH' is now always true, so the personal-entity self-heal never runs",
        },
        {
            file: 'controllers/auth-controller/health-auth-profile-handlers.js',
            extract: /PRIVILEGED_ROLES[\s\S]{0,400}/,
            why: 'REQUIRE_MFA_FOR_PRIVILEGED stopped recognising any privileged user',
        },
    ];

    test.each(SITES)('$file — $why', ({ file, extract }) => {
        const region = readCode(file).match(extract);
        expect(region).not.toBeNull();
        const offenders = [...region[0].matchAll(/'([^']*)'/g)]
            .map((m) => m[1])
            .filter(isLegacyRoleSpelling);
        expect(offenders).toEqual([]);
    });
});

/**
 * Filter arrays built in a route handler and passed into the user service —
 * the prisma call filters on an IDENTIFIER, so the prisma-window scanner
 * cannot see the values. These three still WORKED after the migration because
 * someone had appended the canonical spellings alongside the legacy ones; the
 * legacy ones now match zero rows by construction and are pure copy-bait.
 */
describe('role arrays handed to the user service are canonical-only', () => {
    const ARRAY_SITES = [
        {
            file: 'routes/api/provider/handlers/scheduler-assign-reviewer-handler.js',
            // 2026-09-10 — อาร์เรย์ย้ายขึ้นไปเป็นค่าคงที่ระดับโมดูล (REVIEWER_PICKLIST_ROLES)
            // เพื่อให้จุดที่ตรวจสิทธิ์กับจุดที่สร้างดรอปดาวน์อ่านรายชื่อเดียวกัน
            extract: /const REVIEWER_PICKLIST_ROLES\s*=\s*\[[^\]]*\]/,
            roles: ['document_reviewer', 'field_inspector'],
        },
        {
            file: 'routes/api/provider/scheduler.js',
            extract: /const auditorRoles\s*=\s*\[[^\]]*\]/,
            roles: ['document_reviewer', 'field_inspector'],
        },
        {
            file: 'services/provider-user-service.js',
            // F-AUDITOR-DROPDOWN-EMPTY (2026-08-19): listAuditorsForScheduler no
            // longer narrows by role in SQL — Prisma's `in` on Postgres is
            // case-sensitive and live rows still hold legacy spellings, which
            // rendered the assign dropdown empty (the reviewer sibling was fixed
            // the same way in db3e6480). The canonical-only policy now lives in
            // the JS filter via normalizeRole, so this pin extracts THAT clause;
            // pinning a role:{in:[...]} here would demand the empty-dropdown bug
            // back.
            extract: /listAuditorsForScheduler[\s\S]*?(candidates\.filter\(\(candidate\) => normalizeRole\(candidate\.role\) === CANONICAL_ROLES\.[A-Z_]+\))/,
            roles: ['field_inspector'],
        },
    ];

    test.each(ARRAY_SITES)('$file', ({ file, extract, roles }) => {
        const match = readCode(file).match(extract);
        expect(match).not.toBeNull();
        const region = match[1] ?? match[0];
        const values = [
            ...[...region.matchAll(/'([^']+)'/g)].map((m) => m[1]),
            ...[...region.matchAll(/CANONICAL_ROLES\.([A-Z_]+)/g)].map((m) => CANONICAL_ROLES[m[1]]),
        ];
        expect([...new Set(values)].sort()).toEqual([...roles].sort());
        for (const value of values) {
            expect(normalizeRole(value)).toBe(value);
        }
    });
});

/**
 * The writers. PR 2e flipped the four it knew about; these two were missed
 * because neither goes through a role-aware service — each hands a literal
 * straight to prisma.user.create, so every account they create lands in the
 * canonical column with a legacy value and is invisible to the narrowed
 * filters from the moment it exists.
 */
describe('every User.role writer produces the canonical spelling', () => {
    const WRITERS = [
        'routes/api/platform-admin/organizations.js',
        'controllers/e2e-controller.js',
        'services/prisma-auth-service.js',
        'services/provider-user-service.js',
        'services/admin-user-service.js',
        'routes/api/admin/users.js',
        // W4 2026-08-22 — the seed is a writer too, and nobody looked in
        // prisma/ when this list was drawn up (productionFiles() walks
        // routes/services/jobs/shared/middleware/controllers only). It kept
        // writing role: 'HEALTH', so every seeded applicant was invisible to
        // the narrowed filters AND to the personal-entity self-heal — which
        // is what made the application wizard unusable for them.
        'prisma/seed-gacp.js',
    ];

    test.each(WRITERS)('%s writes a canonical role', (rel) => {
        const source = readCode(rel);
        const offenders = [];
        for (const call of source.matchAll(/prisma\.user\.(?:create|update|updateMany|upsert)/g)) {
            const window = source.slice(call.index, call.index + 900);
            for (const clause of window.matchAll(/\brole\s*:\s*('[^']*')/g)) {
                const value = clause[1].slice(1, -1);
                if (isLegacyRoleSpelling(value)) {
                    offenders.push(`${rel} writes '${value}'`);
                }
            }
        }
        expect(offenders).toEqual([]);
    });

    test('the platform-admin route normalises before it writes', () => {
        // Its zod schema keeps accepting the UPPERCASE names the console
        // already sends — that is the wire contract. What changes is that the
        // value is normalised on the way into the column.
        const source = readCode('routes/api/platform-admin/organizations.js');
        expect(source).toMatch(/normalizeRole\s*\(/);
        expect(source).not.toMatch(/\brole:\s*input\.role\b/);
    });
});

describe('each narrowed filter holds canonical values only', () => {
    test.each(NARROWED_FILTERS)('$file :: $constant', ({ file, constant, roles }) => {
        const source = readCode(file);
        const declaration = source.match(
            new RegExp(`const ${constant}\\s*=\\s*Object\\.freeze\\(\\[([\\s\\S]*?)\\]\\)`),
        );
        expect(declaration).not.toBeNull();

        // Resolve both spellings the source may use: a bare literal, or a
        // CANONICAL_ROLES.X reference. Comparing resolved VALUES rather than
        // source text means the assertion survives a stylistic change and still
        // fails on a wrong role.
        const values = [
            ...[...declaration[1].matchAll(/'([^']+)'/g)].map((m) => m[1]),
            ...[...declaration[1].matchAll(/CANONICAL_ROLES\.([A-Z_]+)/g)].map((m) => CANONICAL_ROLES[m[1]]),
        ];
        expect(values.filter(Boolean).sort()).toEqual([...roles].sort());

        // Every value is a canonical role, spelled canonically.
        for (const value of values) {
            expect(normalizeRole(value)).toBe(value);
            expect(value).toBe(value.toLowerCase());
        }
    });

    test('no filter carries a quarantined value', () => {
        const offenders = [];
        for (const { file, constant } of NARROWED_FILTERS) {
            const source = readCode(file);
            const declaration = source.match(
                new RegExp(`const ${constant}\\s*=\\s*Object\\.freeze\\(\\[([\\s\\S]*?)\\]\\)`),
            );
            if (!declaration) { continue; }
            for (const quarantined of QUARANTINED) {
                if (declaration[1].includes(`'${quarantined}'`) || declaration[1].includes(`CANONICAL_ROLES.${quarantined}`)) {
                    offenders.push(`${file} :: ${constant} -> ${quarantined}`);
                }
            }
        }
        expect(offenders.sort()).toEqual([]);
    });
});

describe('the boundary still rejects legacy input', () => {
    test('normalizeRole maps a legacy spelling to canonical, it does not pass it through', () => {
        // Narrowing the DB filters does not mean the API stops accepting a
        // legacy role NAME from a caller — normalizeRole is what converts it,
        // and it must keep doing so or an admin UI sending 'system_admin_dtam' breaks.
        expect(normalizeRole('system_admin_dtam')).toBe(CANONICAL_ROLES.SYSTEM_ADMIN_DTAM);
        expect(normalizeRole('finance_officer_dtam')).toBe(CANONICAL_ROLES.FINANCE_OFFICER_DTAM);
        expect(normalizeRole('  Dispatcher  ')).toBe(CANONICAL_ROLES.DISPATCHER);
        // คำเก่าต้องแปลไม่ออก ไม่ใช่ไหลผ่าน
        expect(normalizeRole('  Scheduler  ')).toBeNull();
    });

    test('an unknown role is still refused', () => {
        for (const value of ['COORDINATOR', 'EXECUTIVE', 'nonsense', '', null, undefined]) {
            expect(normalizeRole(value)).toBeNull();
        }
    });
});
