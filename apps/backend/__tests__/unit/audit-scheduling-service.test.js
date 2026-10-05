/**
 * Tests for audit-scheduling-service.js — Iter 25 (2026-05-16).
 *
 * Anchors:
 *   - assignAuditor: happy path transitions AUDIT_FEE_PAID → AUDIT_CONFIRMED
 *     atomically, writes auditSchedule into formData, dispatches notification.
 *   - Conflict detection: AUDITOR_BUSY (overlap) + AUDITOR_OVER_CAP (>2/day).
 *   - Future-date + working-day validation rejected as VALIDATION_ERROR /
 *     NON_WORKING_DAY.
 *   - State guard: rejects assign when application not in AUDIT_FEE_PAID.
 *   - Role guard: rejects non-scheduler.
 *   - Reschedule request: HEALTH applicant creates PENDING entry inside
 *     formData.rescheduleRequests[]; rejects non-applicant; rejects when
 *     state ≠ AUDIT_CONFIRMED.
 *   - Reschedule approve: scheduler approves → schedule updated; rejects
 *     when reschedule already APPROVED; rejects past dates.
 *   - getAuditorAvailability: surfaces busy slots + overCapDays.
 *   - getSchedulingQueue: filters to AUDIT_FEE_PAID.
 *
 * The Prisma mock here is intentionally lean — we focus on the
 * orchestration (transactional shape, role gating, conflict detection,
 * notification fanout, state validation).
 */

'use strict';

const path = require('path');

function makeApplicationStore(seed = []) {
    const map = new Map();
    seed.forEach((row) => map.set(row.id, { ...row }));
    return map;
}

function makeUserStore(seed = []) {
    const map = new Map();
    seed.forEach((row) => map.set(row.id, { ...row }));
    return map;
}

function createPrismaMock({ applications = [], users = [] } = {}) {
    const appStore = makeApplicationStore(applications);
    const userStore = makeUserStore(users);

    const prisma = {
        application: {
            findFirst: jest.fn(async ({ where, select: _select }) => {
                const ids = where.OR ? where.OR.map((c) => c.id || c.applicationNumber) : [where.id];
                for (const row of appStore.values()) {
                    if (where.isDeleted === false && row.isDeleted) {continue;}
                    if (where.status && row.status !== where.status && (where.status.notIn || !where.status.notIn?.includes(row.status))) {
                        // simple shape check
                    }
                    if (ids.includes(row.id) || ids.includes(row.applicationNumber)) {return { ...row };}
                }
                return null;
            }),
            // armOnsiteEvidence reads the application's formData through this to
            // re-point the evidence pin (formData.onsiteAuditId) at the audit it
            // just armed — see services/audit/arm-onsite-evidence.js.
            findUnique: jest.fn(async ({ where: { id } }) => {
                const row = appStore.get(id);
                return row ? { ...row } : null;
            }),
            findMany: jest.fn(async ({ where }) => {
                return Array.from(appStore.values()).filter((row) => {
                    if (where.isDeleted === false && row.isDeleted) {return false;}
                    if (where.auditorId && row.auditorId !== where.auditorId) {return false;}
                    if (where.scheduledDate?.gte && row.scheduledDate < where.scheduledDate.gte) {return false;}
                    if (where.scheduledDate?.lte && row.scheduledDate > where.scheduledDate.lte) {return false;}
                    if (where.status?.notIn && where.status.notIn.includes(row.status)) {return false;}
                    if (where.status && typeof where.status === 'string' && row.status !== where.status) {return false;}
                    if (where.id?.not && row.id === where.id.not) {return false;}
                    if (where.organizationId && row.organizationId !== where.organizationId) {return false;}
                    return true;
                }).map((row) => ({ ...row }));
            }),
            update: jest.fn(async ({ where: { id }, data }) => {
                const existing = appStore.get(id);
                if (!existing) {throw new Error(`application ${id} not found`);}
                const updated = { ...existing, ...data, updatedAt: new Date() };
                if (data.formData) {updated.formData = data.formData;}
                appStore.set(id, updated);
                return { ...updated };
            }),
        },
        user: {
            findFirst: jest.fn(async ({ where, select: _select }) => {
                // Any clause this mock does not understand must be fatal, never
                // ignored. It used to skip unknown keys and fall through to the
                // first row in the store — so when the service moved the
                // applicant lookup from `healthId` to `canonicalId` (STAGE 0
                // re-key), the filter silently stopped applying and the mock
                // handed back the AUDITOR instead of the applicant. The
                // assertion that caught it looked like a production bug.
                const SUPPORTED = [
                    'id', 'canonicalId', 'healthId', 'role',
                    'status', 'organizationId', 'isActive', 'isDeleted',
                ];
                const unknown = Object.keys(where).filter((k) => !SUPPORTED.includes(k));
                if (unknown.length) {
                    throw new Error(
                        `[test prisma mock] user.findFirst: unsupported where clause(s) ${unknown.join(', ')} — `
                        + 'teach the mock this filter instead of letting it match everything.',
                    );
                }
                for (const row of userStore.values()) {
                    if (where.id && row.id !== where.id) {continue;}
                    if (where.canonicalId && row.canonicalId !== where.canonicalId) {continue;}
                    if (where.healthId && row.healthId !== where.healthId) {continue;}
                    if (where.role && row.role !== where.role) {continue;}
                    if (where.status && row.status !== where.status) {continue;}
                    if (where.organizationId && row.organizationId !== where.organizationId) {continue;}
                    if (where.isActive === true && row.isActive === false) {continue;}
                    if (where.isDeleted === false && row.isDeleted) {continue;}
                    return { ...row };
                }
                return null;
            }),
        },
        auditChecklist: {
            findFirst: jest.fn(async () => null),
            create: jest.fn(async ({ data }) => ({ id: 'audit-created-1', ...data })),
            // inspector swaps move the live evidence row in the same transaction
            updateMany: jest.fn(async () => ({ count: 0 })),
        },
        $transaction: jest.fn(async (cbOrArr) => {
            if (typeof cbOrArr === 'function') {return cbOrArr(prisma);}
            return Promise.all(cbOrArr);
        }),
    };
    return { prisma, appStore, userStore };
}

