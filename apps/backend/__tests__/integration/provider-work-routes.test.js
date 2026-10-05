/**
 * /api/provider/work integration tests — ADR-016 Phase 3.
 *
 * Verifies the combined markDone + workflow-transition behaviour:
 *  - GET /:id/next-states returns legal targets filtered by user role
 *  - POST /:id/done w/o advanceStatus = original behaviour (markDone only)
 *  - POST /:id/done w/ advanceStatus = atomic markDone + status write
 *  - Mandatory-comment guard fires before the tx opens
 *  - Illegal transition rolls back markDone (tx abort)
 */

'use strict';

const request = require('supertest');
const express = require('express');

jest.mock('../../shared/logger', () => ({
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
    stream: { write: jest.fn() },
    createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

jest.mock('../../middleware/auth-middleware', () => ({
    authenticateProvider: (req, _res, next) => next(),
    requireRole: () => (req, _res, next) => next(),
}));

// Stub user-groups so we can control which groups the user has.
const userGroupsState = { groups: ['document_reviewer'] };
jest.mock('../../shared/user-groups', () => ({
    getUserGroups: jest.fn(async () => userGroupsState.groups),
    userInGroup: jest.fn(async (_p, _u, code) => userGroupsState.groups.includes('system_admin_dtam') || userGroupsState.groups.includes(code)),
    listGroupMemberUserIds: jest.fn(async () => []),
    clearCache: jest.fn(),
}));

// Stub work-activity-notifications so claim doesn't try to load
// notification-service / prisma.
jest.mock('../../services/work-activity-notifications', () => ({
    notifyAssigned: jest.fn(),
    notifyWarning: jest.fn(),
    notifyBreach: jest.fn(),
    workTypeLabel: (s) => s,
}));

// Capture writes for assertions.
const writeCalls = [];
jest.mock('../../services/application-status-writer', () => ({
    writeApplicationStatus: jest.fn(async (args) => {
        writeCalls.push(args);
        return {
            id: args.applicationId,
            status: args.toStatus,
            organizationId: 'org-1',
            ...args.additionalData,
        };
    }),
}));

// Mock prisma. The combined-action route uses prisma.$transaction —
// we run the callback with a pass-through tx that delegates to the
// same mocked methods.
const dbState = {
    activities: {
        'a-1': {
            id: 'a-1',
            applicationId: 'app-1',
            workType: 'DOC_REVIEW',
            candidateGroup: 'document_reviewer',
            state: 'CLAIMED',
            assignedUserId: 'u-1',
            triggeredAtStage: 'ASSIGNED_FOR_REVIEW',
            organizationId: 'org-1',
        },
    },
    application: {
        id: 'app-1',
        status: 'ASSIGNED_FOR_REVIEW',
        formData: { workflowState: 'ASSIGNED_FOR_REVIEW' },
        workflowHistory: [],
    },
};
// jest.mock factories cannot reference outer-scope variables. The
// idiomatic workaround is to declare the mock variable with a `mock`
// prefix (jest's own escape hatch), which the test originally tried
// to do via `prismaMock` — but Jest 29's check is "begins with `mock`"
// and `prismaMock` doesn't qualify. Use the proper `mockPrisma` name.
const mockPrisma = {
    workActivity: {
        // Honour `select.application` so the route's
        // `findUnique({ select: { application: { ... } } })` gets the
        // nested object the production handler requires. Pre-existing
        // bug: the mock used to return flat rows so the route returned
        // 404 because activity.application was undefined.
        findUnique: jest.fn(async ({ where, select, include }) => {
            const activity = dbState.activities[where.id];
            if (!activity) {return null;}
            // /next-states uses select.application; GET /:id detail uses include.application.
            const wantsApplication = select?.application || include?.application;
            if (wantsApplication && activity.applicationId) {
                return { ...activity, application: dbState.application };
            }
            return activity;
        }),
        update: jest.fn(async ({ where, data }) => {
            dbState.activities[where.id] = { ...dbState.activities[where.id], ...data };
            return dbState.activities[where.id];
        }),
    },
    application: {
        findUnique: jest.fn(async () => ({ ...dbState.application, healthId: 'h-1' })),
    },
};
mockPrisma.$transaction = jest.fn(async (cb) => cb(mockPrisma));
const prismaMock = mockPrisma; // legacy alias for the rest of the file
jest.mock('../../services/prisma-database', () => ({ prisma: mockPrisma }));

const router = require('../../routes/api/provider/work');

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.user = { id: 'u-1', email: 'u1@example.com', role: 'document_reviewer', canonicalRole: 'document_reviewer' };
        next();
    });
    app.use('/work', router);
    return app;
}

