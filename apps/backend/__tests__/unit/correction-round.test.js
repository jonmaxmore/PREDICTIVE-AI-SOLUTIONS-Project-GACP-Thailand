'use strict';

/**
 * R2 M3 — round counter ต่อ stage + SSOT เลข 5 (FINAL ข้อ 2, operator 2026-08-03).
 * Spec: evidence/R2-special-reopen/final-requirements.md ข้อ 2 verbatim
 * ("นับเลขครั้งต่อ stage — reset ทุกรอบ วนไม่จำกัดครั้ง") + decisions-final.md
 * แผน M3 + gap-report.md ตาราง ข้อ 2 (C-3: ไม่มี counter ต่อ stage).
 *
 * Pins:
 *   1. CorrectionRound append ledger: roundNo ต่อ (application, stage) นับใน
 *      tx เดียวกับ decision+letter (M2 mint จุดเดียว decision-letter-service).
 *      DOC_REVIEW กับ FIELD_AUDIT เป็นตัวนับอิสระกัน.
 *   2. วนไม่จำกัดครั้ง — ไม่มี cap (D-2 ยกเลิกกติกา "แก้ไม่เกิน 3 ครั้ง").
 *   3. Append-only (FINAL ข้อ 4): ไม่มี update/upsert/delete path ต่อ
 *      correctionRound ทั้ง backend — writer เดียวคือ decision-letter-service.
 *   4. Unique (applicationId, stage, roundNo): decision ซ้อนกันชนกุญแจ →
 *      P2002 → fail ชัด (Postgres abort tx แล้ว retry ใน tx ไม่ได้ —
 *      transaction ทั้งก้อนล้ม, caller ยิง decision ใหม่).
 *   5. จดหมาย M2 มีเลขครั้ง: "การแก้ไขครั้งที่ N ของขั้นตอน..." เป็น
 *      องค์ประกอบบังคับตัวที่ 5 ของ template (ขาด = refuse, D-8).
 *   6. SSOT เลข 5: ทุก surface อ่าน config/business-rules.js
 *      PAYMENT.REVISION_DEADLINE_BUSINESS_DAYS — ไม่มี literal 5 ในบริบท SLA
 *      นอก config (ยกเว้น waiver* — L4 ห้ามแตะ).
 *   7. Atomic (D-8/D-8 M3): round write ล้ม → mint ล้ม → decision tx ล้ม.
 *   8. Schema/migration EXPAND (Law 3.10): ตารางใหม่ ไม่แตะ RevisionDeadline
 *      เดิม; migration idempotent + rollback comment + timestamp ไม่ชนของเดิม.
 *
 * The DOC_REVIEW/FIELD_AUDIT literals are pinned as raw strings ON PURPOSE
 * (same rationale as official-letter.test.js — asserting through the SSOT
 * import would be a tautology; test files are excluded from grep pins).
 */

const fs = require('fs');
const path = require('path');

const BACKEND = path.join(__dirname, '..', '..');

// ── mocks (template stays REAL — the round line must come from the SSOT) ───

const mockFindUserByHealthIdSecurely = jest.fn();
jest.mock('../../services/user-lookup-service', () => ({
    findUserByHealthIdSecurely: (...a) => mockFindUserByHealthIdSecurely(...a),
}));

const mockCreateOfficialLetter = jest.fn();
jest.mock('../../services/notification-service', () => ({
    createOfficialLetter: (...a) => mockCreateOfficialLetter(...a),
}));

const { mintCorrectionLetter, CORRECTION_LETTER_STAGE } = require('../../services/decision-letter-service');

// Pinned DB literals (see file header).
const DOC = 'DOC_REVIEW';
const FIELD = 'FIELD_AUDIT';

const FARMER = { id: 'farmer-1', organizationId: 'org-farm' };
const DUE = new Date('2026-08-11T09:59:59.000Z');

function makeTx() {
    return {
        correctionRound: {
            count: jest.fn(async () => 0),
            create: jest.fn(async ({ data }) => ({ id: 'round-1', ...data })),
        },
    };
}

