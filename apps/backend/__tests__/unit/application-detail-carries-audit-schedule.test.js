'use strict';

/**
 * Defect batch B item 8 (farmer side): once the visit is booked (AUDIT_CONFIRMED) the farmer's
 * application detail must be able to show WHEN and WHO. buildApplicationDetailPayload is a
 * whitelist and carried neither scheduledDate nor the inspector, so the page had nothing to
 * show ("select gap": the column exists, the payload never asks).
 *
 * Only an application whose visit is booked carries the block; nothing else about the
 * inspector (id, email, phone) leaves the server, only the name the farmer is already sent in
 * the booking notification.
 */

const { buildApplicationDetailPayload } = require('../../routes/api/helpers/application-payload-builders');

const WHEN = new Date('2026-10-12T02:30:00.000Z');
const base = (over = {}) => ({
    id: 'app-1', applicationNumber: 'GACP-2569-0001', healthId: 'h', status: 'AUDIT_CONFIRMED',
    formData: { workflowState: 'AUDIT_CONFIRMED', auditSchedule: { inspectionMode: 'ONSITE', auditorName: 'ชื่อเก่า ในสำเนา' } },
    workflowHistory: [], comments: [],
    scheduledDate: WHEN, auditorId: 'insp-1', auditor: { firstName: 'สมชาย', lastName: 'ใจดี', email: 'secret@example.test' },
    createdAt: new Date(), updatedAt: new Date(),
    ...over,
});

describe('buildApplicationDetailPayload: the booked visit', () => {
    test('AUDIT_CONFIRMED carries date, mode and the inspector name (joined name wins over the stored copy)', () => {
        const out = buildApplicationDetailPayload(base());
        expect(out.auditSchedule).toEqual({
            scheduledDate: WHEN.toISOString(),
            inspectionMode: 'ONSITE',
            auditorName: 'สมชาย ใจดี',
            meetingLink: null,
        });
    });

    test('nothing else about the inspector is sent', () => {
        const json = JSON.stringify(buildApplicationDetailPayload(base()));
        expect(json).not.toContain('secret@example.test');
        expect(json).not.toContain('insp-1');
    });

    test('with no joined user the stored name is used', () => {
        const out = buildApplicationDetailPayload(base({ auditor: null }));
        expect(out.auditSchedule.auditorName).toBe('ชื่อเก่า ในสำเนา');
    });

    test('an online visit carries its meeting link', () => {
        const out = buildApplicationDetailPayload(base({
            formData: { workflowState: 'AUDIT_CONFIRMED', auditSchedule: { inspectionMode: 'ONLINE_MEET', meetingLink: 'https://meet.example/x' } },
        }));
        expect(out.auditSchedule.meetingLink).toBe('https://meet.example/x');
    });

    test('before the visit is booked there is no block', () => {
        expect(buildApplicationDetailPayload(base({ status: 'AUDIT_FEE_PAID', formData: { workflowState: 'AUDIT_FEE_PAID' }, scheduledDate: null, auditorId: null, auditor: null })).auditSchedule).toBeNull();
    });

    test('a booked state with no date has no block rather than a 1970 one', () => {
        expect(buildApplicationDetailPayload(base({ scheduledDate: null })).auditSchedule).toBeNull();
    });
});
