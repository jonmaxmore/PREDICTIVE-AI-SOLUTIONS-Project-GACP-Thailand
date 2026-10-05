'use strict';

/**
 * Canonical status vocabulary at the write chokepoint — PR 2b.
 *
 * `gacp/no-direct-application-status-write` got every writer to route through
 * writeApplicationStatus(). That fixed WHERE status is written; it never
 * constrained WHAT is written. The writer does `data: { status: toStatus }`
 * with no validation, so a caller can still put any string in the column —
 * and several do:
 *
 *   - application-submission-methods.js creates every wizard submission with
 *     status 'PAYMENT_1_PENDING'
 *   - application-payment-finalization-methods.js writes 'PAYMENT_1_PAID' /
 *     'PAYMENT_2_COMPLETED' when a phase settles
 *   - e2e-controller.js writes 'PAYMENT_2_PENDING'
 *
 * None of those five strings is in WORKFLOW_STATES. They survive only because
 * STATE_BY_LEGACY_STATUS translates them back on read — which is why the
 * translation layer can never be deleted: current code keeps refilling it.
 * This suite makes the vocabulary a write-time constraint so PR 2c can remove
 * the read-time translation without breaking anything.
 *
 * Deliberately NOT auto-translating an unknown value to its canonical
 * equivalent: a silent rewrite leaves the caller's bug in place and invisible,
 * and it would make the translation table load-bearing again.
 */

const fs = require('fs');
const path = require('path');

const { writeApplicationStatus } = require('../../services/application-status-writer');
const { WORKFLOW_STATES } = require('../../services/workflow-transition-service');

const BACKEND_ROOT = path.join(__dirname, '../..');

function stubPrisma() {
    const calls = [];
    return {
        calls,
        application: {
            findUnique: async () => ({ status: 'DRAFT', formData: {} }),
            update: async (args) => {
                calls.push(args);
                return { id: 'app-1', status: args.data.status, healthId: null, formData: {}, organizationId: null };
            },
        },
    };
}

describe('writeApplicationStatus enforces the canonical vocabulary', () => {
    test.each([
        'PAYMENT_1_PENDING',
        'PAYMENT_1_PAID',
        'PAYMENT_2_PENDING',
        'PAYMENT_2_COMPLETED',
        'REGISTERED',
        'DOCUMENT_APPROVED',
        'BANANA',
    ])('rejects the non-canonical status %s', async (toStatus) => {
        const prisma = stubPrisma();
        await expect(writeApplicationStatus({
            prisma,
            applicationId: 'app-1',
            fromStatus: 'DRAFT',
            toStatus,
            actorId: 'user-1',
            actorRole: 'system',
        })).rejects.toThrow(/not a canonical workflow state/i);

        // And nothing was written — the guard runs before the UPDATE.
        expect(prisma.calls).toHaveLength(0);
    });

    test('the rejection is typed so callers can distinguish it from a DB error', async () => {
        const prisma = stubPrisma();
        const error = await writeApplicationStatus({
            prisma,
            applicationId: 'app-1',
            fromStatus: 'DRAFT',
            toStatus: 'PAYMENT_1_PENDING',
            actorId: 'user-1',
            actorRole: 'system',
        }).catch((e) => e);

        expect(error.code).toBe('NON_CANONICAL_STATUS');
        // The message names the attempted value and points at the SSOT. It no
        // longer suggests a canonical replacement: PR 2c deleted the alias
        // tables the suggestion was read from, deliberately — keeping a
        // legacy→canonical map alive just to write nicer error text would make
        // the thing we removed load-bearing again.
        expect(error.message).toContain('PAYMENT_1_PENDING');
        expect(error.message).toMatch(/WORKFLOW_STATES/);
    });

    test('an unmappable value is rejected without a suggestion, not silently allowed', async () => {
        const prisma = stubPrisma();
        const error = await writeApplicationStatus({
            prisma,
            applicationId: 'app-1',
            fromStatus: 'DRAFT',
            toStatus: 'TOTALLY_MADE_UP',
            actorId: 'user-1',
            actorRole: 'system',
        }).catch((e) => e);

        expect(error.code).toBe('NON_CANONICAL_STATUS');
        expect(prisma.calls).toHaveLength(0);
    });

    test.each([...WORKFLOW_STATES])('accepts the canonical state %s', async (toStatus) => {
        const prisma = stubPrisma();
        await writeApplicationStatus({
            prisma,
            applicationId: 'app-1',
            fromStatus: 'DRAFT',
            toStatus,
            actorId: 'user-1',
            actorRole: 'system',
            // AUDIT_PASSED / APPROVED would reach for certificate-service.
            autoIssueCertificate: false,
        });
        expect(prisma.calls).toHaveLength(1);
        expect(prisma.calls[0].data.status).toBe(toStatus);
    });

    test('a missing toStatus still fails on the existing required-arg check', async () => {
        await expect(writeApplicationStatus({
            prisma: stubPrisma(),
            applicationId: 'app-1',
            actorId: 'user-1',
        })).rejects.toThrow(/toStatus required/);
    });
});

