'use strict';

/**
 * R2 M1 — OFFICIAL_LETTER (operator decision D-9, 2026-08-03).
 * Spec: evidence/R2-special-reopen/decisions-final.md (แผน M1) +
 * gap-report.md ข้อ 3 (สามเส้นลบของ Notification).
 *
 * Pins under test:
 *   1. SSOT vocab: shared/notification-kind.js is the ONLY .js file in the
 *      backend that spells the OFFICIAL_LETTER literal (dup-source guard).
 *   2. Schema EXPAND: Notification.kind exists in PSL with GENERAL default;
 *      the migration is additive-only (BEGIN/COMMIT, IF NOT EXISTS, no
 *      destructive DDL outside the rollback comment).
 *   3. Deletion-path exceptions (D-9 "เก็บถาวร"):
 *      a. weekly cleanup (job-scheduler) must NOT delete official letters
 *         even when isRead && older than the 30-day window.
 *      b. PDPA erasure must KEEP the erased user's official letters while
 *         still deleting their other notifications.
 *      c. all-channels opt-out must NOT stop createOfficialLetter from
 *         writing the row (structural bypass of preferences).
 *   4. createOfficialLetter helper: writes through the caller's tx,
 *      stamps the official-letter kind, and NEVER swallows errors
 *      (a failing write must reject so the caller's tx fails — D-8 dep).
 *
 * The expected DB literals are pinned as raw strings in this file ON
 * PURPOSE: asserting through the SSOT import would be a tautology and a
 * silent vocab rename must break here first. Test files are excluded from
 * the dup-source/grep pins.
 */

const fs = require('fs');
const path = require('path');

// ── mocks ──────────────────────────────────────────────────────────────────

const mockScheduleCalls = [];
jest.mock('node-cron', () => ({
    schedule: (expr, fn) => {
        mockScheduleCalls.push({ expr, fn });
        return { stop: jest.fn(), start: jest.fn() };
    },
}));

jest.mock('../../services/prisma-database', () => {
    const user = {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
    };
    const application = { findMany: jest.fn(), update: jest.fn() };
    const certificate = { findMany: jest.fn(), update: jest.fn() };
    const entityMembership = { findMany: jest.fn() };
    const entity = { update: jest.fn() };
    const applicationDraft = { deleteMany: jest.fn() };
    const notification = {
        create: jest.fn(),
        createMany: jest.fn(),
        deleteMany: jest.fn(),
        findMany: jest.fn(),
    };
    const models = {
        user, application, certificate, entityMembership, entity,
        applicationDraft, notification,
        // Task 10 fix round 1: erasure also clears the document pre-check text in its tx.
        documentPrecheck: { updateMany: jest.fn(), findMany: jest.fn(async () => []) },
        documentPrecheckFlag: { updateMany: jest.fn(), create: jest.fn() },
    };
    return {
        prisma: {
            ...models,
            // pdpa executeErasure runs its deletes inside a $transaction —
            // hand the same mocked models back as the tx client.
            $transaction: jest.fn(async (cb) => cb(models)),
        },
    };
});

const mockLogger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
jest.mock('../../shared/logger', () => ({
    ...mockLogger,
    createLogger: jest.fn(() => mockLogger),
}));

jest.mock('../../middleware/audit-logger', () => ({
    auditLogger: { log: jest.fn().mockResolvedValue({}) },
    AuditCategory: { SECURITY: 'SECURITY' },
    AuditSeverity: { INFO: 'INFO', WARNING: 'WARNING' },
    ResourceType: { USER: 'USER' },
}));

jest.mock('../../services/notification-fanout-service', () => ({
    send: jest.fn().mockResolvedValue({ ok: true }),
}));

jest.mock('../../services/user-lookup-service', () => ({
    findUserByHealthIdSecurely: jest.fn(),
}));

jest.mock('../../services/tenant-context', () => ({
    getTenantContext: () => null,
    withoutTenantScope: (fn) => fn(),
}));

const { prisma } = require('../../services/prisma-database');
const jobScheduler = require('../../services/scheduler/job-scheduler');
const pdpaErasureService = require('../../services/pdpa-erasure-service');
const notificationService = require('../../services/notification-service');

// ── fixtures / helpers ─────────────────────────────────────────────────────

