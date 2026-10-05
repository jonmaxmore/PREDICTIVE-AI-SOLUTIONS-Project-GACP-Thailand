'use strict';

/**
 * R2 M2 — atomic decision + official letter (operator decision D-8, 2026-08-03).
 * Spec: evidence/R2-special-reopen/decisions-final.md (D-8 verbatim + แผน M2) +
 * final-requirements.md ข้อ 2-3 + gap-report.md ตาราง ข้อ 2/ข้อ 3.
 *
 * D-8 verbatim: "นาฬิกา 5 วันทำการเริ่มที่ transaction บันทึกผล+ออกจดหมาย
 * (atomic — ออกจดหมายไม่ได้ = transition ไม่สำเร็จ)"
 *
 * Pins, per decision surface (all three write surfaces of gap-report ข้อ 3):
 *   1. canonical provider workflow-transitions (REVISION_REQUESTED + CAR_PENDING)
 *   2. auditor audit-decision handler (MINOR/MAJOR → CAR_PENDING)
 *   3. PATCH /applications/:id/reject (DOC_REVISION + FIELD_CAR)
 *
 *   a. A correction decision mints ONE OFFICIAL_LETTER row (M1 helper,
 *      kind=OFFICIAL_LETTER) through the SAME transaction client as the
 *      status write, with all four mandatory elements (final-requirements
 *      ข้อ 3): ผลไม่ผ่าน + รายการประเด็นต้องแก้ + กำหนดส่ง (Thai, พ.ศ.) +
 *      ช่องทางส่งการแก้ไข.
 *   b. ATOMIC: a failing letter write rejects the whole transaction — the
 *      handler errors out and NO post-commit effect runs (RevisionDeadline
 *      never moves, notifications never fire). Real rollback of the status
 *      write is Prisma's $transaction guarantee; the pin here is that the
 *      letter write happens INSIDE the same tx callback as
 *      writeApplicationStatus and its rejection propagates.
 *   c. SSOT: the letter template Thai copy lives in exactly ONE backend
 *      file (shared/correction-letter-template.js) — never re-spelled per
 *      surface (Law 3.5/3.6).
 *
 * The OFFICIAL_LETTER literal below is pinned as a raw string ON PURPOSE
 * (same rationale as official-letter.test.js — test files are excluded from
 * the dup-source grep pins; asserting through the SSOT import would be a
 * tautology).
 */

const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');

// ── fixtures ───────────────────────────────────────────────────────────────

const OFFICIAL = 'OFFICIAL_LETTER';
const FARMER = { id: 'farmer-1', organizationId: 'org-farm' };
const MOCK_CAR_DUE = new Date('2026-08-11T09:59:59.000Z');

let mockCurrentUser = null;

// ── shared infra mocks ─────────────────────────────────────────────────────

const mockLogger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
jest.mock('../../shared/logger', () => ({
    ...mockLogger,
    createLogger: jest.fn(() => mockLogger),
}));

// Required after mockLogger exists: thai-format reads the Bangkok day through
// utils/working-days, whose config import loads the (mocked) logger.
const { formatThaiDateFull } = require('../../utils/thai-format');

// notification-service is REAL (the letter must go through the M1 helper) —
// stub its heavy load chain exactly like official-letter.test.js.
jest.mock('../../services/tenant-context', () => ({
    getTenantContext: () => null,
    withoutTenantScope: (fn) => fn(),
}));
jest.mock('../../services/notification-fanout-service', () => ({
    send: jest.fn().mockResolvedValue({ ok: true }),
}));

// decision-letter-service recipient resolution (REAL service, mocked lookup).
const mockFindUserByHealthIdSecurely = jest.fn();
jest.mock('../../services/user-lookup-service', () => ({
    findUserByHealthIdSecurely: (...a) => mockFindUserByHealthIdSecurely(...a),
    findUserByProviderIdSecurely: jest.fn(),
    resolveUserIdFromHealthIdSecurely: jest.fn(),
}));

// The inspector's PASS now asks the onsite-evidence gate before the write (Batch A item 2);
// this suite is about what happens AFTER the evidence is accepted, and the gate has its own
// suites (onsite-evidence-gate, approver-sees-the-file-pass-doors).
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