/**
 * Source-level gate. The runtime guard above catches a bad value when the code
 * path executes; this catches it at review time, including on paths that no
 * test exercises (seed scripts, the E2E harness).
 *
 * ═══ What this scanner sees, and what it does not — read before citing it ═══
 *
 * Until 2026-08-04 it claimed the E2E harness and saw neither it nor any other
 * non-.js file: the walker filtered on `.js` alone, so
 * scripts/e2e/gacp-lifecycle-simulation.mjs and the three .ts files in shared/
 * were outside the scan from the day the suite landed (c25b42a9, 2026-08-01).
 * The .ts gap was the wider one: `gacp/no-legacy-status-vocabulary` lints .js
 * and .mjs but ESLint has no TypeScript configuration in this package, so it
 * reports `File ignored because no matching configuration was supplied` for
 * shared/*.ts — for those files this scanner is the only gate that exists.
 *
 * The floor was equally hollow: `> 100` against 561 real files meant dropping
 * `'services'` (200 files) or `'routes'` (182) from SCAN_DIRS left the suite
 * green, so the pin could lose a third of its reach without anyone noticing.
 * Both holes are closed the way __tests__/unit/identity-provider-naming-
 * collision.test.js closes them (SCAN_DIRS + UNSCANNED_DIRS + a per-directory
 * floor + a sanity test that forces new top-level directories to be
 * classified); the registries live here rather than in a shared helper because
 * the two suites scan deliberately different sets (this one scans prisma/ for
 * seeds, that one scans config/, utils/, modules/, constants/, cron/ and
 * validation/), and unifying them would mean editing that suite, which is out
 * of scope for this change. Recorded in the backlog.
 *
 * Still not covered, by construction:
 *   - a status assembled at runtime (`'PAYMENT_' + n + '_PAID'`) or read from
 *     a table the regex never sees;
 *   - SQL migrations (see SKIPPED_SUBDIRS for why they stay out);
 *   - anything outside apps/backend.
 */