function mintArgs(tx, overrides = {}) {
    return {
        tx,
        healthId: 'h-1',
        applicationId: 'app-1',
        applicationNumber: 'GACP-001',
        stage: CORRECTION_LETTER_STAGE.DOC_REVIEW,
        items: ['เอกสารหมวดที่ 3 ไม่ครบถ้วน'],
        message: 'กรุณาแก้ไขตามรายการ',
        dueAt: DUE,
        ...overrides,
    };
}

function walkJsFiles(dir, out = []) {
    const SKIP = new Set([
        'node_modules', '__tests__', 'chaos-tests', 'coverage',
        '.next', 'dist', 'build', '.turbo',
    ]);
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (SKIP.has(entry.name)) { continue; }
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            walkJsFiles(p, out);
        } else if (entry.isFile() && entry.name.endsWith('.js')) {
            out.push(p);
        }
    }
    return out;
}

beforeEach(() => {
    jest.clearAllMocks();
    mockFindUserByHealthIdSecurely.mockResolvedValue({ ...FARMER });
    mockCreateOfficialLetter.mockImplementation(async (args) => ({ id: 'letter-1', ...args }));
});

// ───────────────────────────────────────────────────────────────────────────
// 1-2. roundNo ต่อ stage — อิสระกัน + วนไม่จำกัด
// ───────────────────────────────────────────────────────────────────────────

describe('per-stage round counter (FINAL ข้อ 2: นับเลขครั้งต่อ stage)', () => {
    test('roundNo = prior rounds of (application, stage) + 1, counted through the SAME tx', async () => {
        const tx = makeTx();
        tx.correctionRound.count.mockResolvedValue(2);

        await mintCorrectionLetter(mintArgs(tx));

        expect(tx.correctionRound.count).toHaveBeenCalledWith({
            where: { applicationId: 'app-1', stage: DOC },
        });
        expect(tx.correctionRound.create).toHaveBeenCalledTimes(1);
        expect(tx.correctionRound.create.mock.calls[0][0].data).toMatchObject({
            applicationId: 'app-1',
            stage: DOC,
            roundNo: 3,
            letterId: 'letter-1',
            organizationId: FARMER.organizationId,
        });
    });

    test('DOC_REVIEW round 3 does NOT bleed into FIELD_AUDIT round 1 (independent counters)', async () => {
        const tx = makeTx();
        // Same application: 2 prior doc-review rounds, 0 prior field-audit rounds.
        tx.correctionRound.count.mockImplementation(async ({ where }) =>
            (where.stage === DOC ? 2 : 0));

        await mintCorrectionLetter(mintArgs(tx, { stage: CORRECTION_LETTER_STAGE.DOC_REVIEW }));
        await mintCorrectionLetter(mintArgs(tx, {
            stage: CORRECTION_LETTER_STAGE.FIELD_AUDIT_CAR,
            items: ['พบข้อบกพร่องจากการตรวจประเมิน'],
        }));

        const rows = tx.correctionRound.create.mock.calls.map((c) => c[0].data);
        expect(rows).toHaveLength(2);
        expect(rows[0]).toMatchObject({ stage: DOC, roundNo: 3 });
        // Letter-stage FIELD_AUDIT_CAR (M2 vocab) lands as round-stage FIELD_AUDIT.
        expect(rows[1]).toMatchObject({ stage: FIELD, roundNo: 1 });
    });

    test('วนไม่จำกัดครั้ง — round 42 is minted without any cap (D-2: เพดาน 3 ครั้ง ถูกยกเลิก)', async () => {
        const tx = makeTx();
        tx.correctionRound.count.mockResolvedValue(41);

        await mintCorrectionLetter(mintArgs(tx));

        expect(tx.correctionRound.create.mock.calls[0][0].data.roundNo).toBe(42);
        // The letter carries the same round number.
        const letterArgs = mockCreateOfficialLetter.mock.calls[0][0];
        expect(letterArgs.message).toContain('การแก้ไขครั้งที่ 42');
        expect(letterArgs.metadata.roundNo).toBe(42);
    });

    test('round record carries decidedAt + dueAt of the decision', async () => {
        const tx = makeTx();
        await mintCorrectionLetter(mintArgs(tx));
        const data = tx.correctionRound.create.mock.calls[0][0].data;
        expect(data.decidedAt).toBeInstanceOf(Date);
        expect(new Date(data.dueAt).toISOString()).toBe(DUE.toISOString());
    });
});