beforeEach(() => {
    jest.clearAllMocks();
    writeCalls.length = 0;
    userGroupsState.groups = ['document_reviewer'];
    dbState.activities['a-1'] = {
        id: 'a-1',
        applicationId: 'app-1',
        workType: 'DOC_REVIEW',
        candidateGroup: 'document_reviewer',
        state: 'CLAIMED',
        assignedUserId: 'u-1',
        triggeredAtStage: 'ASSIGNED_FOR_REVIEW',
        organizationId: 'org-1',
    };
    dbState.application = {
        id: 'app-1',
        status: 'ASSIGNED_FOR_REVIEW',
        formData: { workflowState: 'ASSIGNED_FOR_REVIEW' },
        workflowHistory: [],
    };
});

describe('GET /:id/next-states', () => {
    test('document_reviewer is NOT offered the doc-decision on the work-inbox (WF-1: use canonical)', async () => {
        const res = await request(buildApp()).get('/work/a-1/next-states');
        expect(res.status).toBe(200);
        expect(res.body.data.currentStatus).toBe('ASSIGNED_FOR_REVIEW');
        const targets = res.body.data.options.map((o) => o.toState);
        // DOC_APPROVED / REVISION_REQUESTED are filtered out — the decision must go
        // through the canonical /provider/applications/:id review screen (side-effects).
        expect(targets).not.toContain('DOC_APPROVED');
        expect(targets).not.toContain('REVISION_REQUESTED');
        // those were the reviewer's only legal AFR edges, so nothing remains
        expect(targets).toEqual([]);
    });

    test('admin is also not offered the doc-decision on the work-inbox (blocked for everyone)', async () => {
        userGroupsState.groups = ['system_admin_dtam'];
        const res = await request(buildApp()).get('/work/a-1/next-states');
        expect(res.status).toBe(200);
        const targets = res.body.data.options.map((o) => o.toState);
        expect(targets).not.toContain('DOC_APPROVED');
        expect(targets).not.toContain('REVISION_REQUESTED');
    });

    test('account user sees no AFR transitions (none of theirs match)', async () => {
        userGroupsState.groups = ['finance_officer_platform'];
        const res = await request(buildApp()).get('/work/a-1/next-states');
        expect(res.status).toBe(200);
        expect(res.body.data.options).toEqual([]);
    });

    test('returns 404 when activity does not exist', async () => {
        const res = await request(buildApp()).get('/work/missing/next-states');
        expect(res.status).toBe(404);
    });
});

describe('POST /:id/done — original simple path', () => {
    test('without advanceStatus, just markDone is performed', async () => {
        const res = await request(buildApp())
            .post('/work/a-1/done')
            .send({ note: 'looks good' });
        expect(res.status).toBe(200);
        expect(res.body.data.activity.state).toBe('DONE');
        expect(res.body.data.application).toBeUndefined();
        expect(writeCalls).toHaveLength(0);
    });
});