const BACKEND = path.join(__dirname, '..', '..');

// Pinned DB literals (see file header for why these are raw strings here).
const OFFICIAL = 'OFFICIAL_LETTER';
const GENERAL = 'GENERAL';

const USER_ID = 'user-abc';
const ORG_ID = 'org-1';
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Minimal evaluator for the Prisma `where` shapes used by the two delete
 * paths under test ({ scalar equality, { lt }, { not } }). Evaluating the
 * predicate against fixture rows pins BEHAVIOUR (which rows die), not just
 * the literal shape of the where object.
 */
function rowMatchesWhere(row, where) {
    return Object.entries(where).every(([field, cond]) => {
        if (cond !== null && typeof cond === 'object' && !(cond instanceof Date)) {
            return Object.entries(cond).every(([op, val]) => {
                if (op === 'lt') { return row[field] < val; }
                if (op === 'not') { return row[field] !== val; }
                throw new Error(`unsupported where operator in test matcher: ${op}`);
            });
        }
        return row[field] === cond;
    });
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
    prisma.user.findFirst.mockResolvedValue(null);
    prisma.user.findMany.mockResolvedValue([]);
    prisma.user.update.mockResolvedValue({ id: USER_ID, privacySettings: {} });
    prisma.application.findMany.mockResolvedValue([]);
    prisma.certificate.findMany.mockResolvedValue([]);
    prisma.entityMembership.findMany.mockResolvedValue([]);
    prisma.applicationDraft.deleteMany.mockResolvedValue({ count: 0 });
    prisma.notification.deleteMany.mockResolvedValue({ count: 0 });
    prisma.notification.create.mockImplementation(async ({ data }) => ({ id: 'notif-1', ...data }));
});

// ───────────────────────────────────────────────────────────────────────────
// 1. SSOT vocab
// ───────────────────────────────────────────────────────────────────────────

describe('SSOT vocab — shared/notification-kind.js', () => {
    const VOCAB_PATH = path.join(BACKEND, 'shared', 'notification-kind.js');

    it('exists and exports the frozen GENERAL/OFFICIAL_LETTER vocabulary', () => {
        expect(fs.existsSync(VOCAB_PATH)).toBe(true);
        const vocab = require(VOCAB_PATH);
        expect(vocab.NOTIFICATION_KIND).toEqual({ GENERAL, OFFICIAL_LETTER: OFFICIAL });
        expect(Object.isFrozen(vocab.NOTIFICATION_KIND)).toBe(true);
        expect(vocab.NOTIFICATION_KINDS).toEqual([GENERAL, OFFICIAL]);
        expect(Object.isFrozen(vocab.NOTIFICATION_KINDS)).toBe(true);
    });

    // PIN (Law 3.11): keeps the vocabulary single-sourced forever.
    // Spec (M1 deliverable 4): no OFFICIAL_LETTER literal outside the SSOT
    // file "+ จุด import" — the ONLY sanctioned spelling elsewhere is the
    // namespaced access `NOTIFICATION_KIND.OFFICIAL_LETTER` on the imported
    // constant. A quoted re-spell or a bare literal is a dup-source.
    it('no backend .js file outside the SSOT file re-spells the official-letter literal', () => {
        const allowed = new Set([VOCAB_PATH]);
        const respell = /(?<!NOTIFICATION_KIND\.)OFFICIAL_LETTER/;
        const offenders = walkJsFiles(BACKEND)
            .filter((f) => !allowed.has(f))
            .filter((f) => respell.test(fs.readFileSync(f, 'utf8')))
            .map((f) => path.relative(BACKEND, f));
        expect(offenders).toEqual([]);
    });
});

// ───────────────────────────────────────────────────────────────────────────
// 2. Schema EXPAND + migration
// ───────────────────────────────────────────────────────────────────────────

