'use strict';

/**
 * R2 M3b — TERMINAL_DECISION letter (operator decision 2026-08-03, verbatim in
 * evidence/R2-special-reopen/decisions-final.md §"คำตัดสินเพิ่ม 2026-08-03 —
 * TERMINAL_DECISION letter"; plan line M3b).
 *
 * "REJECT terminal ต้องมีจดหมาย" — a SEPARATE template from the M2 correction
 * letter, with its own four mandatory elements:
 *
 *   1. ผลการพิจารณา (ไม่ผ่าน / ไม่รับรอง) + stage ที่ตัดสิน
 *   2. เหตุผลประกอบ (จากบันทึกผลของเจ้าหน้าที่ — field บังคับ ไม่ใช่ optional)
 *   3. สิทธิ์ของผู้ยื่น: ยื่นคำขอใหม่ได้ (flow ปกติ จ่ายใหม่ตาม D-1)
 *   4. ข้อความสิทธิ์โต้แย้ง/อุทธรณ์คำสั่งทางปกครอง — placeholder verbatim:
 *      "ทั้งนี้ ท่านมีสิทธิ์โต้แย้งคำสั่งตามที่กฎหมายกำหนด สอบถามรายละเอียดได้ที่
 *       <ช่องทางติดต่อกรม>"
 *
 * Plus the three negative constraints of the same ruling:
 *   - ไม่มีกำหนดส่ง — a terminal case has no deadline for anyone, so the
 *     template neither requires nor prints one.
 *   - Atomic (D-8): ออกจดหมายไม่ได้ = REJECT ไม่สำเร็จ — the mint runs in the
 *     SAME transaction client as the status write.
 *   - ไม่มี round — terminal is not a correction round, so NO CorrectionRound
 *     row may be written on any REJECT path.
 *
 * The letter rides the M1 official-letter kind (permanent archive, exempt from
 * all three deletion paths). The `legalHold` column is D-5 in กลไก 2 and is
 * deliberately NOT part of this test.
 *
 * The bare 'TERMINAL_DECISION' / kind literals below are pinned as raw strings
 * on purpose (same rationale as official-letter.test.js — test files are
 * excluded from the dup-source grep pins; asserting through the SSOT import
 * would be a tautology).
 */

const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');

// ── fixtures ───────────────────────────────────────────────────────────────

const OFFICIAL = 'OFFICIAL_LETTER';
const TERMINAL = 'TERMINAL_DECISION';
const FARMER = { id: 'farmer-1', organizationId: 'org-farm' };

/**
 * Element 4, verbatim from decisions-final.md line 49. The angle-bracket
 * placeholder is replaced by the department contact read from the existing
 * config SSOT — the FIXED prefix below is what may never drift.
 */
const APPEAL_PREFIX = 'ทั้งนี้ ท่านมีสิทธิ์โต้แย้งคำสั่งตามที่กฎหมายกำหนด สอบถามรายละเอียดได้ที่ ';

let mockCurrentUser = null;

// ── shared infra mocks ─────────────────────────────────────────────────────

const mockLogger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
jest.mock('../../shared/logger', () => ({
    ...mockLogger,
    createLogger: jest.fn(() => mockLogger),
}));

// notification-service is REAL (the letter must go through the M1 helper) —
// stub its heavy load chain exactly like atomic-decision-letter.test.js.
jest.mock('../../services/tenant-context', () => ({
    getTenantContext: () => null,
    withoutTenantScope: (fn) => fn(),
}));
jest.mock('../../services/notification-fanout-service', () => ({
    send: jest.fn().mockResolvedValue({ ok: true }),
}));

const mockFindUserByHealthIdSecurely = jest.fn();
jest.mock('../../services/user-lookup-service', () => ({
    findUserByHealthIdSecurely: (...a) => mockFindUserByHealthIdSecurely(...a),
    findUserByProviderIdSecurely: jest.fn(),
    resolveUserIdFromHealthIdSecurely: jest.fn().mockResolvedValue('farmer-1'),
}));

// The inspector's PASS asks the onsite-evidence gate before the write (Batch A item 2);
// the gate has its own suites (onsite-evidence-gate, approver-sees-the-file-pass-doors).
jest.mock('../../services/onsite-evidence-gate', () => ({
    assertOnsiteEvidenceSufficient: jest.fn().mockResolvedValue({}),
    assertOnsiteEvidenceForPass: jest.fn().mockResolvedValue({}),
}));

jest.mock('../../services/application-status-writer', () => ({
    writeApplicationStatus: jest.fn(async () => ({})),
}));
const { writeApplicationStatus } = require('../../services/application-status-writer');

jest.mock('../../middleware/audit-logger', () => ({
    auditLogger: { log: jest.fn().mockResolvedValue({}), logWithin: jest.fn() },
    AuditCategory: { APPLICATION: 'APPLICATION' },
    AuditSeverity: { INFO: 'INFO', WARNING: 'WARNING' },
    ResourceType: { APPLICATION: 'APPLICATION' },
    statusTransitionAuditHook: jest.fn(() => jest.fn().mockResolvedValue({})),
}));