// ── surface 1: canonical workflow-transitions handler ──────────────────────

function makeLetterTx() {
    return {
        notification: {
            create: jest.fn(async ({ data }) => ({ id: 'letter-1', ...data })),
        },
        // R2 M3: the mint also appends the per-stage CorrectionRound row
        // through the SAME tx (strengthening — round assertions below).
        correctionRound: {
            count: jest.fn(async () => 0),
            create: jest.fn(async ({ data }) => ({ id: 'round-1', ...data })),
        },
    };
}

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
    getRevisionDueAt: (fd) => (fd?.revisionDueAt ? new Date(fd.revisionDueAt) : null),
    REVISION_SLA_DAYS: 5,
    // Real Thai-holiday-aware engine (pure util) — realistic due dates.
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
jest.mock('../../services/admin-application-service', () => ({
    bulkUpdateRevisionDeadlineStatus: jest.fn().mockResolvedValue(null),
    findRevisionDeadlineByApplicationId: jest.fn().mockResolvedValue(null),
    upsertRevisionDeadline: jest.fn().mockResolvedValue(null),
}));

const mockSideEffects = {
    // The builder is pure; the transitions handler imports it from this module.
    buildRevisionDeadlineFormData: jest.requireActual('../../routes/api/provider/handlers/workflow-side-effects').buildRevisionDeadlineFormData,
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
        findAuditDecisionPostWriteSlice: jest.fn().mockResolvedValue({ id: 'app-1', applicationNumber: 'GACP-001', status: 'CAR_PENDING' }),
    },
}));

const mockSeedCarRevisionDeadline = jest.fn().mockResolvedValue(null);
jest.mock('../../services/car-deadline-service', () => ({
    computeCarDueDate: jest.fn(() => MOCK_CAR_DUE),
    seedCarRevisionDeadline: (...a) => mockSeedCarRevisionDeadline(...a),
}));

// ── surface 3: PATCH /applications/:id/reject ──────────────────────────────

const rejectTx = {
    ...makeLetterTx(),
    application: { findUnique: jest.fn(async () => ({ id: 'app-1', applicationNumber: 'GACP-001', status: 'REVISION_REQUESTED' })) },
    applicationComment: { create: jest.fn(async () => ({})) },
    revisionDeadline: {
        findUnique: jest.fn(async () => null),
        upsert: jest.fn(async () => ({})),
    },
};
const mockRejectTransaction = jest.fn(async (cb) => cb(rejectTx));
const mockRejectFindFirst = jest.fn();

jest.mock('../../services/prisma-database', () => ({
    prisma: {
        application: { findFirst: (...a) => mockRejectFindFirst(...a) },
        user: { findUnique: jest.fn(async () => ({ organizationId: 'org-farm' })) },
        notification: { create: jest.fn(async ({ data }) => ({ id: 'n-1', ...data })), findMany: jest.fn(async () => []) },
        $transaction: (...a) => mockRejectTransaction(...a),
    },
}));

jest.mock('../../middleware/auth-middleware', () => ({
    authenticateAny: (req, _res, next) => { req.user = mockCurrentUser; next(); },
    authenticateProvider: (req, _res, next) => { req.user = mockCurrentUser; next(); },
    requireRole: () => (_req, _res, next) => next(),
}));

// ── routers under test ─────────────────────────────────────────────────────

const { applicationsWorkflowTransitions } = require('../../routes/api/provider/handlers/workflow-transitions-handler');
const { auditorAuditDecisions } = require('../../routes/api/provider/handlers/auditor-audit-decision-handler');
const rejectRouter = require('../../routes/api/applications/application-workflow-handlers');

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
function buildRejectApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/applications', rejectRouter);
    return app;
}

// ── helpers ────────────────────────────────────────────────────────────────

/** The single letter row written through the given tx (asserts exactly one). */
function letterWrittenThrough(tx) {
    expect(tx.notification.create).toHaveBeenCalledTimes(1);
    return tx.notification.create.mock.calls[0][0].data;
}