describe('POST /:id/done — combined with advanceStatus', () => {
    // DOC_APPROVED / REVISION_REQUESTED via the work-inbox are now rejected with 422
    // USE_CANONICAL_REVIEW (WF-1) — covered in the dedicated describe block below. The
    // tests here cover the generic done+advance machinery with a non-decision target.
    test('illegal transition is rejected as 422 INVALID_TRANSITION (no markDone, no write)', async () => {
        const res = await request(buildApp())
            .post('/work/a-1/done')
            .send({ advanceStatus: { toState: 'CERTIFIED' } });
        expect(res.status).toBe(422); // BUG-2: transition-guard faults map to 422, not 400
        expect(res.body.code).toBe('INVALID_TRANSITION');
        expect(res.body.error).toMatch(/Invalid transition|cannot/);
        expect(writeCalls).toHaveLength(0);
    });

    test('rejects empty toState', async () => {
        const res = await request(buildApp())
            .post('/work/a-1/done')
            .send({ advanceStatus: { toState: '' } });
        expect(res.status).toBe(400);
    });
});

// WF-1 (audit follow-up 2026-06-23): the document-review DECISION (DOC_APPROVED /
// REVISION_REQUESTED) must go through the canonical /provider/applications/:id handler,
// which runs the SYSTEM auto-chain to PENDING_AUDIT_FEE + Phase-2 invoicing + the
// 5-working-day RevisionDeadline + applicant notice + immutable AuditLog. The generic
// work-inbox writes status directly (none of those), so it now refuses the decision with
// 422 USE_CANONICAL_REVIEW. (Supersedes the #526 work-inbox REV-11 gate — the canonical
// handler is the sole enforcement point for reviewer-ownership.)
describe('POST /:id/done — WF-1 document decision is blocked on the work-inbox', () => {
    test('DOC_APPROVED → 422 USE_CANONICAL_REVIEW (no markDone, no write)', async () => {
        const res = await request(buildApp())
            .post('/work/a-1/done')
            .send({ advanceStatus: { toState: 'DOC_APPROVED' } });
        expect(res.status).toBe(422);
        expect(res.body.code).toBe('USE_CANONICAL_REVIEW');
        expect(prismaMock.$transaction).not.toHaveBeenCalled();
        expect(writeCalls).toHaveLength(0);
    });

    test('REVISION_REQUESTED → 422 USE_CANONICAL_REVIEW even WITH a comment (decision-block fires first)', async () => {
        const res = await request(buildApp())
            .post('/work/a-1/done')
            .send({ advanceStatus: { toState: 'REVISION_REQUESTED', comment: 'fix page 3' } });
        expect(res.status).toBe(422);
        expect(res.body.code).toBe('USE_CANONICAL_REVIEW');
        expect(writeCalls).toHaveLength(0);
    });

    test('the block is independent of assignment — even the assigned reviewer is funnelled to canonical', async () => {
        dbState.application.reviewerId = 'u-1'; // === req.user.id (the assignee)
        const res = await request(buildApp())
            .post('/work/a-1/done')
            .send({ advanceStatus: { toState: 'DOC_APPROVED' } });
        expect(res.status).toBe(422);
        expect(res.body.code).toBe('USE_CANONICAL_REVIEW');
        expect(writeCalls).toHaveLength(0);
    });
});

