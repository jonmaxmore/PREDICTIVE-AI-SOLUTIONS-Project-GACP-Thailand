/**
 * Stale PENDING sweep (document-precheck final review M4) — on a REAL Postgres.
 *
 * The queue's `failed` handler closes every job Bull itself gives up on, but a
 * job lost with Redis, or the database down inside `markFailed`, leaves the
 * pre-check PENDING for ever: the applicant's card says "กำลังตรวจเอกสาร…"
 * indefinitely and the officer's row never settles. The sweep turns a row
 * PENDING for longer than 10 minutes into FAILED with the one failure flag,
 * exactly as `markFailed` would have.
 *
 * Pinned here, against the database itself:
 *   - older than the cutoff → FAILED, completedAt set, exactly one flag, the
 *     shared FAILED wording, in the row's own organisation;
 *   - younger than the cutoff, and every non-PENDING row, are untouched;
 *   - a second run changes nothing (idempotent: no second flag);
 *   - tenant-safe: rows of two organisations are both swept even when the
 *     sweep is called inside one tenant's ambient context, and each flag
 *     carries its own row's organisation.
 *
 * Seeding and read-back use a RAW PrismaClient (no extensions) so the
 * assertions are what the database holds.
 */

'use strict';

const { PrismaClient } = require('@prisma/client');
const { describeIfTestDatabase: d } = require('../../test-support/test-database');

const MINUTE = 60 * 1000;

function suffix() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