/**
 * Assert the mandatory letter elements (final-requirements ข้อ 3 + ข้อ 2).
 * R2 M3 strengthening: element 5 (per-stage round number) is mandatory now.
 */
function assertFourElements(letter, { items, dueAt, roundNo = 1 }) {
    // 1. ผลไม่ผ่าน (Thai, formal)
    expect(letter.message).toContain('ไม่ผ่าน');
    // 2. รายการประเด็นต้องแก้
    for (const item of items) {
        expect(letter.message).toContain(item);
    }
    // 3. กำหนดส่ง — Thai date with Buddhist-era year
    const thaiDue = formatThaiDateFull(dueAt);
    expect(thaiDue).toMatch(new RegExp(String(new Date(dueAt).getFullYear() + 543)));
    expect(letter.message).toContain(thaiDue);
    // 4. ช่องทางส่งการแก้ไข (ระบบออนไลน์)
    expect(letter.message).toContain('ระบบออนไลน์');
    // 5. เลขครั้งต่อ stage (R2 M3, FINAL ข้อ 2)
    expect(letter.message).toContain(`การแก้ไขครั้งที่ ${roundNo}`);
    expect(letter.metadata.roundNo).toBe(roundNo);
    // Permanent archive class (M1)
    expect(letter.kind).toBe(OFFICIAL);
    expect(letter.userId).toBe(FARMER.id);
    expect(letter.organizationId).toBe(FARMER.organizationId);
}

beforeEach(() => {
    jest.clearAllMocks();
    mockFindUserByHealthIdSecurely.mockResolvedValue({ ...FARMER });
    writeApplicationStatus.mockResolvedValue({});
    mockCanonicalTransaction.mockImplementation(async (cb) => cb(canonicalTx));
    mockAuditorTransaction.mockImplementation(async (cb) => cb(auditorTx));
    mockRejectTransaction.mockImplementation(async (cb) => cb(rejectTx));
    canonicalTx.notification.create.mockImplementation(async ({ data }) => ({ id: 'letter-1', ...data }));
    auditorTx.notification.create.mockImplementation(async ({ data }) => ({ id: 'letter-1', ...data }));
    rejectTx.notification.create.mockImplementation(async ({ data }) => ({ id: 'letter-1', ...data }));
    // R2 M3: fresh-application default — no prior rounds on any stage.
    for (const tx of [canonicalTx, auditorTx, rejectTx]) {
        tx.correctionRound.count.mockResolvedValue(0);
        tx.correctionRound.create.mockImplementation(async ({ data }) => ({ id: 'round-1', ...data }));
    }
    rejectTx.application.findUnique.mockResolvedValue({ id: 'app-1', applicationNumber: 'GACP-001', status: 'REVISION_REQUESTED' });
    rejectTx.revisionDeadline.findUnique.mockResolvedValue(null);
    mockGetById.mockResolvedValue({ id: 'app-1', applicationNumber: 'GACP-001', status: 'REVISION_REQUESTED', formData: {}, updatedAt: new Date(), updatedBy: 'rev-1' });
});

// ───────────────────────────────────────────────────────────────────────────
// Surface 1 — canonical workflow-transitions handler
// ───────────────────────────────────────────────────────────────────────────