jest.mock('../../utils/field-encryption', () => ({ maskThaiId: (x) => x || null }));

/**
 * A transaction client that records both the letter write and any (forbidden)
 * correction-round write, so "no round on a terminal decision" is provable.
 */
function makeLetterTx() {
    return {
        notification: {
            create: jest.fn(async ({ data }) => ({ id: 'letter-1', ...data })),
        },
        correctionRound: {
            count: jest.fn(async () => 0),
            create: jest.fn(async ({ data }) => ({ id: 'round-1', ...data })),
        },
    };
}

// ── surface 1: canonical workflow-transitions handler ──────────────────────

const canonicalTx = makeLetterTx();
const mockCanonicalTransaction = jest.fn(async (cb) => cb(canonicalTx));
const mockBuildTransitionUpdate = jest.fn();
const mockFindFirstWithWhere = jest.fn();
const mockGetById = jest.fn();

jest.mock('../../routes/api/provider/handlers/workflow-handler-deps', () => ({
    prisma: { $transaction: (...a) => mockCanonicalTransaction(...a) },
    authenticateProvider: (req, _res, next) => { req.user = mockCurrentUser; next(); },
    requireCanonicalPermission: () => (_req, _res, next) => next(),
    logger: mockLogger,
    PERMISSIONS: { APPLICATION_WORKFLOW_TRANSITION: 'perm' },
    obj: (x) => (x && typeof x === 'object' && !Array.isArray(x) ? x : {}),
    arr: (x) => (Array.isArray(x) ? x : []),
    workflowTransitionService: {
        normalizeWorkflowStateInput: (s) => (s ? String(s).toUpperCase() : null),
        resolveStateFromApplication: (app) => app.status,
        buildTransitionUpdate: (...a) => mockBuildTransitionUpdate(...a),
    },
    getRequestIp: () => '127.0.0.1',
    auditLogger: { log: jest.fn().mockResolvedValue({}) },
    AuditCategory: { APPLICATION: 'APPLICATION' },
    AuditSeverity: { INFO: 'INFO', WARNING: 'WARNING' },
    ResourceType: { APPLICATION: 'APPLICATION' },
    resolveUserIdFromHealthId: jest.fn().mockResolvedValue('farmer-1'),
    getRevisionDueAt: () => null,
    REVISION_SLA_DAYS: 5,
    addWorkingDays: (...a) => jest.requireActual('../../utils/working-days').addWorkingDays(...a),
    ensureCertificateIssuedForApplication: jest.fn().mockResolvedValue(null),
}));

jest.mock('../../services/certificate-service', () => ({
    revokeCertificateForApplication: jest.fn().mockResolvedValue(null),
}));
jest.mock('../../shared/application-visibility', () => ({
    withVisibility: (where) => where,
}));
jest.mock('../../services/application-service', () => ({
    findFirstWithWhere: (...a) => mockFindFirstWithWhere(...a),
    getById: (...a) => mockGetById(...a),
    isApplicationCommentModelAvailable: () => false,
    createApplicationCommentIfAvailable: jest.fn().mockResolvedValue(null),
}));

const mockFindApplicationStatusOverrideSlice = jest.fn();
jest.mock('../../services/admin-application-service', () => ({
    bulkUpdateRevisionDeadlineStatus: jest.fn().mockResolvedValue(null),
    findRevisionDeadlineByApplicationId: jest.fn().mockResolvedValue(null),
    upsertRevisionDeadline: jest.fn().mockResolvedValue(null),
    findApplicationStatusOverrideSlice: (...a) => mockFindApplicationStatusOverrideSlice(...a),
    listPendingRevisionDeadlines: jest.fn().mockResolvedValue([]),
}));

const mockSideEffects = {
    handleRevisionDeadlines: jest.fn().mockResolvedValue(null),
    handleCertificateIssuance: jest.fn().mockResolvedValue(null),
    sendTransitionNotifications: jest.fn().mockResolvedValue(null),
    logTransitionAudit: jest.fn().mockResolvedValue(null),
};
jest.mock('../../routes/api/provider/handlers/workflow-side-effects', () => mockSideEffects);

// ── surface 2: auditor audit-decision handler ──────────────────────────────

const auditorTx = makeLetterTx();
const mockAuditorTransaction = jest.fn(async (cb) => cb(auditorTx));
const mockFindAuditDecisionApplication = jest.fn();