// ───────────────────────────────────────────────────────────────────────────
// 4. unique (applicationId, stage, roundNo) — concurrent decision fails LOUDLY
// ───────────────────────────────────────────────────────────────────────────

describe('unique round key — concurrent decisions', () => {
    test('P2002 on the round key rejects with a CLEAR error (no swallow, no silent skip)', async () => {
        const tx = makeTx();
        const p2002 = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
        tx.correctionRound.create.mockRejectedValue(p2002);

        await expect(mintCorrectionLetter(mintArgs(tx))).rejects.toThrow(/concurrent|refused/i);
    });

    test('non-P2002 round-write failure propagates as-is (atomic — tx ทั้งก้อนล้ม)', async () => {
        const tx = makeTx();
        tx.correctionRound.create.mockRejectedValue(new Error('round write refused'));

        await expect(mintCorrectionLetter(mintArgs(tx))).rejects.toThrow('round write refused');
        // The letter row went in first through the SAME tx — its write is
        // rolled back together with the round by the caller's transaction.
        expect(mockCreateOfficialLetter).toHaveBeenCalledTimes(1);
        expect(mockCreateOfficialLetter.mock.calls[0][0].tx).toBe(tx);
    });
});

// ───────────────────────────────────────────────────────────────────────────
// 5. จดหมายมีเลขครั้ง — องค์ประกอบบังคับตัวที่ 5 ของ template
// ───────────────────────────────────────────────────────────────────────────

describe('letter round number (M2 template, 5th mandatory element)', () => {
    const { buildCorrectionLetter } = require('../../shared/correction-letter-template');

    test('buildCorrectionLetter emits "การแก้ไขครั้งที่ N ของขั้นตอน..." + metadata.roundNo', () => {
        const letter = buildCorrectionLetter({
            applicationNumber: 'GACP-001',
            stage: CORRECTION_LETTER_STAGE.DOC_REVIEW,
            items: ['รายการที่หนึ่ง'],
            message: null,
            dueAt: DUE,
            roundNo: 3,
        });
        expect(letter.message).toContain('การแก้ไขครั้งที่ 3 ของขั้นตอน');
        expect(letter.metadata.roundNo).toBe(3);
    });

    test('a letter WITHOUT its round number is REFUSED (throw — D-8: no letter, no transition)', () => {
        for (const missing of [{}, { roundNo: 0 }, { roundNo: -1 }, { roundNo: 1.5 }, { roundNo: '2' }]) {
            expect(() => buildCorrectionLetter({
                applicationNumber: 'GACP-001',
                stage: CORRECTION_LETTER_STAGE.DOC_REVIEW,
                items: ['รายการ'],
                message: null,
                dueAt: DUE,
                ...missing,
            })).toThrow(/roundNo/);
        }
    });

    test('mintCorrectionLetter always sends the round number into the letter', async () => {
        const tx = makeTx();
        tx.correctionRound.count.mockResolvedValue(0);

        await mintCorrectionLetter(mintArgs(tx));

        const letterArgs = mockCreateOfficialLetter.mock.calls[0][0];
        expect(letterArgs.message).toContain('การแก้ไขครั้งที่ 1 ของขั้นตอน');
        expect(letterArgs.metadata.roundNo).toBe(1);
    });

    test('the round-line Thai copy is defined ONLY in the letter template SSOT (Law 3.5/3.6)', () => {
        const TEMPLATE = path.join(BACKEND, 'shared', 'correction-letter-template.js');
        const offenders = walkJsFiles(BACKEND)
            .filter((f) => f !== TEMPLATE)
            .filter((f) => fs.readFileSync(f, 'utf8').includes('การแก้ไขครั้งที่'))
            .map((f) => path.relative(BACKEND, f));
        expect(offenders).toEqual([]);
    });
});