describe('canonical workflow-transitions — letter atomic with decision (D-8)', () => {
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

    test('REVISION_REQUESTED mints the OFFICIAL_LETTER through the SAME tx as the status write, with all four elements', async () => {
        mockCurrentUser = { id: 'rev-1', role: 'document_reviewer', canonicalRole: 'document_reviewer', organizationId: 'org-1' };
        seedCanonical('ASSIGNED_FOR_REVIEW');
        mockBuildTransitionUpdate.mockReturnValue({
            previousState: 'ASSIGNED_FOR_REVIEW',
            nextState: 'REVISION_REQUESTED',
            nextLegacyStatus: 'REVISION_REQUESTED',
            updateData: { status: 'REVISION_REQUESTED', formData: {}, workflowHistory: [] },
            transitionEvent: { metadata: {} },
        });
        const items = ['สำเนาโฉนดที่ดินไม่ชัดเจน', 'แผนผังแปลงปลูกไม่ครบถ้วน'];

        const res = await request(buildCanonicalApp())
            .post('/apps/app-1/workflow-transitions')
            .send({ toState: 'REVISION_REQUESTED', comment: 'กรุณาแก้ไขเอกสารตามรายการ', revisionItems: items });

        expect(res.status).toBe(200);
        // The letter went through the same tx client as the status write.
        const writerArgs = writeApplicationStatus.mock.calls[0][0];
        expect(writerArgs.prisma).toBe(canonicalTx);
        const letter = letterWrittenThrough(canonicalTx);
        const dueAt = writerArgs.additionalData.formData.revisionDueAt;
        expect(dueAt).toBeTruthy();
        assertFourElements(letter, { items, dueAt });
        // Structured metadata for downstream surfaces (M3: round number).
        expect(letter.metadata).toMatchObject({
            applicationId: 'app-1',
            applicationNumber: 'GACP-001',
            dueAt,
            roundNo: 1,
        });
        // R2 M3: the per-stage round row is appended through the SAME tx.
        expect(canonicalTx.correctionRound.create).toHaveBeenCalledTimes(1);
        expect(canonicalTx.correctionRound.create.mock.calls[0][0].data).toMatchObject({
            applicationId: 'app-1',
            stage: 'DOC_REVIEW',
            roundNo: 1,
            letterId: 'letter-1',
        });
    });

    test('CAR_PENDING mints the letter too (CAR branch had NO letter before)', async () => {
        mockCurrentUser = { id: 'aud-1', role: 'field_inspector', canonicalRole: 'field_inspector', organizationId: 'org-1' };
        seedCanonical('CAR_REVIEWING');
        mockBuildTransitionUpdate.mockReturnValue({
            previousState: 'CAR_REVIEWING',
            nextState: 'CAR_PENDING',
            nextLegacyStatus: 'CAR_PENDING',
            updateData: { status: 'CAR_PENDING', formData: {}, workflowHistory: [] },
            transitionEvent: { metadata: {} },
        });

        const res = await request(buildCanonicalApp())
            .post('/apps/app-1/workflow-transitions')
            .send({ toState: 'CAR_PENDING', comment: 'พบข้อบกพร่องจากการตรวจประเมิน ต้องแก้ไข' });

        expect(res.status).toBe(200);
        const writerArgs = writeApplicationStatus.mock.calls[0][0];
        const letter = letterWrittenThrough(canonicalTx);
        const dueAt = writerArgs.additionalData.formData.carDueAt;
        expect(dueAt).toBeTruthy();
        assertFourElements(letter, { items: ['พบข้อบกพร่องจากการตรวจประเมิน ต้องแก้ไข'], dueAt });
    });

    test('ATOMIC: letter write failure fails the whole transition — no post-commit effect runs', async () => {
        mockCurrentUser = { id: 'rev-1', role: 'document_reviewer', canonicalRole: 'document_reviewer', organizationId: 'org-1' };
        seedCanonical('ASSIGNED_FOR_REVIEW');
        mockBuildTransitionUpdate.mockReturnValue({
            previousState: 'ASSIGNED_FOR_REVIEW',
            nextState: 'REVISION_REQUESTED',
            nextLegacyStatus: 'REVISION_REQUESTED',
            updateData: { status: 'REVISION_REQUESTED', formData: {}, workflowHistory: [] },
            transitionEvent: { metadata: {} },
        });
        canonicalTx.notification.create.mockRejectedValue(new Error('letter write refused'));

        const res = await request(buildCanonicalApp())
            .post('/apps/app-1/workflow-transitions')
            .send({ toState: 'REVISION_REQUESTED', comment: 'กรุณาแก้ไขเอกสาร' });

        expect(res.status).toBe(500);
        // The tx callback rejected → Prisma rolls back the status write.
        await expect(mockCanonicalTransaction.mock.results[0].value).rejects.toThrow('letter write refused');
        // The status write ran INSIDE that failed tx (same client) — not outside it.
        expect(writeApplicationStatus).toHaveBeenCalledWith(expect.objectContaining({ prisma: canonicalTx }));
        // No post-commit effect: RevisionDeadline never moves, no notice fires.
        expect(mockSideEffects.handleRevisionDeadlines).not.toHaveBeenCalled();
        expect(mockSideEffects.sendTransitionNotifications).not.toHaveBeenCalled();
    });

    test('non-correction transition (DOC_APPROVED) mints NO letter (negative control)', async () => {
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
// Surface 2 — auditor audit-decision handler
// ───────────────────────────────────────────────────────────────────────────

describe('auditor audit-decision — CAR letter atomic with decision (D-8)', () => {
    beforeEach(() => {
        mockCurrentUser = { id: 'auditor-1', role: 'field_inspector', canonicalRole: 'field_inspector', organizationId: 'org-1' };
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

    test('MAJOR → CAR_PENDING mints the Thai OFFICIAL_LETTER in the tx (was: English notice, no due date, no items)', async () => {
        const res = await request(buildAuditorApp())
            .post('/auditor/applications/app-1/audit-decisions')
            .send({
                decision: 'MAJOR',
                notes: 'พบข้อบกพร่องระดับ MAJOR',
                findings: [{ nonConformity: 'พบสารเคมีตกค้างในแปลงปลูก', correctiveAction: 'ปรับปรุงการจัดเก็บสารเคมีให้ถูกต้อง' }],
            });

        expect(res.status).toBe(200);
        expect(writeApplicationStatus).toHaveBeenCalledWith(expect.objectContaining({ prisma: auditorTx }));
        const letter = letterWrittenThrough(auditorTx);
        assertFourElements(letter, {
            items: ['พบสารเคมีตกค้างในแปลงปลูก', 'ปรับปรุงการจัดเก็บสารเคมีให้ถูกต้อง'],
            dueAt: MOCK_CAR_DUE,
        });
        // R2 M3: CAR decisions append a FIELD_AUDIT round through the same tx.
        expect(auditorTx.correctionRound.create).toHaveBeenCalledTimes(1);
        expect(auditorTx.correctionRound.create.mock.calls[0][0].data).toMatchObject({
            stage: 'FIELD_AUDIT',
            roundNo: 1,
            letterId: 'letter-1',
        });
    });

    test('ATOMIC: letter write failure fails the decision — deadline never seeded, 500', async () => {
        auditorTx.notification.create.mockRejectedValue(new Error('letter write refused'));

        const res = await request(buildAuditorApp())
            .post('/auditor/applications/app-1/audit-decisions')
            .send({ decision: 'MINOR', notes: 'ต้องแก้ไขเล็กน้อย' });

        expect(res.status).toBe(500);
        await expect(mockAuditorTransaction.mock.results[0].value).rejects.toThrow('letter write refused');
        expect(mockSeedCarRevisionDeadline).not.toHaveBeenCalled();
    });

    test('PASS mints NO correction letter (negative control)', async () => {
        const res = await request(buildAuditorApp())
            .post('/auditor/applications/app-1/audit-decisions')
            .send({ decision: 'PASS' });

        expect(res.status).toBe(200);
        expect(auditorTx.notification.create).not.toHaveBeenCalled();
    });
});

// ───────────────────────────────────────────────────────────────────────────
// Surface 3 — PATCH /applications/:id/reject
// ───────────────────────────────────────────────────────────────────────────

describe('PATCH /:id/reject — letter atomic with decision (D-8; surface sent NOTHING before)', () => {
    beforeEach(() => {
        mockCurrentUser = { id: 'rev-1', providerId: '1112223334445', role: 'DOCUMENT_REVIEWER', canonicalRole: 'DOCUMENT_REVIEWER' };
        mockRejectFindFirst.mockResolvedValue({
            id: 'app-1',
            applicationNumber: 'GACP-001',
            healthId: 'h-1',
            status: 'ASSIGNED_FOR_REVIEW',
            formData: {},
            workflowHistory: [],
            reviewerId: null,
            auditorId: null,
        });
    });

    test('DOC_REVISION mints the OFFICIAL_LETTER in the same tx as status write + deadline upsert', async () => {
        const res = await request(buildRejectApp())
            .patch('/api/applications/app-1/reject')
            .send({ comment: 'เอกสารหมวดที่ 3 ไม่ครบถ้วน กรุณาแก้ไข', type: 'DOC_REVISION' });

        expect(res.status).toBe(200);
        expect(writeApplicationStatus).toHaveBeenCalledWith(expect.objectContaining({ prisma: rejectTx }));
        expect(rejectTx.revisionDeadline.upsert).toHaveBeenCalledTimes(1);
        const letter = letterWrittenThrough(rejectTx);
        const dueAt = writeApplicationStatus.mock.calls[0][0].additionalData.formData.revisionDueAt;
        expect(dueAt).toBeTruthy();
        assertFourElements(letter, { items: ['เอกสารหมวดที่ 3 ไม่ครบถ้วน กรุณาแก้ไข'], dueAt });
        // R2 M3: the round row rides the same tx as status write + deadline.
        expect(rejectTx.correctionRound.create).toHaveBeenCalledTimes(1);
        expect(rejectTx.correctionRound.create.mock.calls[0][0].data).toMatchObject({
            stage: 'DOC_REVIEW',
            roundNo: 1,
            letterId: 'letter-1',
        });
    });

    test('FIELD_CAR mints the letter too', async () => {
        mockCurrentUser = { id: 'aud-1', role: 'field_inspector', canonicalRole: 'field_inspector' };
        mockRejectFindFirst.mockResolvedValue({
            id: 'app-1',
            applicationNumber: 'GACP-001',
            healthId: 'h-1',
            status: 'CAR_REVIEWING',
            formData: {},
            workflowHistory: [],
            reviewerId: null,
            auditorId: null,
        });

        const res = await request(buildRejectApp())
            .patch('/api/applications/app-1/reject')
            .send({ comment: 'ต้องแก้ไขข้อบกพร่องจากการตรวจประเมิน', type: 'FIELD_CAR' });

        expect(res.status).toBe(200);
        const letter = letterWrittenThrough(rejectTx);
        const dueAt = writeApplicationStatus.mock.calls[0][0].additionalData.formData.carDueAt;
        expect(dueAt).toBeTruthy();
        assertFourElements(letter, { items: ['ต้องแก้ไขข้อบกพร่องจากการตรวจประเมิน'], dueAt });
    });

    test('ATOMIC: letter write failure fails the reject — RevisionDeadline never touched, 500', async () => {
        rejectTx.notification.create.mockRejectedValue(new Error('letter write refused'));

        const res = await request(buildRejectApp())
            .patch('/api/applications/app-1/reject')
            .send({ comment: 'เอกสารไม่ครบถ้วน', type: 'DOC_REVISION' });

        expect(res.status).toBe(500);
        await expect(mockRejectTransaction.mock.results[0].value).rejects.toThrow('letter write refused');
        // The deadline upsert lives AFTER the letter mint in the same tx —
        // a failed letter means the clock row is never even attempted
        // (and the status write in the same tx rolls back).
        expect(rejectTx.revisionDeadline.upsert).not.toHaveBeenCalled();
    });
});

// ───────────────────────────────────────────────────────────────────────────
// SSOT — the letter template lives in exactly one file (Law 3.5/3.6)
// ───────────────────────────────────────────────────────────────────────────

describe('letter template SSOT', () => {
    const BACKEND = path.join(__dirname, '..', '..');
    const TEMPLATE_PATH = path.join(BACKEND, 'shared', 'correction-letter-template.js');

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

    test('the Thai letter copy is defined ONLY in shared/correction-letter-template.js', () => {
        expect(fs.existsSync(TEMPLATE_PATH)).toBe(true);
        // Distinctive template phrases — element 3 + element 4 wording.
        for (const phrase of ['กำหนดส่งการแก้ไข', 'ช่องทางการส่งการแก้ไข']) {
            const offenders = walkJsFiles(BACKEND)
                .filter((f) => f !== TEMPLATE_PATH)
                .filter((f) => fs.readFileSync(f, 'utf8').includes(phrase))
                .map((f) => path.relative(BACKEND, f));
            expect(offenders).toEqual([]);
        }
    });

    test('buildCorrectionLetter emits all five elements + structured metadata (M3: round number)', () => {
        const { buildCorrectionLetter, CORRECTION_LETTER_STAGE } = require('../../shared/correction-letter-template');
        const due = new Date('2026-08-11T09:59:59.000Z');
        const letter = buildCorrectionLetter({
            applicationNumber: 'GACP-001',
            stage: CORRECTION_LETTER_STAGE.DOC_REVIEW,
            items: ['รายการที่หนึ่ง', 'รายการที่สอง'],
            message: 'ข้อความประกอบ',
            dueAt: due,
            roundNo: 2,
        });
        expect(letter.title).toContain('GACP-001');
        expect(letter.message).toContain('ไม่ผ่าน');
        expect(letter.message).toContain('1. รายการที่หนึ่ง');
        expect(letter.message).toContain('2. รายการที่สอง');
        expect(letter.message).toContain(formatThaiDateFull(due));
        expect(letter.message).toContain('ระบบออนไลน์');
        expect(letter.message).toContain('การแก้ไขครั้งที่ 2');
        expect(letter.metadata).toMatchObject({
            applicationNumber: 'GACP-001',
            stage: CORRECTION_LETTER_STAGE.DOC_REVIEW,
            items: ['รายการที่หนึ่ง', 'รายการที่สอง'],
            dueAt: due.toISOString(),
            roundNo: 2,
        });
    });

    test('buildCorrectionLetter falls back to the decision message when no structured items exist', () => {
        const { buildCorrectionLetter, CORRECTION_LETTER_STAGE } = require('../../shared/correction-letter-template');
        const letter = buildCorrectionLetter({
            applicationNumber: 'GACP-001',
            stage: CORRECTION_LETTER_STAGE.FIELD_AUDIT_CAR,
            items: [],
            message: 'ความเห็นของผู้ตรวจ',
            dueAt: new Date('2026-08-11T09:59:59.000Z'),
            roundNo: 1,
        });
        expect(letter.message).toContain('1. ความเห็นของผู้ตรวจ');
    });

    test('buildCorrectionLetter REFUSES an incomplete letter (D-8: no letter, no transition)', () => {
        const { buildCorrectionLetter, CORRECTION_LETTER_STAGE } = require('../../shared/correction-letter-template');
        // Missing due date → element 3 impossible.
        expect(() => buildCorrectionLetter({
            applicationNumber: 'GACP-001',
            stage: CORRECTION_LETTER_STAGE.DOC_REVIEW,
            items: ['รายการ'],
            message: null,
            dueAt: null,
            roundNo: 1,
        })).toThrow();
        // No items AND no message → element 2 impossible.
        expect(() => buildCorrectionLetter({
            applicationNumber: 'GACP-001',
            stage: CORRECTION_LETTER_STAGE.DOC_REVIEW,
            items: [],
            message: '',
            dueAt: new Date(),
            roundNo: 1,
        })).toThrow();
        // R2 M3 strengthening: missing round number → element 5 impossible.
        expect(() => buildCorrectionLetter({
            applicationNumber: 'GACP-001',
            stage: CORRECTION_LETTER_STAGE.DOC_REVIEW,
            items: ['รายการ'],
            message: null,
            dueAt: new Date(),
        })).toThrow(/roundNo/);
    });

    test('letters land as kind=OFFICIAL_LETTER via the M1 helper only — no direct kind stamp outside notification-service', () => {
        // The surfaces must go through decision-letter-service → createOfficialLetter.
        // (The kind literal itself is already grep-pinned by official-letter.test.js;
        // this pins that the NEW surfaces never spell it either.)
        const surfaces = [
            'routes/api/provider/handlers/workflow-transitions-handler.js',
            'routes/api/provider/handlers/auditor-audit-decision-handler.js',
            'routes/api/applications/application-workflow-handlers.js',
        ];
        for (const rel of surfaces) {
            const src = fs.readFileSync(path.join(BACKEND, rel), 'utf8');
            expect(src).not.toMatch(/OFFICIAL_LETTER/);
            expect(src).toMatch(/decision-letter-service/);
        }
    });
});