jest.mock('../../routes/api/provider/handlers/auditor-handler-deps', () => ({
    authenticateProvider: (req, _res, next) => { req.user = mockCurrentUser; next(); },
    requireCanonicalPermission: () => (_req, _res, next) => next(),
    PERMISSIONS: { APPLICATION_AUDIT_RECORD: 'perm' },
    logger: mockLogger,
    obj: (x) => (x && typeof x === 'object' && !Array.isArray(x) ? x : {}),
    arr: (x) => (Array.isArray(x) ? x : []),
    prisma: { $transaction: (...a) => mockAuditorTransaction(...a) },
    workflowTransitionService: { resolveStateFromApplication: () => 'AUDIT_CONFIRMED' },
    getRequestIp: () => '127.0.0.1',
    auditLogger: { log: jest.fn().mockResolvedValue({}) },
    AuditCategory: { APPLICATION: 'APPLICATION' },
    AuditSeverity: { INFO: 'INFO', WARNING: 'WARNING' },
    ResourceType: { APPLICATION: 'APPLICATION' },
    resolveUserIdFromHealthId: jest.fn().mockResolvedValue('farmer-1'),
    applicationService: {
        findAuditDecisionApplication: (...a) => mockFindAuditDecisionApplication(...a),
        findAuditDecisionPostWriteSlice: jest.fn().mockResolvedValue({ id: 'app-1', applicationNumber: 'GACP-001', status: 'REJECTED' }),
    },
}));

jest.mock('../../services/car-deadline-service', () => ({
    computeCarDueDate: jest.fn(() => new Date('2026-08-11T09:59:59.000Z')),
    seedCarRevisionDeadline: jest.fn().mockResolvedValue(null),
}));

// ── surface 3: legacy admin status-override ────────────────────────────────

const adminTx = makeLetterTx();
const mockAdminTransaction = jest.fn(async (cb) => cb(adminTx));

jest.mock('../../services/prisma-database', () => ({
    prisma: {
        application: { findFirst: jest.fn(), findUnique: jest.fn() },
        user: { findFirst: jest.fn(async () => ({ id: 'farmer-1', organizationId: 'org-farm' })) },
        notification: { create: jest.fn(async ({ data }) => ({ id: 'n-1', ...data })), findMany: jest.fn(async () => []) },
        $transaction: (...a) => mockAdminTransaction(...a),
    },
}));

jest.mock('../../middleware/auth-middleware', () => ({
    authenticateAny: (req, _res, next) => { req.user = mockCurrentUser; next(); },
    authenticateProvider: (req, _res, next) => { req.user = mockCurrentUser; next(); },
    authenticateDTAM: (req, _res, next) => { req.user = mockCurrentUser; next(); },
    requireRole: () => (_req, _res, next) => next(),
}));

jest.mock('../../services/assignment-ledger-service', () => ({ recordAssignment: jest.fn() }));
jest.mock('../../services/provider-user-service', () => ({}));
jest.mock('../../utils/client-ip', () => ({ getRequestIp: () => '127.0.0.1' }));

// ── routers under test ─────────────────────────────────────────────────────

const { applicationsWorkflowTransitions } = require('../../routes/api/provider/handlers/workflow-transitions-handler');
const { auditorAuditDecisions } = require('../../routes/api/provider/handlers/auditor-audit-decision-handler');
const { adminStatusOverride } = require('../../routes/api/provider/handlers/admin');

function buildCanonicalApp() {
    const app = express();
    app.use(express.json());
    app.post('/apps/:id/workflow-transitions', ...applicationsWorkflowTransitions);
    return app;
}
function buildAuditorApp() {
    const app = express();
    app.use(express.json());
    app.post('/auditor/applications/:id/audit-decisions', ...auditorAuditDecisions);
    return app;
}
function buildAdminApp() {
    const app = express();
    app.use(express.json());
    app.post('/admin/status-override', ...adminStatusOverride);
    return app;
}

// ── helpers ────────────────────────────────────────────────────────────────

/** The single letter row written through the given tx (asserts exactly one). */
function letterWrittenThrough(tx) {
    expect(tx.notification.create).toHaveBeenCalledTimes(1);
    return tx.notification.create.mock.calls[0][0].data;
}

/**
 * Assert the four mandatory elements of the terminal letter + the three
 * negative constraints (no deadline, no round, permanent-archive kind).
 */
function assertTerminalElements(letter, { stageLabel, reason }) {
    // 1. ผลการพิจารณา + stage ที่ตัดสิน
    expect(letter.message).toContain('ไม่ผ่านการพิจารณา');
    expect(letter.message).toContain('ไม่รับรอง');
    expect(letter.message).toContain(stageLabel);
    // 2. เหตุผลประกอบ (บังคับ)
    expect(letter.message).toContain(reason);
    expect(letter.metadata.reason).toBe(reason);
    // 3. สิทธิ์ยื่นคำขอใหม่ (D-1: flow ปกติ จ่ายใหม่)
    expect(letter.message).toContain('ยื่นคำขอรับรองใหม่');
    expect(letter.message).toContain('ค่าธรรมเนียม');
    // 4. สิทธิ์โต้แย้ง — verbatim placeholder sentence
    expect(letter.message).toContain(APPEAL_PREFIX);
    // NO deadline anywhere (terminal has no clock)
    expect(letter.message).not.toContain('กำหนดส่ง');
    expect(letter.message).not.toMatch(/ภายในวันที่/);
    expect(letter.metadata.dueAt).toBeUndefined();
    // Letter class + archive discipline (M1)
    expect(letter.metadata.letterType).toBe(TERMINAL);
    expect(letter.kind).toBe(OFFICIAL);
    expect(letter.userId).toBe(FARMER.id);
    expect(letter.organizationId).toBe(FARMER.organizationId);
}

