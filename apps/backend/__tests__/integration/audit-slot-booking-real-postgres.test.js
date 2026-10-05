'use strict';

/**
 * Inspector slot booking on a REAL Postgres (fix round 1, MEDIUM concurrency).
 *
 * Two dispatchers booking the last slot of an inspector's day must not both succeed: the
 * availability check and the write share one Serializable transaction (runSlotBooking), so
 * PostgreSQL aborts one, and the bounded retry then hands it the real AUDITOR_OVER_CAP.
 * Also: a reassignment moves Application.auditorId and AuditChecklist.auditorId together,
 * and a failure after the first write rolls BOTH back. Skips cleanly without a migrated DB.
 */

const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');
const { describeIfTestDatabase: d } = require('../../test-support/test-database');
const { runSlotBooking, AUDITOR_MAX_PER_DAY } = require('../../services/audit-scheduling-service');
const { armOnsiteEvidence, rebindEvidenceAuditor } = require('../../services/audit/arm-onsite-evidence');

d('inspector slot booking (real Postgres)', () => {
    let raw;
    const sfx = crypto.randomUUID().slice(0, 8);
    const fx = { users: {}, apps: [] };
    // a Bangkok weekday far enough ahead that nothing else of this file's collides
    const day = (hour) => new Date(Date.UTC(2031, 2, 12, hour - 7, 0, 0));

    async function makeUser(label) {
        const id = crypto.randomUUID();
        await raw.user.create({
            data: {
                id, canonicalId: `slot-${label}-${sfx}`, password: 'x', role: 'health', authType: 'EMAIL_LEGACY',
                email: `slot-${label}-${sfx}@example.test`, firstName: 'ทดสอบ', lastName: label, organizationId: fx.org,
            },
        });
        fx.users[label] = { id, canonicalId: `slot-${label}-${sfx}` };
    }
    async function makeApp(label, extra = {}) {
        const row = await raw.application.create({
            data: {
                applicationNumber: `APP-SLOT-${label}-${sfx}`, healthId: fx.users.farmer.canonicalId, areaType: 'OUTDOOR',
                organizationId: fx.org, status: 'AUDIT_CONFIRMED', formData: {}, ...extra,
            },
        });
        fx.apps.push(row.id);
        return row.id;
    }

    beforeAll(async () => {
        raw = new PrismaClient();
        await raw.$connect();
        const org = await raw.organization.create({
            data: { name: `slot-${sfx}`, slug: `slot-${sfx}`, code: `SLOT_${sfx}`.toUpperCase() },
        });
        fx.org = org.id;
        for (const l of ['farmer', 'inspA', 'inspB']) { await makeUser(l); }
    });

    afterAll(async () => {
        await raw.auditChecklist.deleteMany({ where: { applicationId: { in: fx.apps } } });
        await raw.application.deleteMany({ where: { id: { in: fx.apps } } });
        await raw.user.deleteMany({ where: { organizationId: fx.org } });
        await raw.organization.delete({ where: { id: fx.org } });
        await raw.$disconnect();
    });

    test('two concurrent bookings for the last slot of the day: exactly one succeeds', async () => {
        const inspector = fx.users.inspA.id;
        // fill all but one slot of the day
        for (let i = 0; i < AUDITOR_MAX_PER_DAY - 1; i += 1) {
            await makeApp(`fill${i}`, { auditorId: inspector, scheduledDate: day(8 + i * 3) });
        }
        const a = await makeApp('raceA');
        const b = await makeApp('raceB');
        const book = (appId, hour) => runSlotBooking(
            raw,
            { auditorId: inspector, scheduledAt: day(hour), excludeApplicationId: appId, durationMinutes: 60 },
            async (tx) => {
                // widen the window so both transactions have read the busy set before either writes
                await new Promise((r) => setTimeout(r, 150));
                return tx.application.update({ where: { id: appId }, data: { auditorId: inspector, scheduledDate: day(hour) } });
            },
        );
        const results = await Promise.allSettled([book(a, 14), book(b, 16)]);
        const ok = results.filter((r) => r.status === 'fulfilled');
        const refused = results.filter((r) => r.status === 'rejected');
        expect(ok).toHaveLength(1);
        expect(refused).toHaveLength(1);
        expect(['AUDITOR_OVER_CAP', 'AUDITOR_SLOT_CONFLICT']).toContain(refused[0].reason.code);
        expect(refused[0].reason.statusCode).toBe(409);
        const booked = await raw.application.count({
            where: { auditorId: inspector, id: { in: fx.apps }, scheduledDate: { not: null } },
        });
        expect(booked).toBe(AUDITOR_MAX_PER_DAY);
    });

    test('reassign moves Application.auditorId and AuditChecklist.auditorId together', async () => {
        const appId = await makeApp('move', { auditorId: fx.users.inspA.id, scheduledDate: day(9) });
        await raw.$transaction((tx) => armOnsiteEvidence(tx, {
            applicationId: appId, auditorId: fx.users.inspA.id, organizationId: fx.org, createdBy: fx.users.inspA.id, inspectionMode: 'ONSITE',
        }));
        const move = (fail) => runSlotBooking(
            raw,
            { auditorId: fx.users.inspB.id, scheduledAt: day(9), excludeApplicationId: appId, durationMinutes: 60 },
            async (tx) => {
                await tx.application.update({ where: { id: appId }, data: { auditorId: fx.users.inspB.id } });
                await rebindEvidenceAuditor(tx, { applicationId: appId, auditorId: fx.users.inspB.id, actorId: null });
                if (fail) { throw new Error('boom after both writes'); }
            },
        );
        await expect(move(true)).rejects.toThrow('boom');
        let appRow = await raw.application.findUnique({ where: { id: appId }, select: { auditorId: true } });
        let chk = await raw.auditChecklist.findFirst({ where: { applicationId: appId }, select: { auditorId: true } });
        expect([appRow.auditorId, chk.auditorId]).toEqual([fx.users.inspA.id, fx.users.inspA.id]);

        await move(false);
        appRow = await raw.application.findUnique({ where: { id: appId }, select: { auditorId: true } });
        chk = await raw.auditChecklist.findFirst({ where: { applicationId: appId }, select: { auditorId: true } });
        expect([appRow.auditorId, chk.auditorId]).toEqual([fx.users.inspB.id, fx.users.inspB.id]);
    });
});
