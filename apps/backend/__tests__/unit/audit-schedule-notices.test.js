'use strict';

/**
 * Defect batch B item 4 — one Thai notification builder for both scheduling doors.
 *
 * Before: the queue door (audit-scheduling-service.assignAuditor) told only the farmer and
 * never the assigned inspector; the calendar door told both, in English, with a raw ISO
 * timestamp ("scheduled for 2026-10-12T02:00:00.000Z"). The date a Thai farmer reads is a
 * Bangkok date in the Buddhist year (business-dates rule), never a UTC instant.
 */

const path = require('path');

const NOTICES = path.resolve(__dirname, '../../services/audit/audit-schedule-notices.js');
const SERVICE = path.resolve(__dirname, '../../services/audit-scheduling-service.js');

const THAI = /[฀-๿]/;
const LATIN_WORDS = /\b(Audit|Application|assigned|scheduled|Inspection|updated|inspection)\b/;
// 2026-10-12 09:30 in Bangkok = 02:30Z
const MON_0930_BKK = new Date('2026-10-12T02:30:00.000Z');

describe('buildAuditScheduleNotices (the one builder)', () => {
    let notices;
    beforeAll(() => { notices = require(NOTICES); });

    const base = {
        applicationId: 'app-1',
        applicationNumber: 'GACP-2569-0001',
        scheduledAt: MON_0930_BKK,
        auditorName: 'สมชาย ใจดี',
        inspectionMode: 'ONSITE',
        location: 'ฟาร์มสวนสุข อ.เมือง จ.เชียงใหม่',
    };

    test('both messages are Thai, carry the application number, and print no ISO instant or English sentence', () => {
        const { farmer, inspector } = notices.buildAuditScheduleNotices(base);
        for (const n of [farmer, inspector]) {
            expect(n.title).toMatch(THAI);
            expect(n.message).toMatch(THAI);
            expect(n.message).toContain('GACP-2569-0001');
            expect(`${n.title} ${n.message}`).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
            expect(`${n.title} ${n.message}`).not.toMatch(LATIN_WORDS);
        }
    });

    test('date is the Bangkok day in the Buddhist year, time is Bangkok wall clock', () => {
        const { farmer, inspector } = notices.buildAuditScheduleNotices(base);
        for (const n of [farmer, inspector]) {
            expect(n.message).toContain('12 ตุลาคม 2569');
            expect(n.message).toContain('09:30 น.');
            expect(n.message).not.toContain('2026');
        }
    });

    test('an instant late on the UTC day that is already tomorrow in Bangkok prints the Bangkok day', () => {
        // 2026-10-12T18:30Z = 13 Oct 01:30 Bangkok
        const { farmer } = notices.buildAuditScheduleNotices({ ...base, scheduledAt: new Date('2026-10-12T18:30:00.000Z') });
        expect(farmer.message).toContain('13 ตุลาคม 2569');
        expect(farmer.message).toContain('01:30 น.');
    });

    test('the farmer is told the inspector name; the inspector is told where to go', () => {
        const { farmer, inspector } = notices.buildAuditScheduleNotices(base);
        expect(farmer.message).toContain('สมชาย ใจดี');
        expect(inspector.message).toContain('ฟาร์มสวนสุข');
    });

    test('a reschedule says it moved, and says from when', () => {
        const { farmer, inspector } = notices.buildAuditScheduleNotices({
            ...base,
            rescheduled: true,
            previousScheduledAt: new Date('2026-10-09T02:00:00.000Z'),
        });
        for (const n of [farmer, inspector]) {
            expect(n.title).toContain('เลื่อน');
            expect(n.message).toContain('9 ตุลาคม 2569');
            expect(n.message).toContain('12 ตุลาคม 2569');
        }
    });

    test('online mode names the meeting link instead of a place', () => {
        const { inspector } = notices.buildAuditScheduleNotices({
            ...base, inspectionMode: 'ONLINE_MEET', location: null, meetingLink: 'https://meet.example/abc',
        });
        expect(inspector.message).toContain('https://meet.example/abc');
    });

    test('notification data carries ids for the deep link but no raw ISO in the text', () => {
        const { farmer, inspector } = notices.buildAuditScheduleNotices(base);
        expect(farmer.data.applicationId).toBe('app-1');
        expect(inspector.data.applicationId).toBe('app-1');
    });
});

describe('notifyAuditScheduled delivers to BOTH people and never throws', () => {
    test('creates one in-app notification for the farmer and one for the inspector', async () => {
        jest.resetModules();
        const createNotification = jest.fn().mockResolvedValue({ id: 'n' });
        jest.doMock('../../services/notification-service', () => ({ createNotification }));
        const { notifyAuditScheduled } = require(NOTICES);
        await notifyAuditScheduled({
            farmerUserId: 'farmer-1',
            auditorId: 'insp-1',
            applicationId: 'app-1',
            applicationNumber: 'GACP-2569-0001',
            scheduledAt: MON_0930_BKK,
            auditorName: 'สมชาย ใจดี',
            inspectionMode: 'ONSITE',
            location: 'ฟาร์ม',
        });
        const targets = createNotification.mock.calls.map((c) => c[0].userId).sort();
        expect(targets).toEqual(['farmer-1', 'insp-1']);
    });

    test('a failing send is swallowed (the schedule has already committed)', async () => {
        jest.resetModules();
        const createNotification = jest.fn().mockRejectedValue(new Error('db down'));
        jest.doMock('../../services/notification-service', () => ({ createNotification }));
        const { notifyAuditScheduled } = require(NOTICES);
        await expect(notifyAuditScheduled({
            farmerUserId: 'farmer-1', auditorId: 'insp-1', applicationId: 'a', applicationNumber: 'X',
            scheduledAt: MON_0930_BKK, inspectionMode: 'ONSITE', location: 'ฟาร์ม',
        })).resolves.toBeDefined();
    });
});