function makeFanoutMock() {
    return {
        // The farmer's and inspector's booking notices go out through the shared Thai
        // builder (services/audit/audit-schedule-notices -> createNotification).
        createNotification: jest.fn(async () => ({ id: 'n' })),
        send: jest.fn(async ({ userId, type, payload }) => ({
            dedupeKey: 'fake', deduped: false,
            inApp: { ok: true }, email: { ok: true }, sms: { ok: true },
            _called: { userId, type, payload },
        })),
    };
}

const SERVICE_PATH = path.resolve(__dirname, '../../services/audit-scheduling-service.js');

function loadService({ prisma, fanoutMock }) {
    jest.resetModules();
    jest.doMock('../../services/prisma-database', () => ({ prisma }));
    jest.doMock('../../services/notification-fanout-service', () => fanoutMock);
    jest.doMock('../../services/notification-service', () => ({ createNotification: fanoutMock.createNotification }));
    jest.doMock('../../middleware/audit-logger', () => ({
        auditLogger: { log: jest.fn().mockResolvedValue(null) },
        AuditCategory: { APPLICATION: 'APPLICATION' },
        AuditSeverity: { INFO: 'INFO', WARNING: 'WARNING' },
        ResourceType: { APPLICATION: 'APPLICATION' },
    }));
    // Stub working-days as the actual TH holiday calendar is large.
    // Treat Mon-Fri as working, Sat (6) + Sun (0) as non-working. The zone
    // helpers stay real: the service reads the Bangkok day through them.
    jest.doMock('../../utils/working-days', () => ({
        ...jest.requireActual('../../utils/working-days'),
        isWorkingDay: (date) => {
            // Mon-Fri on the Bangkok calendar — the day the service reads.
            const { weekday } = getZonedParts(date instanceof Date ? date : new Date(date));
            return weekday !== 'Sat' && weekday !== 'Sun';
        },
        countWorkingDaysBetween: () => 1,
    }));
    return require(SERVICE_PATH);
}

const ACTOR_SCHEDULER = {
    id: 'user-sched-1',
    canonicalRole: 'dispatcher',
    role: 'dispatcher',
    organizationId: 'org-1',
};

const ACTOR_ADMIN = {
    id: 'user-admin-1',
    canonicalRole: 'system_admin_dtam',
    role: 'system_admin_dtam',
    organizationId: 'org-1',
};

const ACTOR_HEALTH = {
    id: 'user-applicant-1',
    canonicalRole: 'health',
    role: 'health',
    healthId: 'health-100',
};

const ACTOR_AUDITOR = {
    id: 'user-auditor-1',
    canonicalRole: 'field_inspector',
    role: 'field_inspector',
};