d('stale PENDING pre-check sweep (real Postgres)', () => {
    /** @type {import('@prisma/client').PrismaClient} */
    let raw;
    let sweep;
    let tenantContext;
    let PRECHECK_FAILED_TH;
    const orgs = [];
    const created = { users: [], applications: [], prechecks: [] };
    const NOW = new Date();

    beforeAll(async () => {
        raw = new PrismaClient();
        await raw.$connect();
        sweep = require('../../jobs/document-precheck-stale-sweep');
        tenantContext = require('../../services/tenant-context');
        ({ PRECHECK_FAILED_TH } = require('@gacp/validation/precheck-copy'));
        for (const label of ['A', 'B']) {
            const s = suffix();
            orgs.push(await raw.organization.create({
                data: { name: `precheck stale sweep ${label}`, slug: `pc-stale-${label.toLowerCase()}-${s}`, code: `PCSTALE${label}_${s}`.toUpperCase().slice(0, 24) },
            }));
        }
    });

    afterAll(async () => {
        if (created.prechecks.length) {
            await raw.documentPrecheckFlag.deleteMany({ where: { precheckId: { in: created.prechecks } } }).catch(() => {});
            await raw.documentPrecheck.deleteMany({ where: { id: { in: created.prechecks } } }).catch(() => {});
        }
        if (created.applications.length) {
            await raw.application.deleteMany({ where: { id: { in: created.applications } } }).catch(() => {});
        }
        if (created.users.length) {
            await raw.user.deleteMany({ where: { id: { in: created.users } } }).catch(() => {});
        }
        for (const org of orgs) {
            await raw.organization.deleteMany({ where: { id: org.id } }).catch(() => {});
        }
        await raw.$disconnect();
    });

    async function applicationIn(org) {
        const s = suffix();
        // applications.healthId references users.canonicalId, so the filing needs its owner.
        const user = await raw.user.create({
            data: {
                canonicalId: `pc-stale-canon-${s}`,
                healthId: `pc-stale-hid-${s}`,
                password: 'x',
                organizationId: org.id,
                authType: 'EMAIL_LEGACY',
                firstName: 'ทดสอบ',
                lastName: 'กวาดค้าง',
            },
        });
        created.users.push(user.id);
        const app = await raw.application.create({
            data: {
                applicationNumber: `PC-STALE-${s}`,
                healthId: user.canonicalId,
                areaType: 'OUTDOOR',
                organizationId: org.id,
                status: 'DRAFT',
            },
        });
        created.applications.push(app.id);
        return app;
    }

    async function precheck(app, { status, ageMinutes }) {
        const row = await raw.documentPrecheck.create({
            data: {
                applicationId: app.id,
                documentId: `doc-${suffix()}`,
                slotId: 'land_rights',
                status,
                rulesVersion: 1,
                organizationId: app.organizationId,
                createdAt: new Date(NOW.getTime() - ageMinutes * MINUTE),
            },
        });
        created.prechecks.push(row.id);
        return row;
    }

    const flagsOf = (id) => raw.documentPrecheckFlag.findMany({ where: { precheckId: id } });
    const rowOf = (id) => raw.documentPrecheck.findUnique({ where: { id } });

    test('the cutoff is 10 minutes, the hard ceiling 60', () => {
        expect(sweep.STALE_PENDING_AFTER_MS).toBe(10 * MINUTE);
        expect(sweep.HARD_CEILING_MS).toBe(60 * MINUTE);
    });

    test('stale PENDING → FAILED + one failure flag; fresh PENDING and settled rows untouched; tenant-safe; idempotent', async () => {
        const appA = await applicationIn(orgs[0]);
        const appB = await applicationIn(orgs[1]);
        const staleA = await precheck(appA, { status: 'PENDING', ageMinutes: 11 });
        const staleB = await precheck(appB, { status: 'PENDING', ageMinutes: 60 });
        const fresh = await precheck(appA, { status: 'PENDING', ageMinutes: 5 });
        const oldDone = await precheck(appA, { status: 'DONE', ageMinutes: 120 });
        const oldSuperseded = await precheck(appB, { status: 'SUPERSEDED', ageMinutes: 120 });

        // Called inside org A's ambient tenant context: org B's row must still be swept.
        const first = await tenantContext.runWithTenantContext(
            { organizationId: orgs[0].id },
            () => sweep.runStalePrecheckSweep({ now: NOW, queue: null }),
        );
        expect(first.failed).toBeGreaterThanOrEqual(2);
        expect(first.errors).toBe(0);

        for (const [row, org] of [[staleA, orgs[0]], [staleB, orgs[1]]]) {
            const after = await rowOf(row.id);
            expect(after.status).toBe('FAILED');
            expect(after.completedAt).not.toBeNull();
            const flags = await flagsOf(row.id);
            expect(flags).toHaveLength(1);
            expect(flags[0]).toMatchObject({
                check: 'READABILITY', result: 'UNREADABLE', reasonTH: PRECHECK_FAILED_TH, confidence: 0,
                organizationId: org.id,
            });
        }

        expect((await rowOf(fresh.id)).status).toBe('PENDING');
        expect(await flagsOf(fresh.id)).toHaveLength(0);
        expect((await rowOf(oldDone.id)).status).toBe('DONE');
        expect(await flagsOf(oldDone.id)).toHaveLength(0);
        expect((await rowOf(oldSuperseded.id)).status).toBe('SUPERSEDED');
        expect(await flagsOf(oldSuperseded.id)).toHaveLength(0);

        // Idempotent: nothing of ours is PENDING-and-stale any more.
        await sweep.runStalePrecheckSweep({ now: NOW, queue: null });
        expect(await flagsOf(staleA.id)).toHaveLength(1);
        expect(await flagsOf(staleB.id)).toHaveLength(1);
        expect((await rowOf(fresh.id)).status).toBe('PENDING');

        // The fresh row becomes stale once the clock passes the cutoff.
        await sweep.runStalePrecheckSweep({ now: new Date(NOW.getTime() + 6 * MINUTE), queue: null });
        expect((await rowOf(fresh.id)).status).toBe('FAILED');
        expect(await flagsOf(fresh.id)).toHaveLength(1);
    });

    // Fix round 1 (I1): the queue runs ONE job at a time, so a burst of ~12 uploads
    // leaves the last ones merely WAITING past 10 minutes. Between 10 and 60 minutes
    // the sweep asks Bull (job id = pre-check id) and leaves a live job alone.
    describe('asks the queue before failing a row (fix round 1, I1)', () => {
        /** A stand-in for the Bull queue: job id → state, or a getJob that throws. */
        function fakeQueue(states, { throws = false } = {}) {
            return {
                getJob: jest.fn(async (id) => {
                    if (throws) { throw new Error('Redis connection refused'); }
                    const state = states[id];
                    return state ? { id, getState: async () => state } : null;
                }),
            };
        }

        test.each([
            ['waiting', 11, 'PENDING'],
            ['active', 11, 'PENDING'],
            ['delayed', 11, 'PENDING'],
            ['completed', 11, 'FAILED'],
            ['failed', 11, 'FAILED'],
            [null, 11, 'FAILED'], // the job is missing from Redis
            ['waiting', 61, 'FAILED'], // hard ceiling: live or not
        ])('job %s at %i min → row %s', async (state, ageMinutes, expected) => {
            const app = await applicationIn(orgs[0]);
            const row = await precheck(app, { status: 'PENDING', ageMinutes });
            const queue = fakeQueue(state ? { [row.id]: state } : {});
            await sweep.runStalePrecheckSweep({ now: NOW, queue });
            expect((await rowOf(row.id)).status).toBe(expected);
            expect(await flagsOf(row.id)).toHaveLength(expected === 'FAILED' ? 1 : 0);
            if (ageMinutes < 60) {
                expect(queue.getJob).toHaveBeenCalledWith(row.id);
            }
        });

        test('the queue cannot answer (getJob throws) → FAILED, and the sweep reports no error', async () => {
            const app = await applicationIn(orgs[1]);
            const row = await precheck(app, { status: 'PENDING', ageMinutes: 11 });
            const stats = await sweep.runStalePrecheckSweep({ now: NOW, queue: fakeQueue({}, { throws: true }) });
            expect((await rowOf(row.id)).status).toBe('FAILED');
            expect(await flagsOf(row.id)).toHaveLength(1);
            expect(stats.errors).toBe(0);
        });

        test('no queue at all (not initialised) → FAILED', async () => {
            const app = await applicationIn(orgs[1]);
            const row = await precheck(app, { status: 'PENDING', ageMinutes: 11 });
            await sweep.runStalePrecheckSweep({ now: NOW, queue: null });
            expect((await rowOf(row.id)).status).toBe('FAILED');
        });

        test('a live job is counted as such, not as failed', async () => {
            const app = await applicationIn(orgs[0]);
            const row = await precheck(app, { status: 'PENDING', ageMinutes: 30 });
            const stats = await sweep.runStalePrecheckSweep({ now: NOW, queue: fakeQueue({ [row.id]: 'waiting' }) });
            expect(stats.live).toBeGreaterThanOrEqual(1);
            expect((await rowOf(row.id)).status).toBe('PENDING');
            // leave nothing PENDING for the next test's sweep to count
            await sweep.runStalePrecheckSweep({ now: NOW, queue: null });
        });
    });
});