describe('queue door (assignAuditor) uses it: the inspector is told, in Thai', () => {
    function makePrisma() {
        const app = {
            id: 'app-1', applicationNumber: 'GACP-2569-0001', status: 'AUDIT_FEE_PAID', organizationId: 'org-1',
            healthId: 'health-1', auditorId: null, scheduledDate: null, phase2Status: 'PAID',
            formData: { workflowState: 'AUDIT_FEE_PAID' }, workflowHistory: [], isDeleted: false,
        };
        const prisma = {
            application: {
                findFirst: jest.fn(async () => ({ ...app })),
                findUnique: jest.fn(async () => ({ ...app })),
                findMany: jest.fn(async () => []),
                update: jest.fn(async ({ data }) => ({ ...app, ...data })),
            },
            user: {
                findFirst: jest.fn(async ({ where }) => {
                    if (where.canonicalId) { return { id: 'farmer-1' }; }
                    return {
                        id: 'insp-1', role: 'field_inspector', firstName: 'สมชาย', lastName: 'ใจดี',
                        email: 'i@example.test', status: 'ACTIVE', organizationId: 'org-1',
                    };
                }),
            },
            auditChecklist: {
                findFirst: jest.fn(async () => null),
                create: jest.fn(async ({ data }) => ({ id: 'chk-1', ...data })),
                updateMany: jest.fn(async () => ({ count: 0 })),
            },
            $transaction: jest.fn(async (cb) => cb(prisma)),
        };
        return prisma;
    }

    test('assignAuditor notifies the assigned inspector AND the farmer, Thai, Bangkok BE date', async () => {
        jest.resetModules();
        const prisma = makePrisma();
        const createNotification = jest.fn().mockResolvedValue({ id: 'n' });
        jest.doMock('../../services/prisma-database', () => ({ prisma }));
        jest.doMock('../../services/notification-service', () => ({ createNotification }));
        jest.doMock('../../services/notification-fanout-service', () => ({ send: jest.fn().mockResolvedValue({}) }));
        jest.doMock('../../middleware/audit-logger', () => ({
            auditLogger: { log: jest.fn().mockResolvedValue(null) },
            AuditCategory: { APPLICATION: 'APPLICATION' },
            AuditSeverity: { INFO: 'INFO', WARNING: 'WARNING' },
            ResourceType: { APPLICATION: 'APPLICATION' },
        }));
        jest.doMock('../../utils/working-days', () => ({
            ...jest.requireActual('../../utils/working-days'),
            isWorkingDay: () => true,
        }));
        const service = require(SERVICE);
        const when = new Date(Date.now() + 9 * 24 * 3600 * 1000);
        await service.assignAuditor({
            applicationId: 'app-1', auditorId: 'insp-1', scheduledDate: when.toISOString(),
            location: 'ฟาร์มสวนสุข', actor: { id: 'sched-1', canonicalRole: 'dispatcher', role: 'dispatcher', organizationId: 'org-1' },
        });
        const byUser = Object.fromEntries(createNotification.mock.calls.map((c) => [c[0].userId, c[0]]));
        expect(Object.keys(byUser).sort()).toEqual(['farmer-1', 'insp-1']);
        for (const n of Object.values(byUser)) {
            expect(n.message).toMatch(THAI);
            expect(n.message).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
            expect(n.message).toMatch(/พ\.ศ\.|25\d\d|26\d\d/);
        }
    });
});

describe('the warning the calendar shows for a non-certifiable visit is plain Thai', () => {
    test('the evidenceNote names no enum value (item 2: shown to the dispatcher as the backend wrote it)', async () => {
        jest.resetModules();
        const { armOnsiteEvidence } = require('../../services/audit/arm-onsite-evidence');
        const tx = {
            auditChecklist: { findFirst: jest.fn(async () => null), update: jest.fn() },
            application: { findUnique: jest.fn(), update: jest.fn() },
        };
        const out = await armOnsiteEvidence(tx, { applicationId: 'a', auditorId: 'i', organizationId: 'o', inspectionMode: 'ONLINE_MEET' });
        expect(out.canLeadToCertificate).toBe(false);
        expect(out.reason).toMatch(/[฀-๿]/);
        expect(out.reason).not.toMatch(/ONLINE_MEET|ONSITE/);
        expect(out.reason).toContain('ออนไลน์');
        expect(out.reason).toContain('ออกใบรับรองจากการตรวจครั้งนี้ไม่ได้');
    });
});