const AUDITOR_USER = {
    id: 'auditor-1',
    role: 'field_inspector',
    canonicalRole: 'field_inspector',
    firstName: 'สมชาย',
    lastName: 'ผู้ตรวจ',
    email: 'auditor@example.com',
    // The service filters auditors on `status: 'ACTIVE'` + `organizationId`
    // (see auditorWhere) — its own comment records that User has no isActive
    // column. Without these the row is invisible to a faithful mock.
    status: 'ACTIVE',
    organizationId: 'org-1',
    isActive: true,
    isDeleted: false,
};

const APPLICANT_USER = {
    id: 'user-applicant-1',
    // Application.healthId is an FK onto User.canonicalId (not User.healthId)
    // after the STAGE-0 re-key, which is what the service queries by.
    canonicalId: 'health-100',
    healthId: 'health-100',
    role: 'health',
    canonicalRole: 'health',
    firstName: 'สมชาย',
    lastName: 'ใจดี',
    email: 'farmer@example.com',
    status: 'ACTIVE',
    organizationId: 'org-1',
    isActive: true,
    isDeleted: false,
};

function makeApplication(overrides = {}) {
    return {
        id: 'app-1',
        applicationNumber: 'APP-2026-00001',
        status: 'AUDIT_FEE_PAID',
        organizationId: 'org-1',
        healthId: 'health-100',
        auditorId: null,
        scheduledDate: null,
        phase2Status: 'PAID',
        formData: { workflowState: 'AUDIT_FEE_PAID' },
        workflowHistory: [],
        isDeleted: false,
        createdAt: new Date('2026-05-01T00:00:00Z'),
        updatedAt: new Date('2026-05-10T00:00:00Z'),
        ...overrides,
    };
}

// Find next Tuesday (always working day under our stub).
// Fixtures are Bangkok wall-clock times on Bangkok days, so the file means the
// same thing whatever zone the jest process runs in (UTC, Bangkok, Los Angeles).
const { getZonedParts, startOfLocalCalendarDay } = jest.requireActual('../../utils/working-days');
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** `hour`:00 in Bangkok on the Bangkok day that is `dayOffset` days after `base`'s. */
function bangkokDayAt(base, hour, dayOffset = 0) {
    const { year, month, day } = getZonedParts(base);
    return new Date(startOfLocalCalendarDay(year, month, day + dayOffset).getTime() + hour * HOUR_MS);
}

function nextWorkingDayAt(hour = 10) {
    for (let offset = 7; ; offset += 1) {
        const d = bangkokDayAt(new Date(), hour, offset);
        const { weekday } = getZonedParts(d);
        if (weekday !== 'Sat' && weekday !== 'Sun') {return d;}
    }
}