describe('no production writer stamps a non-canonical application status', () => {
    const LEGACY_LITERALS = [
        'PAYMENT_1_PENDING',
        'PAYMENT_1_PAID',
        'PAYMENT_2_PENDING',
        'PAYMENT_2_COMPLETED',
        'PAYMENT_PHASE_1',
        'PAYMENT_PHASE_2',
        'DOCUMENT_APPROVED',
        'FINAL_APPROVED',
        'FINAL_REJECTED',
    ];

    // Files whose JOB is to know the legacy spellings: the SSOT's own
    // translation table, the read-side projections that must keep resolving
    // old rows, and the payment-phase enum that is a DIFFERENT vocabulary
    // (Payment.phase, not Application.status).
    const ALLOWED = new Set([
        'services/workflow-transition-service.js',
        'shared/health-dashboard-stage.js',
        'routes/api/finance/payments.js',
        'routes/api/helpers/application-payload-builders.js',
    ]);

    const SCAN_DIRS = ['routes', 'services', 'controllers', 'jobs', 'scripts', 'prisma', 'middleware', 'shared'];

    /**
     * Top-level directories of apps/backend that are deliberately NOT scanned.
     * A confession of what is out of reach, not a list of things known safe:
     * the sanity test only checks that every top-level directory holding code
     * appears in exactly one of the two registries, so a new directory cannot
     * slip out of the scan silently.
     */
    const UNSCANNED_DIRS = {
        __tests__: 'tests — fixtures name the legacy spellings on purpose, and this file lives here',
        'test-support': 'jest harness helpers (test-database probe, postgres runner) — loaded by globalSetup, never by a request path',
        tests: 'property-based tests — same reason as __tests__',
        'chaos-tests': 'chaos scenarios (yml) — not on a request path',
        config: 'runtime configuration — no Application.status writes; covered by gacp/no-legacy-status-vocabulary',
        constants: 'value tables — same, covered by the lint rule',
        cron: 'schedules — same, covered by the lint rule',
        utils: 'helpers — same, covered by the lint rule',
        modules: 'Phase A6 module homes (still empty of status writers) — covered by the lint rule',
        validation: 'request schemas — same, covered by the lint rule',
        data: 'static tables (Thai addresses, journey config) — no DB write path',
        'eslint-rules': 'the lint plugin itself; its fixtures quote the legacy spellings by design',
        'node_modules': 'dependency',
        coverage: 'jest artifact (gitignored) — contains .js from lcov-report',
        dist: 'build artifact (gitignored)',
        build: 'build artifact (gitignored)',
        generated: 'prisma generate artifact (gitignored)',
        uploads: 'user uploads (gitignored)',
        logs: 'logs (gitignored)',
    };

    /**
     * Sub-directories skipped inside a scanned directory, with the reason each
     * one is out. `migrations` was an unexplained `continue` until 2026-08-04;
     * it is a deliberate exclusion, and this is the reasoning:
     *
     *   1. Applied migrations are an append-only record of what already
     *      happened. A legacy literal in an old migration is a fact about the
     *      past, not a leak to fix, and Law 3.10 forbids rewriting one to
     *      make a test green — the assertion would be unfixable by design.
     *   2. The write shapes below are JavaScript-shaped. SQL spells the same
     *      write `"status" = 'PAYMENT_1_PENDING'`, which no pattern here
     *      matches, so walking .sql would add files the scan cannot read and
     *      buy confidence that is not there.
     *
     * Verified while writing this comment: 114 .sql files under
     * prisma/migrations, zero occurrences of any LEGACY_LITERALS token in any
     * of them (evidence/STATUS-WRITER/red-green.txt). A SQL-aware equivalent
     * is filed in the backlog rather than faked here.
     */
    const SKIPPED_SUBDIRS = {
        node_modules: 'dependency',
        __tests__: 'tests — fixtures name the legacy spellings on purpose',
        migrations: 'append-only history + SQL write shapes this scanner cannot read (see above)',
    };

    /**
     * Per-directory file floors — also the registry of expected directory
     * names. Three layers, because a single total floor is not enough:
     *   1. SCAN_DIRS must equal the keys of this table (deleting a directory
     *      from one side only turns the suite red);
     *   2. each directory must return at least its own floor (deleting it
     *      from both sides makes that directory count 0);
     *   3. the sanity test re-reads the directory listing from disk, so
     *      deleting an entry from both registries is still red.
     *
     * Counted 2026-08-04 with the walker below (extensions included):
     *   services 200 · routes 182 · scripts 79 · shared 44 · middleware 22 ·
     *   controllers 17 · prisma 13 · jobs 8   (565 total)
     * Floors sit near 85% of the real count so ordinary file moves do not
     * require editing this test. The numbers match the equivalent table in
     * identity-provider-naming-collision.test.js for the directories both
     * suites scan, on purpose: two tables that disagree about the same
     * directory would be a second source of truth in the ugliest way.
     */
    const SCAN_DIR_FILE_FLOOR = {
        routes: 150,
        services: 170,
        controllers: 14,
        jobs: 6,
        scripts: 65,
        prisma: 11,
        middleware: 18,
        shared: 38,
    };

    /** Backstop for the case the walker breaks entirely and every count is 0. */
    const MIN_SCANNED_FILES = 530;

    /**
     * Extensions that count as runnable code. `.mjs` stays on the list even
     * though no .mjs file remains in tree today (the one that did — an E2E
     * lifecycle harness — was deleted with the slip flow it simulated): the
     * next one must be scanned on the day it lands, not on the day someone
     * remembers to add the extension. `.ts` matters because ESLint is not configured for
     * TypeScript in this package, so shared/*.ts has no other gate.
     */
    const CODE_FILE_EXTENSIONS = ['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts'];

    function isCodeFile(name) {
        return CODE_FILE_EXTENSIONS.some((ext) => name.endsWith(ext));
    }

    function walk(dir, out = []) {
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return out;
        }
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (entry.name in SKIPPED_SUBDIRS) { continue; }
                walk(full, out);
            } else if (isCodeFile(entry.name)) {
                out.push(full);
            }
        }
        return out;
    }

    /**
     * Does this top-level directory hold any code at all? Used to decide
     * whether it must be classified. Does not skip __tests__: a directory
     * whose only code sits in a __tests__ folder still has to be declared.
     */
    function hasCodeFile(dir) {
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return false;
        }
        for (const entry of entries) {
            if (entry.isDirectory()) {
                if (entry.name === 'node_modules') { continue; }
                if (hasCodeFile(path.join(dir, entry.name))) { return true; }
            } else if (isCodeFile(entry.name)) {
                return true;
            }
        }
        return false;
    }

    // `status: 'X'` / `toStatus: 'X'` / `const newStatus = 'X'` — WRITE shapes.
    // The `\w*` prefix matters: the phase-settlement site computed the value as
    // `const newStatus = ... ? 'PAYMENT_1_PAID' : 'PAYMENT_2_COMPLETED'`, which
    // a `status:`-only pattern walks straight past.
    //
    // A read filter (`status: { in: [...] }`) does not match, and is a PR 2c
    // concern anyway: reads that ACCEPT legacy values are the compatibility
    // layer; writes that PRODUCE them are the leak that keeps it alive.
    const writeShape = (literal) => new RegExp(
        `\\b\\w*[sS]tatus\\s*[:=]\\s*(?:[^;\\n]*\\?[^;\\n]*)?'${literal}'`,
    );

    test('no write-shaped legacy status literal survives outside the SSOT', () => {
        const offenders = [];
        for (const dir of SCAN_DIRS) {
            for (const file of walk(path.join(BACKEND_ROOT, dir))) {
                const rel = path.relative(BACKEND_ROOT, file).split(path.sep).join('/'); // posix-normalised (Windows dev machines)
                if (ALLOWED.has(rel)) { continue; }
                const source = fs.readFileSync(file, 'utf8');
                for (const literal of LEGACY_LITERALS) {
                    if (writeShape(literal).test(source)) {
                        offenders.push(`${rel}: writes ${literal}`);
                    }
                }
            }
        }
        expect(offenders.sort()).toEqual([]);
    });

    test('the scan actually reads files (guards against a vacuous pass)', () => {
        // Layer 1: the scanned set and the floor table name the same directories.
        expect([...SCAN_DIRS].sort()).toEqual(Object.keys(SCAN_DIR_FILE_FLOOR).sort());

        // Layer 2: every directory returns at least its own floor.
        const belowFloor = Object.entries(SCAN_DIR_FILE_FLOOR)
            .map(([dir, floor]) => [dir, walk(path.join(BACKEND_ROOT, dir)).length, floor])
            .filter(([, count, floor]) => count < floor)
            .map(([dir, count, floor]) => `${dir}: ${count} < ${floor}`);
        expect(belowFloor).toEqual([]);

        // Layer 3: every top-level directory holding code is classified as
        // either scanned or knowingly unscanned. A new one is red until
        // somebody decides which it is.
        const unclassified = fs.readdirSync(BACKEND_ROOT, { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .map((entry) => entry.name)
            .filter((name) => !SCAN_DIRS.includes(name) && !(name in UNSCANNED_DIRS))
            .filter((name) => hasCodeFile(path.join(BACKEND_ROOT, name)));
        expect(unclassified).toEqual([]);

        // Backstop for a walker that breaks outright.
        const files = SCAN_DIRS.flatMap((dir) => walk(path.join(BACKEND_ROOT, dir)));
        expect(files.length).toBeGreaterThanOrEqual(MIN_SCANNED_FILES);

        // ต้องเห็นไฟล์ที่อยู่ลึกกว่าชั้นแรกของ scripts/ จริง ๆ ไม่ใช่แค่ไฟล์ชั้นบนสุด
        // (เดิมข้อนี้ชี้ scripts/e2e/gacp-lifecycle-simulation.mjs ซึ่งถูกลบ 2026-09-11
        // เพราะมันจำลอง flow สลิปที่ไม่มีอยู่แล้ว — เรียก endpoint สี่ตัวที่ถูกถอดไป)
        expect(files.map((f) => path.relative(BACKEND_ROOT, f).split(path.sep).join('/')))
            .toContain('scripts/rls/prototype-probe.js');

        // And the regex genuinely matches the shape it claims to.
        expect(writeShape('PAYMENT_1_PENDING').test("status: 'PAYMENT_1_PENDING',")).toBe(true);
        expect(writeShape('PAYMENT_1_PENDING').test("toStatus: 'PAYMENT_1_PENDING',")).toBe(true);
        expect(writeShape('PAYMENT_1_PAID').test("const newStatus = p === 'PHASE_1' ? 'PAYMENT_1_PAID' : 'X';")).toBe(true);
        expect(writeShape('PAYMENT_1_PENDING').test("status: { in: ['PAYMENT_1_PENDING'] }")).toBe(false);
        expect(writeShape('PAYMENT_1_PENDING').test("// legacy rows carry 'PAYMENT_1_PENDING'")).toBe(false);
    });
});