// R2 M3b fix cycle 1 (evidence/R2-special-reopen/M3b/audit-report.md F1): the TERMINAL
// rejection is a decision with MANDATORY side-effects — the administrative-order letter
// (จดหมายคำสั่งทางปกครอง, D-8: "ออกจดหมายไม่ได้ = REJECT ไม่สำเร็จ") and the immutable
// in-transaction AuditLog. This surface runs NEITHER (it calls writeApplicationStatus
// with no onAudit and never touches decision-letter-service), so REJECTED joins the
// blocked set: the actor is funnelled to the canonical surfaces that mint the letter
// (workflow-transitions-handler.js / auditor-audit-decision-handler.js).
describe('POST /:id/done — R2 M3b: the TERMINAL rejection is blocked on the work-inbox', () => {
    beforeEach(() => {
        // The one and only edge into REJECTED in the whole machine:
        // AUDIT_CONFIRMED -> REJECTED, held by the auditor role (approver is an
        // alias of the same canonical role).
        userGroupsState.groups = ['field_inspector'];
        dbState.application = {
            id: 'app-1',
            status: 'AUDIT_CONFIRMED',
            formData: { workflowState: 'AUDIT_CONFIRMED' },
            workflowHistory: [],
        };
        dbState.activities['a-1'].triggeredAtStage = 'AUDIT_CONFIRMED';
        dbState.activities['a-1'].candidateGroup = 'field_inspector';
        dbState.activities['a-1'].workType = 'FIELD_AUDIT';
    });

    test('REJECTED → 422 USE_CANONICAL_REVIEW; writeApplicationStatus is NEVER called', async () => {
        const res = await request(buildApp())
            .post('/work/a-1/done')
            .send({
                advanceStatus: {
                    toState: 'REJECTED',
                    comment: 'พบข้อบกพร่องร้ายแรงและไม่มีหลักฐานการแก้ไข',
                    reasonCode: 'AUDIT_FAIL',
                },
            });
        expect(res.status).toBe(422);
        expect(res.body.code).toBe('USE_CANONICAL_REVIEW');
        // the gate fires BEFORE the tx opens — no markDone, no status write
        expect(prismaMock.$transaction).not.toHaveBeenCalled();
        expect(writeCalls).toHaveLength(0);
        expect(dbState.activities['a-1'].state).toBe('CLAIMED');
    });

    test('an ADMIN gets the same 422 — the isAdmin role bypass does not reopen the hole', async () => {
        userGroupsState.groups = ['system_admin_dtam'];
        const res = await request(buildApp())
            .post('/work/a-1/done')
            .send({ advanceStatus: { toState: 'REJECTED', comment: 'admin closes the case' } });
        expect(res.status).toBe(422);
        expect(res.body.code).toBe('USE_CANONICAL_REVIEW');
        expect(writeCalls).toHaveLength(0);
    });

    test('the NON-terminal auditor edge still works here (negative control — the writer IS reachable)', async () => {
        const res = await request(buildApp())
            .post('/work/a-1/done')
            .send({ advanceStatus: { toState: 'AUDIT_PASSED' } });
        expect(res.status).toBe(200);
        expect(writeCalls).toHaveLength(1);
        expect(writeCalls[0].toStatus).toBe('AUDIT_PASSED');
    });

    test('NO current state can drive a REJECTED status write through this surface (exhaustive)', async () => {
        const { WORKFLOW_STATES } = require('../../services/workflow-transition-service');
        expect(WORKFLOW_STATES.length).toBeGreaterThan(10); // not a vacuous loop
        const statuses = [];
        for (const from of WORKFLOW_STATES) {
            // reset the activity — markDone is not rolled back by the mocked tx
            dbState.activities['a-1'].state = 'CLAIMED';
            dbState.application.status = from;
            dbState.application.formData = { workflowState: from };
            const res = await request(buildApp())
                .post('/work/a-1/done')
                .send({ advanceStatus: { toState: 'REJECTED', comment: 'ปิดคำขอ', reasonCode: 'AUDIT_FAIL' } });
            statuses.push([from, res.status, res.body.code]);
        }
        expect(writeCalls.filter((c) => c.toStatus === 'REJECTED')).toEqual([]);
        expect(writeCalls).toHaveLength(0);
        // every from-state is funnelled to canonical (the gate runs before the
        // state is even resolved), so no state answers anything else
        expect(statuses.every(([, status, code]) => status === 422 && code === 'USE_CANONICAL_REVIEW')).toBe(true);
    });

    test('GET /:id/next-states from AUDIT_CONFIRMED does not offer REJECTED (still offers the correctable edges)', async () => {
        const res = await request(buildApp()).get('/work/a-1/next-states');
        expect(res.status).toBe(200);
        expect(res.body.data.currentStatus).toBe('AUDIT_CONFIRMED');
        const targets = res.body.data.options.map((o) => o.toState);
        expect(targets).not.toContain('REJECTED');
        // negative control: the auditor's non-terminal edges are still offered, so
        // the assertion above is not passing on an empty list
        expect(targets).toEqual(expect.arrayContaining(['AUDIT_PASSED', 'CAR_PENDING']));
    });
});