describe('schema EXPAND — Notification.kind', () => {
    const MIGRATIONS_DIR = path.join(BACKEND, 'prisma', 'migrations');

    it('PSL declares kind String @default("GENERAL") on the Notification model', () => {
        const psl = fs.readFileSync(
            path.join(BACKEND, 'prisma', 'schema', 'system.prisma'), 'utf8',
        );
        const notificationBlock = psl.slice(
            psl.indexOf('model Notification {'),
            psl.indexOf('@@map("notifications")'),
        );
        expect(notificationBlock).toMatch(/kind\s+String\s+@default\("GENERAL"\)/);
    });

    it('exactly one add_notification_kind migration exists and is EXPAND-only', () => {
        const dirs = fs.existsSync(MIGRATIONS_DIR)
            ? fs.readdirSync(MIGRATIONS_DIR).filter((d) => /^20260803\d{6}_add_notification_kind$/.test(d))
            : [];
        expect(dirs).toHaveLength(1);

        const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, dirs[0], 'migration.sql'), 'utf8');
        // EXPAND idiom (wave1_checkout_engine_expand): tx-wrapped, idempotent.
        expect(sql).toMatch(/^BEGIN;$/m);
        expect(sql).toMatch(/^COMMIT;$/m);
        expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS "kind" TEXT NOT NULL DEFAULT 'GENERAL'/);
        // Rollback recipe must be present — as a comment, not live DDL.
        expect(sql).toMatch(/^--\s+Rollback \(manual\):/m);

        // Additive-only: no destructive DDL outside comment lines.
        const active = sql
            .split('\n')
            .filter((line) => !line.trim().startsWith('--'))
            .join('\n');
        expect(active).not.toMatch(/DROP\s+(TABLE|COLUMN|INDEX)/i);
        expect(active).not.toMatch(/ALTER\s+COLUMN/i);
        expect(active).not.toMatch(/\b(DELETE\s+FROM|TRUNCATE|UPDATE)\b/i);
    });
});

// ───────────────────────────────────────────────────────────────────────────
// 3a. Weekly cleanup exception
// ───────────────────────────────────────────────────────────────────────────

describe('weekly cleanup (job-scheduler) — D-9 exception', () => {
    async function runCleanupSweep() {
        mockScheduleCalls.length = 0;
        jobScheduler.start();
        const cleanup = mockScheduleCalls.find((c) => c.expr === '0 2 * * 0');
        expect(cleanup).toBeDefined();
        await cleanup.fn();
        jobScheduler.stop();
        expect(prisma.notification.deleteMany).toHaveBeenCalledTimes(1);
        return prisma.notification.deleteMany.mock.calls[0][0].where;
    }

    it('does NOT delete an official letter even when isRead and older than 30 days', async () => {
        const where = await runCleanupSweep();
        const oldReadLetter = {
            kind: OFFICIAL,
            isRead: true,
            createdAt: new Date(Date.now() - 40 * DAY_MS),
            userId: USER_ID,
        };
        expect(rowMatchesWhere(oldReadLetter, where)).toBe(false);
    });

    it('still deletes old read GENERAL notifications (existing behaviour preserved)', async () => {
        const where = await runCleanupSweep();
        const oldReadGeneral = {
            kind: GENERAL,
            isRead: true,
            createdAt: new Date(Date.now() - 40 * DAY_MS),
            userId: USER_ID,
        };
        const freshUnreadGeneral = {
            kind: GENERAL,
            isRead: false,
            createdAt: new Date(),
            userId: USER_ID,
        };
        expect(rowMatchesWhere(oldReadGeneral, where)).toBe(true);
        expect(rowMatchesWhere(freshUnreadGeneral, where)).toBe(false);
    });
});

// ───────────────────────────────────────────────────────────────────────────
// 3b. PDPA erasure exception
// ───────────────────────────────────────────────────────────────────────────

describe('PDPA erasure — D-9 exception', () => {
    beforeEach(() => {
        prisma.user.findUnique.mockResolvedValue({
            canonicalId: 'canonical-12345',
            organizationId: ORG_ID,
            legalHold: false,
        });
    });

    async function runErasureAndGetWhere() {
        await pdpaErasureService.executeErasure({ userId: USER_ID, actorId: USER_ID });
        expect(prisma.notification.deleteMany).toHaveBeenCalledTimes(1);
        return prisma.notification.deleteMany.mock.calls[0][0].where;
    }

    it('keeps the erased user\'s official letters', async () => {
        const where = await runErasureAndGetWhere();
        const usersLetter = { userId: USER_ID, kind: OFFICIAL, isRead: true };
        expect(rowMatchesWhere(usersLetter, where)).toBe(false);
    });

    it('still deletes the erased user\'s other notifications, scoped to that user', async () => {
        const where = await runErasureAndGetWhere();
        const usersGeneral = { userId: USER_ID, kind: GENERAL, isRead: false };
        const otherUsersGeneral = { userId: 'someone-else', kind: GENERAL, isRead: false };
        expect(rowMatchesWhere(usersGeneral, where)).toBe(true);
        expect(rowMatchesWhere(otherUsersGeneral, where)).toBe(false);
    });
});