// ───────────────────────────────────────────────────────────────────────────
// Stage vocabulary SSOT (shared/correction-round-stage.js)
// ───────────────────────────────────────────────────────────────────────────

describe('round-stage vocabulary SSOT', () => {
    test('exports the frozen DOC_REVIEW/FIELD_AUDIT vocabulary', () => {
        const vocab = require('../../shared/correction-round-stage');
        expect(vocab.CORRECTION_ROUND_STAGE).toEqual({ DOC_REVIEW: DOC, FIELD_AUDIT: FIELD });
        expect(Object.isFrozen(vocab.CORRECTION_ROUND_STAGE)).toBe(true);
    });

    test('maps the M2 letter stages: DOC_REVIEW→DOC_REVIEW, FIELD_AUDIT_CAR→FIELD_AUDIT; unknown → throw', () => {
        const { roundStageForLetterStage } = require('../../shared/correction-round-stage');
        expect(roundStageForLetterStage(CORRECTION_LETTER_STAGE.DOC_REVIEW)).toBe(DOC);
        expect(roundStageForLetterStage(CORRECTION_LETTER_STAGE.FIELD_AUDIT_CAR)).toBe(FIELD);
        expect(() => roundStageForLetterStage('SOMETHING_ELSE')).toThrow();
    });
});

// ───────────────────────────────────────────────────────────────────────────
// 3. append-only — no update/delete path anywhere in the backend
// ───────────────────────────────────────────────────────────────────────────

describe('append-only round ledger (FINAL ข้อ 4)', () => {
    test('no backend .js file mutates correctionRound (update/upsert/delete are forbidden)', () => {
        const offenders = walkJsFiles(BACKEND)
            .filter((f) => /correctionRound\s*\.\s*(update|updateMany|upsert|delete|deleteMany)/
                .test(fs.readFileSync(f, 'utf8')))
            .map((f) => path.relative(BACKEND, f));
        expect(offenders).toEqual([]);
    });

    test('the ONLY correctionRound writer is decision-letter-service (the M2 mint point)', () => {
        const writers = walkJsFiles(BACKEND)
            .filter((f) => /correctionRound\s*\.\s*create/.test(fs.readFileSync(f, 'utf8')))
            .map((f) => path.relative(BACKEND, f));
        expect(writers).toEqual([path.join('services', 'decision-letter-service.js')]);
    });

    test('CorrectionRound is registered tenant-scoped (services/tenant-prisma-extension.js)', () => {
        const src = fs.readFileSync(
            path.join(BACKEND, 'services', 'tenant-prisma-extension.js'), 'utf8',
        );
        expect(src).toMatch(/'CorrectionRound',\s*\/\/\s*correction_rounds/);
    });
});

// ───────────────────────────────────────────────────────────────────────────
// 8. schema + migration EXPAND (Law 3.10)
// ───────────────────────────────────────────────────────────────────────────