// R2 M3b fix cycle 1 — anti-backslide pin on the SOURCE, not just on behaviour: the
// work-inbox must keep exactly ONE status-write path and it must sit behind the
// decision gate. A second write path (or a write moved above the gate, or REJECTED
// dropped from the blocked set) re-opens the letterless-terminal hole this fix closed.
describe('R2 M3b — work.js source pin: one guarded status-write path', () => {
    const fs = require('fs');
    const path = require('path');
    const WORK_ROUTES = path.join(__dirname, '../../routes/api/provider/work.js');
    const src = fs.readFileSync(WORK_ROUTES, 'utf8');

    test('REJECTED is in the blocked-decision set', () => {
        expect(src).toMatch(/WORK_INBOX_BLOCKED_DECISION_STATES = new Set\(\[[^\]]*'REJECTED'[^\]]*\]\)/);
    });

    test('there is exactly ONE writeApplicationStatus call site and the gate precedes it', () => {
        expect(src.match(/writeApplicationStatus\(/g)).toHaveLength(1);
        const gateIdx = src.indexOf('WORK_INBOX_BLOCKED_DECISION_STATES.has(toState)');
        const writeIdx = src.indexOf('await writeApplicationStatus({');
        expect(gateIdx).toBeGreaterThan(-1);
        expect(writeIdx).toBeGreaterThan(-1);
        expect(gateIdx).toBeLessThan(writeIdx);
    });

    test('the letter/audit side-effects are still absent here — which is WHY the states are blocked', () => {
        // If someone wires decision-letter-service into this surface instead of
        // funnelling to canonical, the 3-surface enforcement point (Law 3.6) grew a
        // 4th head: fail loudly and make them justify it. Matched on CODE shapes
        // (require call / mint call / the writer's audit-hook argument), not on the
        // word, so the file's own reasoning comment doesn't satisfy the pin.
        expect(src).not.toMatch(/require\([^)]*decision-letter-service/);
        expect(src).not.toMatch(/mintTerminalDecisionLetter\(|mintCorrectionLetter\(/);
        expect(src).not.toMatch(/onAudit\s*:/);
    });
});

// PHASE-1 role-correctness: GET /:id is a SHARED candidate-group inbox detail, so any
// group member can open an unclaimed task — but the applicant's email is contact PII
// only the ASSIGNEE needs. Triage fields (name/number/status) stay group-visible.
describe('GET /:id — applicant email PII gating (assignee-only)', () => {
    beforeEach(() => {
        dbState.application.applicant = { firstName: 'สมชาย', lastName: 'เกษตร', email: 'applicant@example.com' };
    });

    test('returns applicantEmail to the ASSIGNEE', async () => {
        // a-1.assignedUserId === req.user.id ('u-1') → assignee
        const res = await request(buildApp()).get('/work/a-1');
        expect(res.status).toBe(200);
        expect(res.body.data.applicantEmail).toBe('applicant@example.com');
    });

    test('hides applicantEmail from a non-assignee candidate-group member (still 200, email null)', async () => {
        dbState.activities['a-1'].assignedUserId = 'u-2'; // someone else owns it
        // u-1 is still in the document_reviewer group → may VIEW (200), but email is gated
        const res = await request(buildApp()).get('/work/a-1');
        expect(res.status).toBe(200);
        expect(res.body.data.applicantEmail).toBeNull();
        // triage data still present for the group member
        expect(res.body.data.id).toBe('a-1');
    });
});