beforeEach(() => {
    jest.clearAllMocks();
    mockCurrentUser = null;
    mockFindUserByHealthIdSecurely.mockResolvedValue({ ...FARMER });
    writeApplicationStatus.mockResolvedValue({});
    mockCanonicalTransaction.mockImplementation(async (cb) => cb(canonicalTx));
    mockAuditorTransaction.mockImplementation(async (cb) => cb(auditorTx));
    mockAdminTransaction.mockImplementation(async (cb) => cb(adminTx));
    for (const tx of [canonicalTx, auditorTx, adminTx]) {
        tx.notification.create.mockImplementation(async ({ data }) => ({ id: 'letter-1', ...data }));
        tx.correctionRound.count.mockResolvedValue(0);
        tx.correctionRound.create.mockImplementation(async ({ data }) => ({ id: 'round-1', ...data }));
    }
    mockGetById.mockResolvedValue({ id: 'app-1', applicationNumber: 'GACP-001', status: 'REJECTED', formData: {}, updatedAt: new Date(), updatedBy: 'aud-1' });
});

// ───────────────────────────────────────────────────────────────────────────
// 1. Template — shared/terminal-letter-template.js
// ───────────────────────────────────────────────────────────────────────────

describe('buildTerminalDecisionLetter — four mandatory elements', () => {
    const load = () => require('../../shared/terminal-letter-template');

    test('emits ผลการพิจารณา + stage + เหตุผล + สิทธิ์ยื่นใหม่ + สิทธิ์โต้แย้ง', () => {
        const { buildTerminalDecisionLetter } = load();
        const letter = buildTerminalDecisionLetter({
            applicationNumber: 'GACP-001',
            stage: 'AUDIT_CONFIRMED',
            reason: 'พบข้อบกพร่องร้ายแรงที่ไม่สามารถแก้ไขได้',
        });
        expect(letter.title).toContain('GACP-001');
        expect(letter.message).toContain('ไม่ผ่านการพิจารณา');
        expect(letter.message).toContain('ไม่รับรอง');
        // stage label comes from the canonical status SSOT, never re-spelled
        const { STATUS_PRESENTATION } = require('../../shared/status-machine-contract');
        expect(letter.message).toContain(STATUS_PRESENTATION.AUDIT_CONFIRMED.label);
        expect(letter.message).toContain('พบข้อบกพร่องร้ายแรงที่ไม่สามารถแก้ไขได้');
        expect(letter.message).toContain('ยื่นคำขอรับรองใหม่');
        expect(letter.message).toContain(APPEAL_PREFIX);
        expect(letter.metadata).toMatchObject({
            applicationNumber: 'GACP-001',
            stage: 'AUDIT_CONFIRMED',
            letterType: TERMINAL,
            reason: 'พบข้อบกพร่องร้ายแรงที่ไม่สามารถแก้ไขได้',
        });
    });

    test('reason is a MANDATORY field — missing / empty / whitespace all THROW', () => {
        const { buildTerminalDecisionLetter } = load();
        for (const reason of [undefined, null, '', '   ', '\n\t']) {
            expect(() => buildTerminalDecisionLetter({
                applicationNumber: 'GACP-001',
                stage: 'AUDIT_CONFIRMED',
                reason,
            })).toThrow(/reason/i);
        }
    });

    test('an unknown or missing stage THROWS (element 1 impossible)', () => {
        const { buildTerminalDecisionLetter } = load();
        for (const stage of [undefined, null, '', 'NOT_A_STATE']) {
            expect(() => buildTerminalDecisionLetter({
                applicationNumber: 'GACP-001',
                stage,
                reason: 'เหตุผล',
            })).toThrow(/stage/i);
        }
    });

    test('NO deadline: no dueAt in metadata, no กำหนดส่ง wording, and a dueAt argument is ignored', () => {
        const { buildTerminalDecisionLetter } = load();
        const letter = buildTerminalDecisionLetter({
            applicationNumber: 'GACP-001',
            stage: 'AUDIT_CONFIRMED',
            reason: 'เหตุผลของเจ้าหน้าที่',
            dueAt: new Date('2026-08-11T09:59:59.000Z'),
        });
        expect(letter.metadata.dueAt).toBeUndefined();
        expect(letter.message).not.toContain('กำหนดส่ง');
        expect(letter.message).not.toMatch(/ภายในวันที่/);
        expect(letter.message).not.toMatch(/2569/);
    });

    test('appeal placeholder is verbatim and invents NO appeal window or channel', () => {
        const { buildTerminalDecisionLetter } = load();
        const letter = buildTerminalDecisionLetter({
            applicationNumber: 'GACP-001',
            stage: 'AUDIT_CONFIRMED',
            reason: 'เหตุผลของเจ้าหน้าที่',
        });
        expect(letter.message).toContain(APPEAL_PREFIX);
        // ห้าม fabricate เลขวัน/ช่องทางอุทธรณ์: no "อุทธรณ์ภายใน N วัน" anywhere.
        expect(letter.message).not.toMatch(/อุทธรณ์ภายใน/);
        expect(letter.message).not.toMatch(/ภายใน\s*\d+\s*วัน/);
    });

    test('the <ช่องทางติดต่อกรม> value comes from the existing contact SSOT, not a fresh literal', () => {
        const { buildTerminalDecisionLetter } = load();
        const { MINISTRY_CONTACT } = require('../../shared/ministry-contact');
        const letter = buildTerminalDecisionLetter({
            applicationNumber: 'GACP-001',
            stage: 'AUDIT_CONFIRMED',
            reason: 'เหตุผลของเจ้าหน้าที่',
        });
        expect(letter.message).toContain(MINISTRY_CONTACT.ministry);
        // and the template file itself must not re-spell a phone/email/URL
        const src = fs.readFileSync(
            path.join(__dirname, '..', '..', 'shared', 'terminal-letter-template.js'), 'utf8',
        );
        expect(src).not.toMatch(/\d[\d-]{6,}/);
        expect(src).not.toMatch(/@[a-z0-9.-]+\.[a-z]{2,}/i);
        expect(src).not.toMatch(/https?:\/\//);
    });
});

// ───────────────────────────────────────────────────────────────────────────
// 2. Mint point — services/decision-letter-service.js (extended, not duplicated)
// ───────────────────────────────────────────────────────────────────────────

describe('mintTerminalDecisionLetter — D-8 atomic, no round', () => {
    const load = () => require('../../services/decision-letter-service');

    test('writes ONE letter through the caller tx and NEVER a CorrectionRound row', async () => {
        const { mintTerminalDecisionLetter } = load();
        const tx = makeLetterTx();
        await mintTerminalDecisionLetter({
            tx,
            healthId: 'h-1',
            applicationId: 'app-1',
            applicationNumber: 'GACP-001',
            stage: 'AUDIT_CONFIRMED',
            reason: 'ไม่เป็นไปตามข้อกำหนดหลัก',
        });
        const letter = letterWrittenThrough(tx);
        expect(letter.metadata).toMatchObject({ applicationId: 'app-1', letterType: TERMINAL });
        expect(tx.correctionRound.create).not.toHaveBeenCalled();
        expect(tx.correctionRound.count).not.toHaveBeenCalled();
    });

    test('an empty reason REJECTS before any row is written (D-8: no letter, no transition)', async () => {
        const { mintTerminalDecisionLetter } = load();
        const tx = makeLetterTx();
        await expect(mintTerminalDecisionLetter({
            tx,
            healthId: 'h-1',
            applicationId: 'app-1',
            applicationNumber: 'GACP-001',
            stage: 'AUDIT_CONFIRMED',
            reason: '   ',
        })).rejects.toThrow(/reason/i);
        expect(tx.notification.create).not.toHaveBeenCalled();
    });

    test('an unresolvable recipient REJECTS (no letter, no transition)', async () => {
        const { mintTerminalDecisionLetter } = load();
        mockFindUserByHealthIdSecurely.mockResolvedValue(null);
        const tx = makeLetterTx();
        await expect(mintTerminalDecisionLetter({
            tx,
            healthId: 'h-1',
            applicationId: 'app-1',
            applicationNumber: 'GACP-001',
            stage: 'AUDIT_CONFIRMED',
            reason: 'ไม่เป็นไปตามข้อกำหนดหลัก',
        })).rejects.toThrow(/recipient/i);
        expect(tx.notification.create).not.toHaveBeenCalled();
    });
});

// ───────────────────────────────────────────────────────────────────────────
// 3. Surface — auditor audit-decision REJECT (AUDIT_CONFIRMED → REJECTED)
// ───────────────────────────────────────────────────────────────────────────

describe('auditor audit-decision REJECT — terminal letter atomic with the decision', () => {
    beforeEach(() => {
        mockCurrentUser = { id: 'auditor-1', role: 'auditor', canonicalRole: 'auditor', organizationId: 'org-1' };
        mockFindAuditDecisionApplication.mockResolvedValue({
            id: 'app-1',
            applicationNumber: 'GACP-001',
            auditorId: 'auditor-1',
            healthId: 'h-1',
            status: 'AUDIT_CONFIRMED',
            formData: {},
            workflowHistory: [],
        });
    });

    test('REJECT mints the TERMINAL_DECISION letter through the SAME tx as the status write', async () => {
        const { STATUS_PRESENTATION } = require('../../shared/status-machine-contract');
        const res = await request(buildAuditorApp())
            .post('/auditor/applications/app-1/audit-decisions')
            .send({ decision: 'REJECT', notes: 'ไม่ผ่านเกณฑ์การควบคุมสารเคมีอย่างร้ายแรง' });

        expect(res.status).toBe(200);
        expect(writeApplicationStatus).toHaveBeenCalledWith(expect.objectContaining({
            prisma: auditorTx,
            toStatus: 'REJECTED',
        }));
        const letter = letterWrittenThrough(auditorTx);
        assertTerminalElements(letter, {
            stageLabel: STATUS_PRESENTATION.AUDIT_CONFIRMED.label,
            reason: 'ไม่ผ่านเกณฑ์การควบคุมสารเคมีอย่างร้ายแรง',
        });
        expect(letter.metadata.applicationId).toBe('app-1');
    });

    test('ไม่มี round — a terminal REJECT writes NO CorrectionRound row', async () => {
        const res = await request(buildAuditorApp())
            .post('/auditor/applications/app-1/audit-decisions')
            .send({ decision: 'REJECT', notes: 'ไม่ผ่านเกณฑ์การควบคุมสารเคมีอย่างร้ายแรง' });

        expect(res.status).toBe(200);
        expect(auditorTx.correctionRound.create).not.toHaveBeenCalled();
    });

    test('ATOMIC: a failing letter write fails the whole decision (500, tx rejected)', async () => {
        auditorTx.notification.create.mockRejectedValue(new Error('letter write refused'));

        const res = await request(buildAuditorApp())
            .post('/auditor/applications/app-1/audit-decisions')
            .send({ decision: 'REJECT', notes: 'ไม่ผ่านเกณฑ์การควบคุมสารเคมีอย่างร้ายแรง' });

        expect(res.status).toBe(500);
        await expect(mockAuditorTransaction.mock.results[0].value).rejects.toThrow('letter write refused');
        expect(writeApplicationStatus).toHaveBeenCalledWith(expect.objectContaining({ prisma: auditorTx }));
    });

    test('PASS mints NO terminal letter (negative control)', async () => {
        const res = await request(buildAuditorApp())
            .post('/auditor/applications/app-1/audit-decisions')
            .send({ decision: 'PASS' });

        expect(res.status).toBe(200);
        expect(auditorTx.notification.create).not.toHaveBeenCalled();
    });
});

// ───────────────────────────────────────────────────────────────────────────
// 4. Surface — canonical workflow-transitions → REJECTED
// ───────────────────────────────────────────────────────────────────────────

describe('canonical workflow-transitions → REJECTED — terminal letter atomic (D-8)', () => {
    function seedCanonical(status) {
        mockFindFirstWithWhere.mockResolvedValue({
            id: 'app-1',
            applicationNumber: 'GACP-001',
            healthId: 'h-1',
            status,
            formData: {},
            workflowHistory: [],
            reviewerId: null,
            auditorId: null,
        });
    }
    function seedRejectTransition(previousState) {
        mockBuildTransitionUpdate.mockReturnValue({
            previousState,
            nextState: 'REJECTED',
            nextLegacyStatus: 'REJECTED',
            updateData: { status: 'REJECTED', formData: {}, workflowHistory: [] },
            transitionEvent: { metadata: {} },
        });
    }

    test('AUDIT_CONFIRMED → REJECTED mints the letter in the same tx as the status write', async () => {
        const { STATUS_PRESENTATION } = require('../../shared/status-machine-contract');
        mockCurrentUser = { id: 'aud-1', role: 'auditor', canonicalRole: 'auditor', organizationId: 'org-1' };
        seedCanonical('AUDIT_CONFIRMED');
        seedRejectTransition('AUDIT_CONFIRMED');

        const res = await request(buildCanonicalApp())
            .post('/apps/app-1/workflow-transitions')
            .send({ toState: 'REJECTED', comment: 'ผลการตรวจประเมินไม่ผ่านเกณฑ์ขั้นต่ำ' });

        expect(res.status).toBe(200);
        const writerArgs = writeApplicationStatus.mock.calls[0][0];
        expect(writerArgs.prisma).toBe(canonicalTx);
        const letter = letterWrittenThrough(canonicalTx);
        assertTerminalElements(letter, {
            stageLabel: STATUS_PRESENTATION.AUDIT_CONFIRMED.label,
            reason: 'ผลการตรวจประเมินไม่ผ่านเกณฑ์ขั้นต่ำ',
        });
        expect(canonicalTx.correctionRound.create).not.toHaveBeenCalled();
    });

    test('a force reject off a cert-live state (AUDIT_PASSED → REJECTED) still mints its letter', async () => {
        const { STATUS_PRESENTATION } = require('../../shared/status-machine-contract');
        mockCurrentUser = { id: 'admin-1', role: 'admin', canonicalRole: 'admin', organizationId: 'org-1' };
        seedCanonical('AUDIT_PASSED');
        seedRejectTransition('AUDIT_PASSED');

        const res = await request(buildCanonicalApp())
            .post('/apps/app-1/workflow-transitions')
            .send({ toState: 'REJECTED', force: true, reasonCode: 'COMPLIANCE_ESCALATION', comment: 'ผลการตรวจถูกเพิกถอนเนื่องจากหลักฐานเป็นเท็จ' });

        expect(res.status).toBe(200);
        const letter = letterWrittenThrough(canonicalTx);
        assertTerminalElements(letter, {
            stageLabel: STATUS_PRESENTATION.AUDIT_PASSED.label,
            reason: 'ผลการตรวจถูกเพิกถอนเนื่องจากหลักฐานเป็นเท็จ',
        });
    });

    test('เหตุผลว่าง → REJECT ล้มทั้ง tx: no letter, status write rolled back, no post-commit effect', async () => {
        mockCurrentUser = { id: 'aud-1', role: 'auditor', canonicalRole: 'auditor', organizationId: 'org-1' };
        seedCanonical('AUDIT_CONFIRMED');
        seedRejectTransition('AUDIT_CONFIRMED');

        const res = await request(buildCanonicalApp())
            .post('/apps/app-1/workflow-transitions')
            .send({ toState: 'REJECTED' });

        expect(res.status).toBeGreaterThanOrEqual(400);
        // the tx callback rejected → Prisma rolls the status write back
        await expect(mockCanonicalTransaction.mock.results[0].value).rejects.toThrow(/reason/i);
        expect(canonicalTx.notification.create).not.toHaveBeenCalled();
        expect(writeApplicationStatus).toHaveBeenCalledWith(expect.objectContaining({ prisma: canonicalTx }));
        expect(mockSideEffects.sendTransitionNotifications).not.toHaveBeenCalled();
        expect(mockSideEffects.handleRevisionDeadlines).not.toHaveBeenCalled();
    });

    test('ATOMIC: letter write failure fails the transition — no post-commit effect runs', async () => {
        mockCurrentUser = { id: 'aud-1', role: 'auditor', canonicalRole: 'auditor', organizationId: 'org-1' };
        seedCanonical('AUDIT_CONFIRMED');
        seedRejectTransition('AUDIT_CONFIRMED');
        canonicalTx.notification.create.mockRejectedValue(new Error('letter write refused'));

        const res = await request(buildCanonicalApp())
            .post('/apps/app-1/workflow-transitions')
            .send({ toState: 'REJECTED', comment: 'ผลการตรวจประเมินไม่ผ่านเกณฑ์ขั้นต่ำ' });

        expect(res.status).toBe(500);
        await expect(mockCanonicalTransaction.mock.results[0].value).rejects.toThrow('letter write refused');
        expect(mockSideEffects.handleRevisionDeadlines).not.toHaveBeenCalled();
        expect(mockSideEffects.sendTransitionNotifications).not.toHaveBeenCalled();
    });

    test('a non-terminal transition (DOC_APPROVED) mints NO terminal letter (negative control)', async () => {
        mockCurrentUser = { id: 'rev-1', role: 'document_reviewer', canonicalRole: 'document_reviewer', organizationId: 'org-1' };
        seedCanonical('ASSIGNED_FOR_REVIEW');
        mockBuildTransitionUpdate.mockReturnValue({
            previousState: 'ASSIGNED_FOR_REVIEW',
            nextState: 'DOC_APPROVED',
            nextLegacyStatus: 'DOC_APPROVED',
            updateData: { status: 'DOC_APPROVED', formData: {}, workflowHistory: [] },
            transitionEvent: { metadata: {} },
        });

        const res = await request(buildCanonicalApp())
            .post('/apps/app-1/workflow-transitions')
            .send({ toState: 'DOC_APPROVED', comment: 'เอกสารครบถ้วน' });

        expect(res.status).toBe(200);
        expect(canonicalTx.notification.create).not.toHaveBeenCalled();
    });
});

// ───────────────────────────────────────────────────────────────────────────
// 5. Surface — legacy admin status-override (the third REJECTED writer)
// ───────────────────────────────────────────────────────────────────────────

describe('admin status-override → REJECTED — terminal letter atomic (D-8)', () => {
    beforeEach(() => {
        mockCurrentUser = { id: 'admin-1', role: 'admin', canonicalRole: 'admin', firstName: 'Admin', lastName: 'One' };
        mockFindApplicationStatusOverrideSlice.mockResolvedValue({
            id: 'app-1',
            applicationNumber: 'GACP-001',
            healthId: 'h-1',
            status: 'AUDIT_CONFIRMED',
            workflowHistory: [],
        });
    });

    test('an admin override to REJECTED mints the terminal letter in the same tx', async () => {
        const { STATUS_PRESENTATION } = require('../../shared/status-machine-contract');
        const res = await request(buildAdminApp())
            .post('/admin/status-override')
            .send({ applicationId: 'app-1', newStatus: 'REJECTED', reason: 'คำสั่งศาลให้ยุติการพิจารณาคำขอนี้' });

        expect(res.status).toBe(200);
        expect(writeApplicationStatus).toHaveBeenCalledWith(expect.objectContaining({
            prisma: adminTx,
            toStatus: 'REJECTED',
        }));
        const letter = letterWrittenThrough(adminTx);
        assertTerminalElements(letter, {
            stageLabel: STATUS_PRESENTATION.AUDIT_CONFIRMED.label,
            reason: 'คำสั่งศาลให้ยุติการพิจารณาคำขอนี้',
        });
        expect(adminTx.correctionRound.create).not.toHaveBeenCalled();
    });

    test('ATOMIC: a failing letter write fails the override (500)', async () => {
        adminTx.notification.create.mockRejectedValue(new Error('letter write refused'));

        const res = await request(buildAdminApp())
            .post('/admin/status-override')
            .send({ applicationId: 'app-1', newStatus: 'REJECTED', reason: 'คำสั่งศาลให้ยุติการพิจารณาคำขอนี้' });

        expect(res.status).toBe(500);
        await expect(mockAdminTransaction.mock.results[0].value).rejects.toThrow('letter write refused');
    });

    test('a non-terminal override (AUDIT_PASSED) mints NO letter (negative control)', async () => {
        const res = await request(buildAdminApp())
            .post('/admin/status-override')
            .send({ applicationId: 'app-1', newStatus: 'AUDIT_PASSED', reason: 'แก้ไขสถานะที่บันทึกผิด' });

        expect(res.status).toBe(200);
        expect(adminTx.notification.create).not.toHaveBeenCalled();
    });
});

// ───────────────────────────────────────────────────────────────────────────
// 6. SSOT — the terminal copy lives in exactly one file (Law 3.5/3.6)
// ───────────────────────────────────────────────────────────────────────────

describe('terminal letter template SSOT', () => {
    const BACKEND = path.join(__dirname, '..', '..');
    const TEMPLATE_PATH = path.join(BACKEND, 'shared', 'terminal-letter-template.js');

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

    test('the terminal Thai copy is defined ONLY in shared/terminal-letter-template.js', () => {
        expect(fs.existsSync(TEMPLATE_PATH)).toBe(true);
        for (const phrase of [
            'ท่านมีสิทธิ์โต้แย้งคำสั่งตามที่กฎหมายกำหนด',
            'เหตุผลประกอบคำสั่ง',
            'หนังสือแจ้งคำสั่งไม่รับรอง',
        ]) {
            const offenders = walkJsFiles(BACKEND)
                .filter((f) => f !== TEMPLATE_PATH)
                .filter((f) => fs.readFileSync(f, 'utf8').includes(phrase))
                .map((f) => path.relative(BACKEND, f));
            expect(offenders).toEqual([]);
        }
    });

    test('every REJECTED-writing surface mints through decision-letter-service and spells no letter copy', () => {
        const surfaces = [
            'routes/api/provider/handlers/auditor-audit-decision-handler.js',
            'routes/api/provider/handlers/workflow-transitions-handler.js',
            'routes/api/provider/handlers/admin.js',
        ];
        for (const rel of surfaces) {
            const src = fs.readFileSync(path.join(BACKEND, rel), 'utf8');
            expect(src).toMatch(/decision-letter-service/);
            expect(src).not.toMatch(/OFFICIAL_LETTER/);
            expect(src).not.toContain('โต้แย้งคำสั่ง');
        }
    });

    test('the terminal template never reaches for the correction template deadline copy', () => {
        const src = fs.readFileSync(TEMPLATE_PATH, 'utf8');
        expect(src).not.toContain('กำหนดส่งการแก้ไข');
        expect(src).not.toContain('ช่องทางการส่งการแก้ไข');
        expect(src).not.toMatch(/dueAt/);
    });

    test('the terminal mint never writes a correction round (grep pin, both directions)', () => {
        const src = fs.readFileSync(path.join(BACKEND, 'services', 'decision-letter-service.js'), 'utf8');
        // Non-vacuous: the function must EXIST before its body can be pinned.
        expect(src).toContain('async function mintTerminalDecisionLetter');
        const terminalFn = src.slice(src.indexOf('async function mintTerminalDecisionLetter'));
        expect(terminalFn).not.toMatch(/correctionRound/);
        // ...and the correction mint must still keep its round ledger (M3 pin
        // stays true — this change must not delete the correction-round append).
        expect(src).toMatch(/correctionRound\s*\.\s*create/);
    });
});