describe('schema EXPAND — CorrectionRound', () => {
    const SCHEMA_DIR = path.join(BACKEND, 'prisma', 'schema');
    const MIGRATIONS_DIR = path.join(BACKEND, 'prisma', 'migrations');

    test('correction-round.prisma declares the append ledger with the per-stage unique key', () => {
        const pslPath = path.join(SCHEMA_DIR, 'correction-round.prisma');
        expect(fs.existsSync(pslPath)).toBe(true);
        const psl = fs.readFileSync(pslPath, 'utf8');
        expect(psl).toMatch(/model CorrectionRound \{/);
        expect(psl).toMatch(/@@unique\(\[applicationId, stage, roundNo\]\)/);
        expect(psl).toMatch(/@@map\("correction_rounds"\)/);
        // organizationId is REQUIRED (no `String?`).
        expect(psl).toMatch(/organizationId String\n/);
        // Append-only rows are never touched again — no updatedAt column.
        expect(psl).not.toMatch(/updatedAt/);
    });

    test('RevisionDeadline stays untouched (EXPAND, not contract — Law 3.10)', () => {
        const audit = fs.readFileSync(path.join(SCHEMA_DIR, 'audit.prisma'), 'utf8');
        expect(audit).toMatch(/model RevisionDeadline \{/);
        expect(audit).toMatch(/applicationId String\s+@unique/);
        expect(audit).toMatch(/revisionCount Int\s+@default\(0\)/);
    });

    test('exactly one add_correction_rounds migration exists, EXPAND-only, timestamp not colliding', () => {
        const dirs = fs.readdirSync(MIGRATIONS_DIR)
            .filter((d) => /^\d{14}_add_correction_rounds$/.test(d));
        expect(dirs).toHaveLength(1);

        // Timestamp collision guard: two 20260803120000_* dirs already exist —
        // the M3 migration must own a UNIQUE 14-digit prefix.
        const prefix = dirs[0].slice(0, 14);
        const samePrefix = fs.readdirSync(MIGRATIONS_DIR)
            .filter((d) => d.startsWith(prefix) && d !== dirs[0]);
        expect(samePrefix).toEqual([]);

        const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, dirs[0], 'migration.sql'), 'utf8');
        expect(sql).toMatch(/^BEGIN;$/m);
        expect(sql).toMatch(/^COMMIT;$/m);
        expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS "correction_rounds"/);
        expect(sql).toMatch(/"stage" IN \('DOC_REVIEW', 'FIELD_AUDIT'\)/);
        expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS "correction_rounds_applicationId_stage_roundNo_key"/);
        expect(sql).toMatch(/^--\s+Rollback \(manual\):/m);

        // Additive-only: no destructive DDL outside comment lines.
        const active = sql
            .split('\n')
            .filter((line) => !line.trim().startsWith('--'))
            .join('\n');
        expect(active).not.toMatch(/DROP\s+(TABLE|COLUMN|INDEX)/i);
        expect(active).not.toMatch(/ALTER\s+COLUMN/i);
        expect(active).not.toMatch(/\b(DELETE\s+FROM|TRUNCATE)\b/i);
        // UPDATE as a STATEMENT (not the `ON UPDATE CASCADE` FK action).
        expect(active).not.toMatch(/^\s*UPDATE\b/im);
    });
});

// ───────────────────────────────────────────────────────────────────────────
// 6. SSOT เลข 5 — ONE defining source (config/business-rules.js)
// ───────────────────────────────────────────────────────────────────────────