// ───────────────────────────────────────────────────────────────────────────
// 3c + 4. Opt-out exception + createOfficialLetter helper
// ───────────────────────────────────────────────────────────────────────────

describe('createOfficialLetter — mandatory in-app letter (D-9) + tx contract (D-8 dep)', () => {
    function makeTx() {
        return {
            notification: {
                create: jest.fn(async ({ data }) => ({ id: 'letter-1', ...data })),
            },
        };
    }

    const LETTER_ARGS = Object.freeze({
        userId: USER_ID,
        title: 'ผลการพิจารณา',
        message: 'คำขอของท่านไม่ผ่านการพิจารณา',
        metadata: { applicationId: 'app-1' },
        organizationId: ORG_ID,
    });

    it('negative control (pin, green-at-birth): all-off prefs suppress the normal in-app row', async () => {
        prisma.user.findUnique.mockResolvedValue({
            notificationSettings: {
                channels: { APPLICATION_REJECTED: { email: false, inApp: false, sms: false } },
            },
        });
        const result = await notificationService.sendNotification(
            USER_ID, 'APPLICATION_REJECTED', { applicationNumber: 'GACP-1' },
        );
        expect(result).toBeNull();
        expect(prisma.notification.create).not.toHaveBeenCalled();
    });

    it('writes the letter row even when every preference is off', async () => {
        expect(typeof notificationService.createOfficialLetter).toBe('function');
        // Same all-off settings that the negative control PROVES suppress the
        // normal path — the letter path must not even look at them.
        prisma.user.findUnique.mockResolvedValue({
            notificationSettings: {
                channels: { APPLICATION_REJECTED: { email: false, inApp: false, sms: false } },
            },
        });
        const tx = makeTx();
        const letter = await notificationService.createOfficialLetter({ tx, ...LETTER_ARGS });
        expect(tx.notification.create).toHaveBeenCalledTimes(1);
        expect(letter).toMatchObject({
            userId: USER_ID,
            kind: OFFICIAL,
            organizationId: ORG_ID,
            title: LETTER_ARGS.title,
            message: LETTER_ARGS.message,
            metadata: LETTER_ARGS.metadata,
        });
    });

    it('writes THROUGH the caller\'s tx — never the global prisma client', async () => {
        expect(typeof notificationService.createOfficialLetter).toBe('function');
        const tx = makeTx();
        await notificationService.createOfficialLetter({ tx, ...LETTER_ARGS });
        expect(tx.notification.create).toHaveBeenCalledTimes(1);
        expect(prisma.notification.create).not.toHaveBeenCalled();
    });

    it('stamps kind=OFFICIAL_LETTER on the created row', async () => {
        expect(typeof notificationService.createOfficialLetter).toBe('function');
        const tx = makeTx();
        await notificationService.createOfficialLetter({ tx, ...LETTER_ARGS });
        expect(tx.notification.create.mock.calls[0][0].data.kind).toBe(OFFICIAL);
    });

    it('does not swallow write errors — a failing letter rejects so the caller\'s tx fails', async () => {
        expect(typeof notificationService.createOfficialLetter).toBe('function');
        const tx = makeTx();
        tx.notification.create.mockRejectedValue(new Error('db down'));
        await expect(
            notificationService.createOfficialLetter({ tx, ...LETTER_ARGS }),
        ).rejects.toThrow('db down');
    });

    it('rejects when called without a tx (atomicity is not optional)', async () => {
        expect(typeof notificationService.createOfficialLetter).toBe('function');
        await expect(
            notificationService.createOfficialLetter({ ...LETTER_ARGS }),
        ).rejects.toThrow(/tx/i);
        expect(prisma.notification.create).not.toHaveBeenCalled();
    });
});