describe('[Iter25] audit-scheduling-service — assignAuditor', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('happy path: AUDIT_FEE_PAID → AUDIT_CONFIRMED with auditSchedule', async () => {
        const app = makeApplication();
        const { prisma, appStore } = createPrismaMock({
            applications: [app],
            users: [AUDITOR_USER, APPLICANT_USER],
        });
        const fanoutMock = makeFanoutMock();
        const svc = loadService({ prisma, fanoutMock });

        const scheduledAt = nextWorkingDayAt(10);
        const result = await svc.assignAuditor({
            applicationId: 'app-1',
            auditorId: 'auditor-1',
            scheduledDate: scheduledAt.toISOString(),
            location: 'ไร่ตัวอย่าง จ.เชียงใหม่',
            actor: ACTOR_SCHEDULER,
        });

        expect(result.workflowState).toBe('AUDIT_CONFIRMED');
        expect(result.auditId).toBeDefined();
        expect(result.auditor.id).toBe('auditor-1');

        const stored = appStore.get('app-1');
        expect(stored.status).toBe('AUDIT_CONFIRMED');
        expect(stored.auditorId).toBe('auditor-1');
        expect(stored.formData.auditSchedule.auditorId).toBe('auditor-1');
        expect(stored.formData.auditSchedule.inspectionMode).toBe('ONSITE');

        // the farmer AND the assigned inspector are told, in Thai
        const told = fanoutMock.createNotification.mock.calls.map((c) => c[0].userId).sort();
        expect(told).toEqual(['auditor-1', 'user-applicant-1']);
    });

    test('admin role can also assign (ADMIN_OVERRIDE)', async () => {
        const app = makeApplication();
        const { prisma } = createPrismaMock({
            applications: [app], users: [AUDITOR_USER, APPLICANT_USER],
        });
        const svc = loadService({ prisma, fanoutMock: makeFanoutMock() });

        const result = await svc.assignAuditor({
            applicationId: 'app-1',
            auditorId: 'auditor-1',
            scheduledDate: nextWorkingDayAt(10).toISOString(),
            actor: ACTOR_ADMIN,
        });
        expect(result.workflowState).toBe('AUDIT_CONFIRMED');
    });

    test('rejects non-SCHEDULER actor (FORBIDDEN_ROLE)', async () => {
        const app = makeApplication();
        const { prisma } = createPrismaMock({
            applications: [app], users: [AUDITOR_USER, APPLICANT_USER],
        });
        const svc = loadService({ prisma, fanoutMock: makeFanoutMock() });

        await expect(svc.assignAuditor({
            applicationId: 'app-1',
            auditorId: 'auditor-1',
            scheduledDate: nextWorkingDayAt(10).toISOString(),
            actor: ACTOR_AUDITOR,
        })).rejects.toMatchObject({ code: 'FORBIDDEN_ROLE' });
    });

    // Tenant guard (audit 2.5): the application lookup is by id/number and not
    // org-scoped, so a scheduler in tenant A must not be able to schedule an
    // audit on tenant B's application. Cross-tenant → APPLICATION_NOT_FOUND
    // (anti-enumeration). The happy-path test above proves same-org still works.
    test('tenant guard: rejects a cross-tenant application (APPLICATION_NOT_FOUND) — audit 2.5', async () => {
        const app = makeApplication(); // organizationId: 'org-1'
        const { prisma } = createPrismaMock({
            applications: [app], users: [AUDITOR_USER, APPLICANT_USER],
        });
        const svc = loadService({ prisma, fanoutMock: makeFanoutMock() });

        await expect(svc.assignAuditor({
            applicationId: 'app-1',
            auditorId: 'auditor-1',
            scheduledDate: nextWorkingDayAt(10).toISOString(),
            actor: { ...ACTOR_SCHEDULER, organizationId: 'org-2' },
        })).rejects.toMatchObject({ code: 'APPLICATION_NOT_FOUND' });
    });

    test('rejects past scheduledDate (VALIDATION_ERROR)', async () => {
        const app = makeApplication();
        const { prisma } = createPrismaMock({
            applications: [app], users: [AUDITOR_USER, APPLICANT_USER],
        });
        const svc = loadService({ prisma, fanoutMock: makeFanoutMock() });

        const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
        await expect(svc.assignAuditor({
            applicationId: 'app-1',
            auditorId: 'auditor-1',
            scheduledDate: yesterday.toISOString(),
            actor: ACTOR_SCHEDULER,
        })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    test('rejects weekend (NON_WORKING_DAY)', async () => {
        const app = makeApplication();
        const { prisma } = createPrismaMock({
            applications: [app], users: [AUDITOR_USER, APPLICANT_USER],
        });
        const svc = loadService({ prisma, fanoutMock: makeFanoutMock() });

        // Find next Saturday
        let sat = bangkokDayAt(new Date(), 10, 14);
        while (getZonedParts(sat).weekday !== 'Sat') {sat = new Date(sat.getTime() + DAY_MS);}

        await expect(svc.assignAuditor({
            applicationId: 'app-1',
            auditorId: 'auditor-1',
            scheduledDate: sat.toISOString(),
            actor: ACTOR_SCHEDULER,
        })).rejects.toMatchObject({ code: 'NON_WORKING_DAY' });
    });

    test('rejects when application not in AUDIT_FEE_PAID (INVALID_STATE)', async () => {
        const app = makeApplication({ status: 'DRAFT', formData: { workflowState: 'DRAFT' } });
        const { prisma } = createPrismaMock({
            applications: [app], users: [AUDITOR_USER, APPLICANT_USER],
        });
        const svc = loadService({ prisma, fanoutMock: makeFanoutMock() });

        await expect(svc.assignAuditor({
            applicationId: 'app-1',
            auditorId: 'auditor-1',
            scheduledDate: nextWorkingDayAt(10).toISOString(),
            actor: ACTOR_SCHEDULER,
        })).rejects.toMatchObject({ code: 'INVALID_STATE' });
    });

    test('rejects when auditor user not found (AUDITOR_NOT_FOUND)', async () => {
        const app = makeApplication();
        const { prisma } = createPrismaMock({
            applications: [app], users: [APPLICANT_USER],
        });
        const svc = loadService({ prisma, fanoutMock: makeFanoutMock() });

        await expect(svc.assignAuditor({
            applicationId: 'app-1',
            auditorId: 'nonexistent',
            scheduledDate: nextWorkingDayAt(10).toISOString(),
            actor: ACTOR_SCHEDULER,
        })).rejects.toMatchObject({ code: 'AUDITOR_NOT_FOUND' });
    });

    test('rejects when auditor does NOT hold AUDITOR role (AUDITOR_INVALID_ROLE)', async () => {
        const app = makeApplication();
        const badAuditor = { ...AUDITOR_USER, role: 'health', canonicalRole: 'health' };
        const { prisma } = createPrismaMock({
            applications: [app], users: [badAuditor, APPLICANT_USER],
        });
        const svc = loadService({ prisma, fanoutMock: makeFanoutMock() });

        await expect(svc.assignAuditor({
            applicationId: 'app-1',
            auditorId: 'auditor-1',
            scheduledDate: nextWorkingDayAt(10).toISOString(),
            actor: ACTOR_SCHEDULER,
        })).rejects.toMatchObject({ code: 'AUDITOR_INVALID_ROLE' });
    });

    test('AUDITOR_OVER_CAP when auditor already has 2 audits that day', async () => {
        const scheduledAt = nextWorkingDayAt(10);
        const morning = bangkokDayAt(scheduledAt, 8);
        const afternoon = bangkokDayAt(scheduledAt, 14);
        const apps = [
            makeApplication({ id: 'app-1' }),
            makeApplication({
                id: 'app-busy-1',
                status: 'AUDIT_CONFIRMED',
                auditorId: 'auditor-1',
                scheduledDate: morning,
            }),
            makeApplication({
                id: 'app-busy-2',
                status: 'AUDIT_CONFIRMED',
                auditorId: 'auditor-1',
                scheduledDate: afternoon,
            }),
        ];
        const { prisma } = createPrismaMock({
            applications: apps, users: [AUDITOR_USER, APPLICANT_USER],
        });
        const svc = loadService({ prisma, fanoutMock: makeFanoutMock() });

        await expect(svc.assignAuditor({
            applicationId: 'app-1',
            auditorId: 'auditor-1',
            scheduledDate: scheduledAt.toISOString(),
            actor: ACTOR_SCHEDULER,
        })).rejects.toMatchObject({ code: 'AUDITOR_OVER_CAP' });
    });

    test('AUDITOR_BUSY surfaces overlapping window', async () => {
        const scheduledAt = nextWorkingDayAt(10);
        // existing audit at 10:00 — request overlaps directly
        const conflict = new Date(scheduledAt);
        const apps = [
            makeApplication({ id: 'app-1' }),
            makeApplication({
                id: 'app-busy-1',
                status: 'AUDIT_CONFIRMED',
                auditorId: 'auditor-1',
                scheduledDate: conflict,
            }),
        ];
        const { prisma } = createPrismaMock({
            applications: apps, users: [AUDITOR_USER, APPLICANT_USER],
        });
        const svc = loadService({ prisma, fanoutMock: makeFanoutMock() });

        await expect(svc.assignAuditor({
            applicationId: 'app-1',
            auditorId: 'auditor-1',
            scheduledDate: scheduledAt.toISOString(),
            actor: ACTOR_SCHEDULER,
        })).rejects.toMatchObject({
            code: 'AUDITOR_BUSY',
            data: expect.objectContaining({ conflictingApplicationId: 'app-busy-1' }),
        });
    });

    test('returns APPLICATION_NOT_FOUND for unknown id', async () => {
        const { prisma } = createPrismaMock({
            applications: [], users: [AUDITOR_USER, APPLICANT_USER],
        });
        const svc = loadService({ prisma, fanoutMock: makeFanoutMock() });
        await expect(svc.assignAuditor({
            applicationId: 'ghost',
            auditorId: 'auditor-1',
            scheduledDate: nextWorkingDayAt(10).toISOString(),
            actor: ACTOR_SCHEDULER,
        })).rejects.toMatchObject({ code: 'APPLICATION_NOT_FOUND' });
    });

    test('ONSITE assign find-or-creates one AuditChecklist (IN_PROGRESS, auditorId=assigned, org=app org)', async () => {
        const app = makeApplication();
        const { prisma } = createPrismaMock({
            applications: [app],
            users: [AUDITOR_USER, APPLICANT_USER],
        });
        const svc = loadService({ prisma, fanoutMock: makeFanoutMock() });

        await svc.assignAuditor({
            applicationId: 'app-1',
            auditorId: 'auditor-1',
            scheduledDate: nextWorkingDayAt(10).toISOString(),
            location: 'ไร่ตัวอย่าง จ.เชียงใหม่',
            actor: ACTOR_SCHEDULER,
        });

        expect(prisma.auditChecklist.findFirst).toHaveBeenCalledTimes(1);
        expect(prisma.auditChecklist.create).toHaveBeenCalledTimes(1);
        const created = prisma.auditChecklist.create.mock.calls[0][0].data;
        expect(created).toMatchObject({
            applicationId: 'app-1',
            auditorId: 'auditor-1',
            status: 'IN_PROGRESS',
            organizationId: 'org-1',
        });
    });

    test('ONSITE assign is idempotent: an existing active AuditChecklist is reused, not duplicated', async () => {
        const app = makeApplication();
        const { prisma } = createPrismaMock({
            applications: [app],
            users: [AUDITOR_USER, APPLICANT_USER],
        });
        prisma.auditChecklist.findFirst.mockResolvedValueOnce({ id: 'audit-existing-1' });
        const svc = loadService({ prisma, fanoutMock: makeFanoutMock() });

        await svc.assignAuditor({
            applicationId: 'app-1',
            auditorId: 'auditor-1',
            scheduledDate: nextWorkingDayAt(10).toISOString(),
            actor: ACTOR_SCHEDULER,
        });

        expect(prisma.auditChecklist.create).not.toHaveBeenCalled();
    });
});

describe('[Iter25] audit-scheduling-service — requestReschedule', () => {
    beforeEach(() => jest.clearAllMocks());

    test('HEALTH applicant creates PENDING reschedule entry', async () => {
        const scheduledAt = nextWorkingDayAt(10);
        const app = makeApplication({
            status: 'AUDIT_CONFIRMED',
            auditorId: 'auditor-1',
            scheduledDate: scheduledAt,
            formData: {
                workflowState: 'AUDIT_CONFIRMED',
                auditSchedule: { auditorId: 'auditor-1', scheduledDate: scheduledAt.toISOString() },
            },
        });
        const { prisma, appStore } = createPrismaMock({
            applications: [app], users: [AUDITOR_USER, APPLICANT_USER],
        });
        const svc = loadService({ prisma, fanoutMock: makeFanoutMock() });

        const futureDate = nextWorkingDayAt(10);
        futureDate.setDate(futureDate.getDate() + 7);

        const result = await svc.requestReschedule({
            applicationId: 'app-1',
            requestedDate: futureDate.toISOString(),
            reason: 'ตรงกับฤดูเก็บเกี่ยว ขอเลื่อนการตรวจ',
            actor: ACTOR_HEALTH,
        });

        expect(result.status).toBe('PENDING');
        expect(result.rescheduleId).toBeDefined();

        const stored = appStore.get('app-1');
        expect(stored.formData.rescheduleRequests).toHaveLength(1);
        expect(stored.formData.rescheduleRequests[0].status).toBe('PENDING');
        expect(stored.formData.rescheduleRequests[0].reason).toMatch(/ฤดูเก็บเกี่ยว/);
    });

    test('rejects non-HEALTH actor', async () => {
        const app = makeApplication({ status: 'AUDIT_CONFIRMED', formData: { workflowState: 'AUDIT_CONFIRMED' } });
        const { prisma } = createPrismaMock({ applications: [app], users: [AUDITOR_USER, APPLICANT_USER] });
        const svc = loadService({ prisma, fanoutMock: makeFanoutMock() });

        const futureDate = nextWorkingDayAt(10);
        futureDate.setDate(futureDate.getDate() + 7);

        await expect(svc.requestReschedule({
            applicationId: 'app-1',
            requestedDate: futureDate.toISOString(),
            reason: 'อยากเปลี่ยนวัน',
            actor: ACTOR_SCHEDULER,
        })).rejects.toMatchObject({ code: 'FORBIDDEN_ROLE' });
    });

    test('rejects when application state is not AUDIT_CONFIRMED', async () => {
        const app = makeApplication(); // AUDIT_FEE_PAID
        const { prisma } = createPrismaMock({ applications: [app], users: [AUDITOR_USER, APPLICANT_USER] });
        const svc = loadService({ prisma, fanoutMock: makeFanoutMock() });

        const futureDate = nextWorkingDayAt(10);
        futureDate.setDate(futureDate.getDate() + 7);

        await expect(svc.requestReschedule({
            applicationId: 'app-1',
            requestedDate: futureDate.toISOString(),
            reason: 'ขอเปลี่ยนวัน',
            actor: ACTOR_HEALTH,
        })).rejects.toMatchObject({ code: 'INVALID_STATE' });
    });

    test('rejects reason that is too short', async () => {
        const app = makeApplication({ status: 'AUDIT_CONFIRMED', formData: { workflowState: 'AUDIT_CONFIRMED' } });
        const { prisma } = createPrismaMock({ applications: [app], users: [AUDITOR_USER, APPLICANT_USER] });
        const svc = loadService({ prisma, fanoutMock: makeFanoutMock() });

        const futureDate = nextWorkingDayAt(10);
        futureDate.setDate(futureDate.getDate() + 7);

        await expect(svc.requestReschedule({
            applicationId: 'app-1',
            requestedDate: futureDate.toISOString(),
            reason: 'a',
            actor: ACTOR_HEALTH,
        })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    test('rejects ownership mismatch (different healthId)', async () => {
        const app = makeApplication({
            healthId: 'health-OTHER',
            status: 'AUDIT_CONFIRMED',
            formData: { workflowState: 'AUDIT_CONFIRMED' },
        });
        const { prisma } = createPrismaMock({ applications: [app], users: [AUDITOR_USER, APPLICANT_USER] });
        const svc = loadService({ prisma, fanoutMock: makeFanoutMock() });

        const futureDate = nextWorkingDayAt(10);
        futureDate.setDate(futureDate.getDate() + 7);

        await expect(svc.requestReschedule({
            applicationId: 'app-1',
            requestedDate: futureDate.toISOString(),
            reason: 'ขอเปลี่ยนวัน',
            actor: ACTOR_HEALTH,
        })).rejects.toMatchObject({ code: 'FORBIDDEN_OWNER' });
    });
});

describe('[Iter25] audit-scheduling-service — approveReschedule', () => {
    beforeEach(() => jest.clearAllMocks());

    function setupAppWithPending(reschedId = 'r-1') {
        const scheduledAt = nextWorkingDayAt(10);
        return makeApplication({
            status: 'AUDIT_CONFIRMED',
            auditorId: 'auditor-1',
            scheduledDate: scheduledAt,
            formData: {
                workflowState: 'AUDIT_CONFIRMED',
                auditSchedule: {
                    auditorId: 'auditor-1',
                    auditorName: 'สมชาย ผู้ตรวจ',
                    scheduledDate: scheduledAt.toISOString(),
                    estimatedDuration: 120,
                },
                rescheduleRequests: [
                    {
                        id: reschedId,
                        status: 'PENDING',
                        requestedDate: nextWorkingDayAt(14).toISOString(),
                        reason: 'ขอเปลี่ยนวัน',
                        requestedAt: '2026-05-15T00:00:00.000Z',
                        previousScheduledDate: scheduledAt.toISOString(),
                        previousAuditorId: 'auditor-1',
                    },
                ],
            },
        });
    }

    test('scheduler approves PENDING reschedule with new date', async () => {
        const app = setupAppWithPending('r-1');
        const { prisma, appStore } = createPrismaMock({
            applications: [app], users: [AUDITOR_USER, APPLICANT_USER],
        });
        const svc = loadService({ prisma, fanoutMock: makeFanoutMock() });

        const newDate = nextWorkingDayAt(14);
        newDate.setDate(newDate.getDate() + 14);

        const result = await svc.approveReschedule('r-1', {
            newDate: newDate.toISOString(),
            actor: ACTOR_SCHEDULER,
        });

        expect(result.status).toBe('APPROVED');
        expect(result.scheduledDate).toBe(newDate.toISOString());

        const stored = appStore.get('app-1');
        expect(stored.scheduledDate).toEqual(newDate);
        const updatedReq = stored.formData.rescheduleRequests[0];
        expect(updatedReq.status).toBe('APPROVED');
        expect(updatedReq.approvedAt).toBeDefined();
    });

    test('rejects when reschedule already APPROVED (RESCHEDULE_NOT_PENDING)', async () => {
        const app = setupAppWithPending('r-1');
        app.formData.rescheduleRequests[0].status = 'APPROVED';
        const { prisma } = createPrismaMock({
            applications: [app], users: [AUDITOR_USER, APPLICANT_USER],
        });
        const svc = loadService({ prisma, fanoutMock: makeFanoutMock() });

        const newDate = nextWorkingDayAt(14);
        newDate.setDate(newDate.getDate() + 14);

        await expect(svc.approveReschedule('r-1', {
            newDate: newDate.toISOString(),
            actor: ACTOR_SCHEDULER,
        })).rejects.toMatchObject({ code: 'RESCHEDULE_NOT_PENDING' });
    });

    test('rejects when rescheduleId not found', async () => {
        const app = makeApplication({ status: 'AUDIT_CONFIRMED', formData: { workflowState: 'AUDIT_CONFIRMED' } });
        const { prisma } = createPrismaMock({
            applications: [app], users: [AUDITOR_USER, APPLICANT_USER],
        });
        const svc = loadService({ prisma, fanoutMock: makeFanoutMock() });

        const newDate = nextWorkingDayAt(14);
        newDate.setDate(newDate.getDate() + 14);

        await expect(svc.approveReschedule('does-not-exist', {
            newDate: newDate.toISOString(),
            actor: ACTOR_SCHEDULER,
        })).rejects.toMatchObject({ code: 'RESCHEDULE_NOT_FOUND' });
    });

    test('rejects past date as newDate', async () => {
        const app = setupAppWithPending('r-1');
        const { prisma } = createPrismaMock({
            applications: [app], users: [AUDITOR_USER, APPLICANT_USER],
        });
        const svc = loadService({ prisma, fanoutMock: makeFanoutMock() });

        const past = new Date(Date.now() - 24 * 60 * 60 * 1000);
        await expect(svc.approveReschedule('r-1', {
            newDate: past.toISOString(),
            actor: ACTOR_SCHEDULER,
        })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });
});

describe('[Iter25] audit-scheduling-service — getAuditorAvailability', () => {
    beforeEach(() => jest.clearAllMocks());

    test('returns busy slots + cap + overCapDays', async () => {
        const day = nextWorkingDayAt(10);
        const apps = [
            makeApplication({ id: 'app-1', status: 'AUDIT_CONFIRMED', auditorId: 'auditor-1', scheduledDate: day }),
            makeApplication({
                id: 'app-2',
                status: 'AUDIT_CONFIRMED',
                auditorId: 'auditor-1',
                scheduledDate: bangkokDayAt(day, 14),
            }),
        ];
        const { prisma } = createPrismaMock({ applications: apps, users: [AUDITOR_USER] });
        const svc = loadService({ prisma, fanoutMock: makeFanoutMock() });

        const from = new Date(day.getTime() - DAY_MS);
        const to = new Date(day.getTime() + 2 * DAY_MS);

        const result = await svc.getAuditorAvailability({
            auditorId: 'auditor-1',
            dateRange: { from: from.toISOString(), to: to.toISOString() },
        });
        expect(result.cap).toBe(2);
        expect(result.busySlots.length).toBe(2);
        expect(result.overCapDays.length).toBe(1); // both slots on same day → over-cap
    });

    test('rejects missing dateRange', async () => {
        const { prisma } = createPrismaMock({ applications: [], users: [] });
        const svc = loadService({ prisma, fanoutMock: makeFanoutMock() });
        await expect(svc.getAuditorAvailability({ auditorId: 'auditor-1' }))
            .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });
});

describe('[Iter25] audit-scheduling-service — getSchedulingQueue', () => {
    beforeEach(() => jest.clearAllMocks());

    test('returns AUDIT_FEE_PAID applications', async () => {
        const apps = [
            makeApplication({ id: 'a-1', status: 'AUDIT_FEE_PAID' }),
            makeApplication({
                id: 'a-2',
                status: 'AUDIT_FEE_PAID',
                applicationNumber: 'APP-2026-00002',
                healthId: 'health-200',
            }),
            // Not in queue — already confirmed
            makeApplication({ id: 'a-3', status: 'AUDIT_CONFIRMED' }),
        ];
        const { prisma } = createPrismaMock({ applications: apps, users: [] });
        const svc = loadService({ prisma, fanoutMock: makeFanoutMock() });

        const queue = await svc.getSchedulingQueue({ organizationId: 'org-1' });
        // H1 contract: { items, summary } (was a bare array). Each item carries
        // applicationId (the FE getRowKey + assign POST) — not the old bare `id`.
        expect(queue.items.length).toBe(2);
        expect(queue.items.every((row) => row.status === 'AUDIT_FEE_PAID')).toBe(true);
        expect(queue.items.every((row) => typeof row.applicationId === 'string')).toBe(true);
        expect(queue.summary.totalPending).toBe(2);
        expect(typeof queue.summary.oldestPendingDays).toBe('number');
    });
});