describe('SSOT เลข 5 (Law 3.5/3.6) — พฤติกรรมเท่าเดิม, แหล่งเดียว', () => {
    const read = (rel) => fs.readFileSync(path.join(BACKEND, rel), 'utf8');

    test('canonical value unchanged: PAYMENT.REVISION_DEADLINE_BUSINESS_DAYS === 5', () => {
        const { PAYMENT } = require('../../config/business-rules');
        expect(PAYMENT.REVISION_DEADLINE_BUSINESS_DAYS).toBe(5);
    });

    test('workflow-handler-deps reads config — no REVISION_SLA_DAYS = 5 literal', () => {
        const src = read('routes/api/provider/handlers/workflow-handler-deps.js');
        expect(src).toMatch(/REVISION_SLA_DAYS\s*=\s*PAYMENT\.REVISION_DEADLINE_BUSINESS_DAYS/);
        expect(src).not.toMatch(/REVISION_SLA_DAYS\s*=\s*5/);
    });

    test('workflow-transitions-handler: CAR_SLA_DAYS is derived, not re-spelled', () => {
        const src = read('routes/api/provider/handlers/workflow-transitions-handler.js');
        expect(src).toMatch(/CAR_SLA_DAYS\s*=\s*REVISION_SLA_DAYS/);
        expect(src).not.toMatch(/CAR_SLA_DAYS\s*=\s*5/);
    });

    test('PATCH /reject surface reads config — no addWorkingDays(now, 5) / revisionSlaDays: 5', () => {
        const src = read('routes/api/applications/application-workflow-handlers.js');
        expect(src).toMatch(/addWorkingDays\(now,\s*PAYMENT\.REVISION_DEADLINE_BUSINESS_DAYS\)/);
        expect(src).not.toMatch(/addWorkingDays\(\s*now,\s*5\s*\)/);
        expect(src).not.toMatch(/revision_?sla_?days['"]?\s*:\s*5\b/i);
    });

    test('car-deadline-service reads config directly — no `?? 5` shadow source', () => {
        const src = read('services/car-deadline-service.js');
        expect(src).toMatch(/REVISION_DEADLINE_BUSINESS_DAYS/);
        expect(src).not.toMatch(/\?\?\s*5\b/);
    });

    /**
     * Every layer that can spell the revision-SLA day count, and every spelling
     * of it this repository actually uses.
     *
     * The first version of this pin walked services/routes/jobs only and
     * matched `SLA_DAYS = <n>` only. Both halves were too narrow, and the M3
     * audit proved it: three live sources survived a green run —
     * scripts/ops/restamp-revision-deadlines.js (a --apply writer),
     * scripts/ops/identify-wrongful-expiry-cohort.js, and the
     * `businessDays = 5` default parameter in utils/working-days.js. A pin
     * whose name claims "no literal" has to look everywhere the literal can
     * live, or the green is the bug.
     */
    const SLA_SOURCE_DIRS = ['services', 'routes', 'jobs', 'scripts', 'utils'];
    // Any identifier ENDING in one of the revision-SLA spellings, assigned a
    // number: `REVISION_SLA_DAYS = 5`, `CAR_SLA_DAYS = 5`, `SLA_DAYS = 5`,
    // `carSlaDays = 5`, and the default-parameter spelling `businessDays = 5`
    // (which also covers its @param JSDoc default).
    //
    // `\b\w*` and not a bare `\b`: `_` is a word character, so `\bSLA_DAYS`
    // has no boundary to match inside `REVISION_SLA_DAYS`. The suffix stays
    // pinned to an SLA/business-days word so a plain `days = 5` is never an
    // offender. See SLA_PATTERN_CASES below, which probes both directions.
    const SLA_LITERAL = /\b\w*(?:SLA_DAYS|[Ss]laDays|[Bb]usinessDays)\s*=\s*\d/;

    /**
     * L4 exception, declared out loud rather than left to a silent regex:
     * the waiver-coexistence family (services/waiver-reopen-service.js,
     * jobs/waiver-sla-escalation-job.js, scripts/ops/waiver-anomaly-report.js)
     * is operator-frozen pending the legal ruling. Those files keep their own
     * SLA_DAYS constant; nothing in this task may touch them.
     */
    const isWaiverFamily = (file) => path.basename(file).startsWith('waiver');

    /**
     * The pattern itself is pinned, because the pattern is where this pin has
     * already regressed once.
     *
     * Fix cycle 1 rewrote SLA_LITERAL as `/\b(?:SLA_DAYS|...)/`. The leading
     * `\b` is the bug: `_` is a word character, so there is no boundary in
     * front of the `SLA_DAYS` inside `REVISION_SLA_DAYS` or `CAR_SLA_DAYS` —
     * the two spellings this repository actually uses, and the two that M3
     * itself had just moved onto config (workflow-handler-deps.js
     * REVISION_SLA_DAYS, workflow-transitions-handler.js CAR_SLA_DAYS). The
     * commit that advertised a wider pin shipped a narrower one on the axis
     * most likely to regress, and a file-walking pin cannot report that about
     * itself: dropping `const REVISION_SLA_DAYS = 5;` into
     * services/car-deadline-service.js left the suite green.
     *
     * So the regex is probed directly, from both sides — every spelling it
     * must flag, and the day counts it must leave alone. When a spelling in
     * the "must not flag" column starts failing, the fix is a better pattern,
     * never an allowlist entry.
     */
    const SLA_PATTERN_CASES = [
        // must flag — the revision-SLA day count, however it is spelled
        ['const REVISION_SLA_DAYS = 5;', true],
        ['const CAR_SLA_DAYS = 5;', true],
        ['const SLA_DAYS = 5;', true],
        ['function calculateRevisionDeadline(from, businessDays = 5) {}', true],
        ['let carSlaDays = 5;', true],
        ['const slaDays = 5;', true],
        [' * @param {number} [businessDays=5] jsdoc default', true],
        // must not flag — day counts that are not the revision SLA
        ['const days = 5;', false],
        ['const WORKING_DAYS = 5;', false],
        ['const MAX_DAYS = 5;', false],
        ['const graceDays = 5;', false],
        ['const slaDaysRemaining = 5;', false],
        ['const businessDaysLeft = 5;', false],
    ];

    test('SLA_LITERAL flags every prefixed spelling and no bare day count', () => {
        const row = (line, flagged) => `${flagged ? 'FLAG' : 'ok  '}  ${line}`;
        const actual = SLA_PATTERN_CASES.map(([line]) => row(line, SLA_LITERAL.test(line)));
        const expected = SLA_PATTERN_CASES.map(([line, flagged]) => row(line, flagged));
        expect(actual).toEqual(expected);
    });

    test('grep-pin: no revision-SLA day literal in services/routes/jobs/scripts/utils outside the waiver family (L4)', () => {
        const offenders = [];
        for (const dir of SLA_SOURCE_DIRS.map((d) => path.join(BACKEND, d))) {
            for (const f of walkJsFiles(dir)) {
                if (isWaiverFamily(f)) { continue; }
                if (SLA_LITERAL.test(fs.readFileSync(f, 'utf8'))) {
                    offenders.push(path.relative(BACKEND, f));
                }
            }
        }
        expect(offenders).toEqual([]);
    });

    test('the L4 waiver exception is the ONLY thing the pin skips, and it is still there', () => {
        const skipped = [];
        for (const dir of SLA_SOURCE_DIRS.map((d) => path.join(BACKEND, d))) {
            for (const f of walkJsFiles(dir)) {
                if (isWaiverFamily(f) && SLA_LITERAL.test(fs.readFileSync(f, 'utf8'))) {
                    skipped.push(path.relative(BACKEND, f).split(path.sep).join('/'));
                }
            }
        }
        expect(skipped.sort()).toEqual([
            'jobs/waiver-sla-escalation-job.js',
            'scripts/ops/waiver-anomaly-report.js',
            'services/waiver-reopen-service.js',
        ]);
    });

    test('ops scripts read config — restamp/identify-cohort no longer own an SLA constant', () => {
        for (const rel of [
            'scripts/ops/restamp-revision-deadlines.js',
            'scripts/ops/identify-wrongful-expiry-cohort.js',
        ]) {
            const src = read(rel);
            expect(src).toMatch(/require\(.*config\/business-rules.*\)/);
            expect(src).toMatch(/PAYMENT\.REVISION_DEADLINE_BUSINESS_DAYS/);
        }
    });

    test('utils/working-days calculateRevisionDeadline defaults FROM config, not from a literal', () => {
        const src = read('utils/working-days.js');
        expect(src).toMatch(/require\(.*config\/business-rules.*\)/);
        expect(src).toMatch(/businessDays\s*=\s*[A-Z_]*PAYMENT\.REVISION_DEADLINE_BUSINESS_DAYS/);

        // Behaviour unchanged: the default still resolves to the canonical 5.
        const { calculateRevisionDeadline, addWorkingDays } = require('../../utils/working-days');
        const { PAYMENT } = require('../../config/business-rules');
        const start = new Date('2026-08-03T03:00:00.000Z');
        expect(calculateRevisionDeadline(start).revisionDue.toISOString())
            .toBe(addWorkingDays(start, PAYMENT.REVISION_DEADLINE_BUSINESS_DAYS).toISOString());
        expect(calculateRevisionDeadline(start).workingDaysAdded)
            .toBe(PAYMENT.REVISION_DEADLINE_BUSINESS_DAYS);
    });
});
