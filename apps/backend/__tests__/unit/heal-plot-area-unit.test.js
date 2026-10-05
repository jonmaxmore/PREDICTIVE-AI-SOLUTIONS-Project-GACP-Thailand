/**
 * heal-plot-area-unit.js — pure decision/assert logic + apply-path payload
 * shape, exercised with prisma stubbed (sibling pattern:
 * __tests__/unit/atomic-decision-letter.test.js:214-221 —
 * jest.mock('../../services/prisma-database', () => ({ prisma: {...} }))).
 *
 * Council scope table (design note 2026-08-19-plot-areaunit-fix-design
 * Part B) is encoded as REFUSAL guards here — every one is a hard requirement:
 *   1. dry-run by default; --apply required to write; dry-run writes nothing
 *   2. --reason and --source are both required
 *   3. --unit must be in the closed LEGACY_UNIT_TO_SQM enum, case-insensitive
 *   4. a plot that already HAS a unit is refused — no overwrite path
 *   5. integrity assert aborts if anything besides the one areaUnit key would change
 *   6. apply path writes formData + workflowHistory + audit_logs in one transaction
 *
 * Review finding 2026-08-19 (CRITICAL, lost-update race) added a 7th layer,
 * covered in the "row lock / no-lost-update" describe block below: the apply
 * path reads NOTHING outside the transaction — it locks the row
 * (`SELECT ... FOR UPDATE`) first, re-reads only after the lock, guards the
 * write with an updatedAt-scoped updateMany, and re-reads once more after the
 * write to verify what actually landed.
 */

'use strict';

// Outside (unlocked) prisma.application.findFirst — the dry-run path's ONLY
// read. The apply path must NEVER call this: that is the exact bug the
// review finding named (building the write from a pre-transaction snapshot
// that a concurrent webhook writer could have raced past).
const mockFindFirst = jest.fn();
const mockTransaction = jest.fn();
const mockDisconnect = jest.fn(async () => undefined);

// tx-scoped mocks — everything the apply path is allowed to read/write lives
// inside prisma.$transaction(async (tx) => ...), so these are handed to the
// callback via mockTransaction's implementation (set per-describe-block below).
const mockQueryRaw = jest.fn();
const mockTxFindFirst = jest.fn();
const mockTxUpdateMany = jest.fn();

jest.mock('../../services/prisma-database', () => ({
    prisma: {
        application: {
            findFirst: (...args) => mockFindFirst(...args),
        },
        $transaction: (...args) => mockTransaction(...args),
        $disconnect: (...args) => mockDisconnect(...args),
    },
}));

const mockLogWithin = jest.fn(async () => ({ id: 'audit-1' }));

jest.mock('../../middleware/audit-logger', () => ({
    auditLogger: { logWithin: (...args) => mockLogWithin(...args) },
    AuditCategory: { ADMIN: 'ADMIN', APPLICATION: 'APPLICATION' },
    AuditSeverity: { INFO: 'INFO' },
    ResourceType: { APPLICATION: 'APPLICATION' },
}));

const heal = require('../../../../scripts/maintenance/heal-plot-area-unit');

const BASE_ARGS = Object.freeze({
    app: 'app-1',
    plot: '0',
    unit: 'Sqm',
    reason: 'operator confirmed via land deed',
    source: 'หนังสือรับรองที่ดิน เลขที่ 123/2569',
});

function argvFrom(overrides = {}, omit = []) {
    const merged = { ...BASE_ARGS, ...overrides };
    const argv = [];
    for (const [key, value] of Object.entries(merged)) {
        if (omit.includes(key)) { continue; }
        argv.push(`--${key}`, value);
    }
    return argv;
}

// Farm target: formData.farmData is singular (no --plot selector). Omits
// --plot by default; a caller that specifically wants to exercise the
// "--plot passed with --target farm" refusal uses argvFrom({ target: 'farm' })
// directly instead (BASE_ARGS already carries --plot 0).
function farmArgvFrom(overrides = {}, omit = []) {
    return argvFrom({ target: 'farm', ...overrides }, ['plot', ...omit]);
}

describe('heal-plot-area-unit — CLI arg guards', () => {
    test('missing --reason refuses', () => {
        expect(() => heal.parseArgs(argvFrom({}, ['reason']))).toThrow(/--reason/);
    });

    test('missing --source refuses', () => {
        expect(() => heal.parseArgs(argvFrom({}, ['source']))).toThrow(/--source/);
    });

    test('missing --app refuses', () => {
        expect(() => heal.parseArgs(argvFrom({}, ['app']))).toThrow(/--app/);
    });

    test('unit outside the closed enum refuses', () => {
        expect(() => heal.parseArgs(argvFrom({ unit: 'ไร่ครึ่ง' })))
            .toThrow(/ไร่ครึ่ง/);
    });

    test('unit is validated case-insensitively — UI casing "Sqm" passes', () => {
        const parsed = heal.parseArgs(argvFrom({ unit: 'Sqm' }));
        expect(parsed.unit).toBe('Sqm');
    });

    test('unit "RAI" (uppercase) passes case-insensitive enum check', () => {
        expect(() => heal.parseArgs(argvFrom({ unit: 'RAI' }))).not.toThrow();
    });

    test('--app with a wildcard/comma batch refuses (no batch mode)', () => {
        expect(() => heal.parseArgs(argvFrom({ app: 'app-1,app-2' }))).toThrow(/wildcard|batch|one/i);
    });

    test('dry-run by default; --apply required to write', () => {
        const parsed = heal.parseArgs(argvFrom());
        expect(parsed.apply).toBe(false);
        const applied = heal.parseArgs([...argvFrom(), '--apply']);
        expect(applied.apply).toBe(true);
    });

    test('actor falls back to OS user when --actor is absent', () => {
        const parsed = heal.parseArgs(argvFrom(), { getOsUser: () => 'os-user-x' });
        expect(parsed.actor).toBe('os-user-x');
    });

    test('--actor overrides the OS-user fallback', () => {
        const parsed = heal.parseArgs([...argvFrom(), '--actor', 'operator-jane'], { getOsUser: () => 'os-user-x' });
        expect(parsed.actor).toBe('operator-jane');
    });

    test('--target defaults to "plot" — existing CLI behavior byte-identical', () => {
        const parsed = heal.parseArgs(argvFrom());
        expect(parsed.target).toBe('plot');
    });

    test('unrecognized --target value refuses', () => {
        expect(() => heal.parseArgs(argvFrom({ target: 'bogus' }, ['plot'])))
            .toThrow(/--target/);
    });

    test('--target farm with --plot passed refuses (formData.farmData is singular)', () => {
        expect(() => heal.parseArgs(argvFrom({ target: 'farm' })))
            .toThrow(/--plot.*farm|singular/i);
    });

    test('--target farm without --plot parses cleanly', () => {
        const parsed = heal.parseArgs(farmArgvFrom());
        expect(parsed.target).toBe('farm');
        expect(parsed.plotSelector).toBeUndefined();
    });
});

describe('heal-plot-area-unit — plot resolution', () => {
    const plots = [
        { name: 'แปลงที่ 1', areaSize: 1000 },
        { name: 'แปลงที่ 2', areaSize: 2000, areaUnit: 'sqm' },
    ];

    test('resolves by numeric index', () => {
        expect(heal.resolvePlotIndex(plots, '0')).toBe(0);
        expect(heal.resolvePlotIndex(plots, '1')).toBe(1);
    });

    test('resolves by exact plot name', () => {
        expect(heal.resolvePlotIndex(plots, 'แปลงที่ 2')).toBe(1);
    });

    test('out-of-range index refuses', () => {
        expect(() => heal.resolvePlotIndex(plots, '5')).toThrow(/range/);
    });

    test('unknown plot name refuses', () => {
        expect(() => heal.resolvePlotIndex(plots, 'ไม่มีแปลงนี้')).toThrow(/no plot/i);
    });

    test('ambiguous plot name refuses', () => {
        const dup = [{ name: 'x' }, { name: 'x' }];
        expect(() => heal.resolvePlotIndex(dup, 'x')).toThrow(/ambiguous/i);
    });
});

describe('heal-plot-area-unit — overwrite guard', () => {
    test('plot already has a unit refuses — no overwrite path', () => {
        const plot = { name: 'p', areaUnit: 'rai' };
        expect(() => heal.assertPlotUnitAbsent(plot, 0)).toThrow(/already has areaUnit/);
    });

    test('plot with empty-string unit is treated as absent (healable)', () => {
        const plot = { name: 'p', areaUnit: '   ' };
        expect(() => heal.assertPlotUnitAbsent(plot, 0)).not.toThrow();
    });

    test('plot with no areaUnit key is healable', () => {
        expect(() => heal.assertPlotUnitAbsent({ name: 'p' }, 0)).not.toThrow();
    });
});

describe('heal-plot-area-unit — farm resolution guard', () => {
    test('application with no formData.farmData refuses', () => {
        expect(() => heal.resolveHeal({ formData: {} }, { target: 'farm', unit: 'sqm' }))
            .toThrow(/farmData/i);
    });

    test('application with formData.farmData present resolves without error', () => {
        const app = { formData: { farmData: { totalAreaSize: 1000 } } };
        expect(() => heal.resolveHeal(app, { target: 'farm', unit: 'sqm' })).not.toThrow();
    });
});

describe('heal-plot-area-unit — farm overwrite guard', () => {
    test('farm already has a unit refuses — no overwrite path', () => {
        const farmData = { totalAreaSize: 1000, totalAreaUnit: 'rai' };
        expect(() => heal.assertFarmUnitAbsent(farmData)).toThrow(/already has totalAreaUnit/);
    });

    test('farm with empty-string unit is treated as absent (healable)', () => {
        const farmData = { totalAreaSize: 1000, totalAreaUnit: '   ' };
        expect(() => heal.assertFarmUnitAbsent(farmData)).not.toThrow();
    });

    test('farm with no totalAreaUnit key is healable', () => {
        expect(() => heal.assertFarmUnitAbsent({ totalAreaSize: 1000 })).not.toThrow();
    });
});

describe('heal-plot-area-unit — integrity assertion', () => {
    const oldFormData = Object.freeze({
        plots: [{ name: 'แปลง 1', areaSize: 1000 }],
        auditResult: 'PASS',
        serverRequirementSnapshot: { v: 1 },
        gpsLat: '13.7',
        gpsLng: '100.5',
    });

    test('clean single-key write passes', () => {
        const newFormData = heal.computeHealedFormData(oldFormData, 0, 'sqm');
        expect(() => heal.assertOnlyAreaUnitChanged(oldFormData, newFormData, 0, 'sqm')).not.toThrow();
        expect(newFormData.plots[0].areaUnit).toBe('sqm');
    });

    test('dry-run leaves the source object byte-identical (pin)', () => {
        const before = JSON.stringify(oldFormData);
        heal.computeHealedFormData(oldFormData, 0, 'sqm');
        expect(JSON.stringify(oldFormData)).toBe(before);
    });

    test('aborts when a server-owned key besides areaUnit would change', () => {
        const tampered = heal.computeHealedFormData(oldFormData, 0, 'sqm');
        tampered.auditResult = 'FAIL';
        expect(() => heal.assertOnlyAreaUnitChanged(oldFormData, tampered, 0, 'sqm'))
            .toThrow(/auditResult/);
    });

    test('aborts when areaSize would change', () => {
        const tampered = heal.computeHealedFormData(oldFormData, 0, 'sqm');
        tampered.plots[0].areaSize = 9999;
        expect(() => heal.assertOnlyAreaUnitChanged(oldFormData, tampered, 0, 'sqm'))
            .toThrow(/areaSize/);
    });

    test('aborts when GPS would change', () => {
        const tampered = heal.computeHealedFormData(oldFormData, 0, 'sqm');
        tampered.gpsLat = '0';
        expect(() => heal.assertOnlyAreaUnitChanged(oldFormData, tampered, 0, 'sqm'))
            .toThrow(/gpsLat/);
    });
});

describe('heal-plot-area-unit — farm integrity assertion', () => {
    const oldFormData = Object.freeze({
        farmData: { totalAreaSize: 1000, farmName: 'ไร่ทดสอบ' },
        auditResult: 'PASS',
        serverRequirementSnapshot: { v: 1 },
        gpsLat: '13.7',
        gpsLng: '100.5',
    });

    test('clean single-key write passes', () => {
        const newFormData = heal.computeHealedFarmFormData(oldFormData, 'sqm');
        expect(() => heal.assertOnlyFarmAreaUnitChanged(oldFormData, newFormData, 'sqm')).not.toThrow();
        expect(newFormData.farmData.totalAreaUnit).toBe('sqm');
    });

    test('dry-run leaves the source object byte-identical (pin)', () => {
        const before = JSON.stringify(oldFormData);
        heal.computeHealedFarmFormData(oldFormData, 'sqm');
        expect(JSON.stringify(oldFormData)).toBe(before);
    });

    test('aborts when a server-owned key besides totalAreaUnit would change', () => {
        const tampered = heal.computeHealedFarmFormData(oldFormData, 'sqm');
        tampered.auditResult = 'FAIL';
        expect(() => heal.assertOnlyFarmAreaUnitChanged(oldFormData, tampered, 'sqm'))
            .toThrow(/auditResult/);
    });

    test('aborts when totalAreaSize would change', () => {
        const tampered = heal.computeHealedFarmFormData(oldFormData, 'sqm');
        tampered.farmData.totalAreaSize = 9999;
        expect(() => heal.assertOnlyFarmAreaUnitChanged(oldFormData, tampered, 'sqm'))
            .toThrow(/totalAreaSize/);
    });

    test('aborts when GPS would change', () => {
        const tampered = heal.computeHealedFarmFormData(oldFormData, 'sqm');
        tampered.gpsLat = '0';
        expect(() => heal.assertOnlyFarmAreaUnitChanged(oldFormData, tampered, 'sqm'))
            .toThrow(/gpsLat/);
    });
});

describe('heal-plot-area-unit — fixed audit text + event builders', () => {
    test('exact required Thai note is present in both builders', () => {
        const EXPECTED = 'แก้ metadata หน่วยพื้นที่ — ไม่ใช่การตรวจซ้ำพื้นที่จริงหรือหลักฐานภาคสนาม';
        expect(heal.FIXED_AUDIT_NOTE_TH).toBe(EXPECTED);

        const wf = heal.buildHealWorkflowEvent({
            plotIndex: 0, plotName: 'p', previousUnit: null, unit: 'sqm',
            actor: 'op', actorRole: 'MAINTENANCE_SCRIPT', reason: 'r', source: 's',
        });
        expect(JSON.stringify(wf)).toContain(EXPECTED);

        const ev = heal.buildHealAuditEvent({
            applicationId: 'app-1', plotIndex: 0, plotName: 'p', previousUnit: null, unit: 'sqm',
            actor: 'op', actorRole: 'MAINTENANCE_SCRIPT', reason: 'r', source: 's',
            organizationId: 'org-1', applicationStatus: 'AUDIT_CONFIRMED',
        });
        expect(JSON.stringify(ev)).toContain(EXPECTED);
    });

    test('workflow event carries applicationId, plot index/name, before->after, actor, reason, source', () => {
        const wf = heal.buildHealWorkflowEvent({
            plotIndex: 2, plotName: 'แปลง C', previousUnit: null, unit: 'rai',
            actor: 'operator-jane', actorRole: 'MAINTENANCE_SCRIPT',
            reason: 'land deed re-check', source: 'deed 456', applicationId: 'app-9',
        });
        expect(wf.action).toBe('PLOT_AREA_UNIT_HEALED');
        expect(wf.actorId).toBe('operator-jane');
        expect(wf.comment).toBe('land deed re-check');
        expect(wf.metadata.plotIndex).toBe(2);
        expect(wf.metadata.plotName).toBe('แปลง C');
        expect(wf.metadata.areaUnit).toEqual({ before: null, after: 'rai' });
        expect(wf.metadata.source).toBe('deed 456');
        expect(wf.metadata.applicationId).toBe('app-9');
    });

    test('audit event carries the same fields plus resourceId/organizationId', () => {
        const ev = heal.buildHealAuditEvent({
            applicationId: 'app-9', plotIndex: 2, plotName: 'แปลง C', previousUnit: null, unit: 'rai',
            actor: 'operator-jane', actorRole: 'MAINTENANCE_SCRIPT',
            reason: 'land deed re-check', source: 'deed 456',
            organizationId: 'org-1', applicationStatus: 'AUDIT_CONFIRMED',
        });
        expect(ev.action).toBe('PLOT_AREA_UNIT_HEALED');
        expect(ev.resourceId).toBe('app-9');
        expect(ev.organizationId).toBe('org-1');
        expect(ev.actorId).toBe('operator-jane');
        expect(ev.metadata.reason).toBe('land deed re-check');
        expect(ev.metadata.source).toBe('deed 456');
        expect(ev.metadata.areaUnit).toEqual({ before: null, after: 'rai' });
        // NEVER touches status — only reads/logs it.
        expect(ev.metadata.applicationStatusAtHeal).toBe('AUDIT_CONFIRMED');
    });
});

describe('heal-plot-area-unit — farm fixed audit text + event builders', () => {
    test('exact required Thai note is present in both farm builders', () => {
        const EXPECTED = 'แก้ metadata หน่วยพื้นที่ — ไม่ใช่การตรวจซ้ำพื้นที่จริงหรือหลักฐานภาคสนาม';
        expect(heal.FIXED_AUDIT_NOTE_TH).toBe(EXPECTED);

        const wf = heal.buildFarmHealWorkflowEvent({
            previousUnit: null, unit: 'sqm',
            actor: 'op', actorRole: 'MAINTENANCE_SCRIPT', reason: 'r', source: 's',
        });
        expect(JSON.stringify(wf)).toContain(EXPECTED);

        const ev = heal.buildFarmHealAuditEvent({
            applicationId: 'app-1', previousUnit: null, unit: 'sqm',
            actor: 'op', actorRole: 'MAINTENANCE_SCRIPT', reason: 'r', source: 's',
            organizationId: 'org-1', applicationStatus: 'AUDIT_CONFIRMED',
        });
        expect(JSON.stringify(ev)).toContain(EXPECTED);
    });

    test('farm workflow event carries applicationId, before->after, actor, reason, source (no plotIndex/plotName)', () => {
        const wf = heal.buildFarmHealWorkflowEvent({
            previousUnit: null, unit: 'rai',
            actor: 'operator-jane', actorRole: 'MAINTENANCE_SCRIPT',
            reason: 'land deed re-check', source: 'deed 456', applicationId: 'app-9',
        });
        expect(wf.action).toBe('FARM_AREA_UNIT_HEALED');
        expect(wf.actorId).toBe('operator-jane');
        expect(wf.comment).toBe('land deed re-check');
        expect(wf.metadata.areaUnit).toEqual({ before: null, after: 'rai' });
        expect(wf.metadata.source).toBe('deed 456');
        expect(wf.metadata.applicationId).toBe('app-9');
        expect(wf.metadata.plotIndex).toBeUndefined();
        expect(wf.metadata.plotName).toBeUndefined();
    });

    test('farm audit event carries the same fields plus resourceId/organizationId', () => {
        const ev = heal.buildFarmHealAuditEvent({
            applicationId: 'app-9', previousUnit: null, unit: 'rai',
            actor: 'operator-jane', actorRole: 'MAINTENANCE_SCRIPT',
            reason: 'land deed re-check', source: 'deed 456',
            organizationId: 'org-1', applicationStatus: 'AUDIT_CONFIRMED',
        });
        expect(ev.action).toBe('FARM_AREA_UNIT_HEALED');
        expect(ev.resourceId).toBe('app-9');
        expect(ev.organizationId).toBe('org-1');
        expect(ev.actorId).toBe('operator-jane');
        expect(ev.metadata.reason).toBe('land deed re-check');
        expect(ev.metadata.source).toBe('deed 456');
        expect(ev.metadata.areaUnit).toEqual({ before: null, after: 'rai' });
        // NEVER touches status — only reads/logs it.
        expect(ev.metadata.applicationStatusAtHeal).toBe('AUDIT_CONFIRMED');
    });
});

describe('heal-plot-area-unit — CLI main(): dry-run vs apply, transaction shape', () => {
    const realArgv = process.argv;

    // Builds the tx handed to prisma.$transaction's callback. `$queryRaw` is
    // called as a TAGGED TEMPLATE (`` tx.$queryRaw`...FOR UPDATE` ``) — any
    // plain function works as a tag (called with (strings, ...values)).
    function txStub() {
        return {
            $queryRaw: (...args) => mockQueryRaw(...args),
            application: {
                findFirst: (...args) => mockTxFindFirst(...args),
                updateMany: (...args) => mockTxUpdateMany(...args),
            },
            auditLog: { create: jest.fn() },
        };
    }

    beforeEach(() => {
        jest.clearAllMocks();
        mockTransaction.mockImplementation(async (cb) => cb(txStub()));
        mockTxUpdateMany.mockResolvedValue({ count: 1 });
    });

    afterEach(() => {
        process.exitCode = undefined;
        process.argv = realArgv;
    });

    const application = {
        id: 'app-1',
        applicationNumber: 'GACP-0001',
        status: 'AUDIT_CONFIRMED',
        organizationId: 'org-1',
        formData: { plots: [{ name: 'p1', areaSize: 100 }] },
        workflowHistory: [],
        updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    };

    /**
     * Wires the tx-locked read (1st findFirst call) to `app`, and makes the
     * updateMany call ECHO exactly what it was asked to write back out as the
     * post-write-verify re-read (2nd findFirst call) — i.e. a faithful stand-in
     * for "the DB now holds exactly what was written", the same thing a real
     * Postgres round-trip would produce. This is what every HAPPY-PATH /
     * RACE test uses; the verification-MISMATCH test below deliberately does
     * NOT use this helper (it hand-crafts a re-read that disagrees).
     */
    function mockApplyRoundTrip(app) {
        mockQueryRaw.mockResolvedValueOnce([{ id: app.id }]);
        mockTxFindFirst.mockResolvedValueOnce(app);
        mockTxUpdateMany.mockImplementationOnce(async ({ data }) => {
            mockTxFindFirst.mockResolvedValueOnce({ ...app, formData: data.formData, workflowHistory: data.workflowHistory });
            return { count: 1 };
        });
    }

    describe('dry-run — unlocked, read-only', () => {
        test('reads the app via the OUTSIDE (unlocked) read; never opens a transaction, locks, or logs audit', async () => {
            mockFindFirst.mockResolvedValueOnce(application);
            process.argv = ['node', 'heal-plot-area-unit.js', ...argvFrom()];

            await heal.__runCli();

            expect(mockFindFirst).toHaveBeenCalledTimes(1);
            expect(mockTransaction).not.toHaveBeenCalled();
            expect(mockQueryRaw).not.toHaveBeenCalled();
            expect(mockTxUpdateMany).not.toHaveBeenCalled();
            expect(mockLogWithin).not.toHaveBeenCalled();
            expect(process.exitCode).toBe(0);
        });
    });

    describe('apply — row lock / no-lost-update (review finding 2026-08-19)', () => {
        test('never touches the OUTSIDE (unlocked) read — every read for apply goes through tx', async () => {
            mockApplyRoundTrip(application);
            process.argv = ['node', 'heal-plot-area-unit.js', ...argvFrom(), '--apply'];

            await heal.__runCli();

            expect(mockFindFirst).not.toHaveBeenCalled();
            expect(process.exitCode).toBe(0);
        });

        test('locks the row (SELECT ... FOR UPDATE) before any tx read', async () => {
            mockApplyRoundTrip(application);
            process.argv = ['node', 'heal-plot-area-unit.js', ...argvFrom(), '--apply'];

            await heal.__runCli();

            expect(mockQueryRaw).toHaveBeenCalledTimes(1);
            const [strings] = mockQueryRaw.mock.calls[0];
            expect(strings.join(' ')).toMatch(/FOR UPDATE/);
            expect(process.exitCode).toBe(0);
        });

        test('writes formData + workflowHistory via updateMany guarded by the tx-read updatedAt, then audit_logs, then verifies — all inside one transaction', async () => {
            mockApplyRoundTrip(application);
            process.argv = ['node', 'heal-plot-area-unit.js', ...argvFrom(), '--apply'];

            await heal.__runCli();

            expect(mockTransaction).toHaveBeenCalledTimes(1);
            expect(mockTxUpdateMany).toHaveBeenCalledTimes(1);
            const updateArgs = mockTxUpdateMany.mock.calls[0][0];
            expect(updateArgs.where).toEqual({ id: 'app-1', updatedAt: application.updatedAt });
            expect(updateArgs.data.formData.plots[0].areaUnit).toBe('Sqm');
            expect(updateArgs.data.workflowHistory).toHaveLength(1);
            expect(updateArgs.data.workflowHistory[0].action).toBe('PLOT_AREA_UNIT_HEALED');
            // NEVER changes status; NEVER calls generateCertificate.
            expect(updateArgs.data.status).toBeUndefined();

            expect(mockLogWithin).toHaveBeenCalledTimes(1);
            const [auditEvent] = mockLogWithin.mock.calls[0];
            expect(auditEvent.resourceId).toBe('app-1');
            expect(auditEvent.organizationId).toBe('org-1');

            // Post-write verify re-read happened (2nd tx findFirst call).
            expect(mockTxFindFirst).toHaveBeenCalledTimes(2);
            expect(process.exitCode).toBe(0);
        });

        test('RACE: a concurrent write (e.g. the payment-webhook status writer) landing between "operator looked" and the lock is preserved, not overwritten — the write is built from the TX-locked read, not any earlier snapshot', async () => {
            // No outside snapshot is even configured — proving the apply path
            // cannot possibly use one. The tx-locked read reflects a plot that is
            // STILL healable but ALREADY carries one workflowHistory entry a
            // concurrent transition appended before our lock was granted.
            const raced = {
                ...application,
                workflowHistory: [{ action: 'PHASE_1_PAYMENT_CREATED', note: 'concurrent webhook transition' }],
                updatedAt: new Date('2026-08-01T00:05:00.000Z'), // bumped by the concurrent write
            };
            mockApplyRoundTrip(raced);
            process.argv = ['node', 'heal-plot-area-unit.js', ...argvFrom(), '--apply'];

            await heal.__runCli();

            expect(mockFindFirst).not.toHaveBeenCalled(); // stale outside data never consulted
            const updateArgs = mockTxUpdateMany.mock.calls[0][0];
            // The updatedAt guard matches the RACED (fresh) value, not the original.
            expect(updateArgs.where.updatedAt).toEqual(raced.updatedAt);
            // The concurrent entry survives; ours is appended after it — nothing lost.
            expect(updateArgs.data.workflowHistory).toHaveLength(2);
            expect(updateArgs.data.workflowHistory[0].action).toBe('PHASE_1_PAYMENT_CREATED');
            expect(updateArgs.data.workflowHistory[1].action).toBe('PLOT_AREA_UNIT_HEALED');
            expect(process.exitCode).toBe(0);
        });

        test('updateMany count 0 (updatedAt guard tripped) aborts — no audit write, non-zero exit', async () => {
            mockQueryRaw.mockResolvedValueOnce([{ id: 'app-1' }]);
            mockTxFindFirst.mockResolvedValueOnce(application);
            mockTxUpdateMany.mockResolvedValueOnce({ count: 0 });
            process.argv = ['node', 'heal-plot-area-unit.js', ...argvFrom(), '--apply'];

            await heal.__runCli();

            expect(mockLogWithin).not.toHaveBeenCalled();
            expect(process.exitCode).not.toBe(0);
        });

        test('post-write verification mismatch aborts (pin: written row does not match intent) — non-zero exit', async () => {
            mockQueryRaw.mockResolvedValueOnce([{ id: 'app-1' }]);
            mockTxFindFirst
                .mockResolvedValueOnce(application) // post-lock read
                .mockResolvedValueOnce({ ...application, formData: { plots: [{ name: 'p1', areaSize: 100 }] } }); // post-write re-read: areaUnit missing — mismatch
            process.argv = ['node', 'heal-plot-area-unit.js', ...argvFrom(), '--apply'];

            await heal.__runCli();

            expect(process.exitCode).not.toBe(0);
        });

        test('application not found (lock query returns no row) refuses with non-zero exit', async () => {
            mockQueryRaw.mockResolvedValueOnce([]);
            process.argv = ['node', 'heal-plot-area-unit.js', ...argvFrom(), '--apply'];

            await heal.__runCli();

            expect(mockTxFindFirst).not.toHaveBeenCalled();
            expect(mockTxUpdateMany).not.toHaveBeenCalled();
            expect(process.exitCode).not.toBe(0);
        });

        test('plot already has a unit (as read under the lock) refuses with non-zero exit and no write', async () => {
            mockQueryRaw.mockResolvedValueOnce([{ id: 'app-1' }]);
            mockTxFindFirst.mockResolvedValueOnce({
                ...application,
                formData: { plots: [{ name: 'p1', areaSize: 100, areaUnit: 'rai' }] },
            });
            process.argv = ['node', 'heal-plot-area-unit.js', ...argvFrom(), '--apply'];

            await heal.__runCli();

            expect(mockTxUpdateMany).not.toHaveBeenCalled();
            expect(mockLogWithin).not.toHaveBeenCalled();
            expect(process.exitCode).not.toBe(0);
        });
    });
});

describe('heal-plot-area-unit — CLI main() --target farm: dry-run vs apply, transaction shape', () => {
    const realArgv = process.argv;

    // Same tx-stub shape as the plot describe block above (kept independent so
    // this block cannot silently start relying on plot fixtures).
    function txStub() {
        return {
            $queryRaw: (...args) => mockQueryRaw(...args),
            application: {
                findFirst: (...args) => mockTxFindFirst(...args),
                updateMany: (...args) => mockTxUpdateMany(...args),
            },
            auditLog: { create: jest.fn() },
        };
    }

    beforeEach(() => {
        jest.clearAllMocks();
        mockTransaction.mockImplementation(async (cb) => cb(txStub()));
        mockTxUpdateMany.mockResolvedValue({ count: 1 });
    });

    afterEach(() => {
        process.exitCode = undefined;
        process.argv = realArgv;
    });

    const farmApplication = {
        id: 'app-1',
        applicationNumber: 'GACP-0001',
        status: 'AUDIT_CONFIRMED',
        organizationId: 'org-1',
        formData: { farmData: { totalAreaSize: 1000, farmName: 'ไร่ทดสอบ' } },
        workflowHistory: [],
        updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    };

    function mockApplyRoundTrip(app) {
        mockQueryRaw.mockResolvedValueOnce([{ id: app.id }]);
        mockTxFindFirst.mockResolvedValueOnce(app);
        mockTxUpdateMany.mockImplementationOnce(async ({ data }) => {
            mockTxFindFirst.mockResolvedValueOnce({ ...app, formData: data.formData, workflowHistory: data.workflowHistory });
            return { count: 1 };
        });
    }

    describe('dry-run — unlocked, read-only', () => {
        test('reads the app via the OUTSIDE (unlocked) read; never opens a transaction, locks, or logs audit', async () => {
            mockFindFirst.mockResolvedValueOnce(farmApplication);
            process.argv = ['node', 'heal-plot-area-unit.js', ...farmArgvFrom()];

            await heal.__runCli();

            expect(mockFindFirst).toHaveBeenCalledTimes(1);
            expect(mockTransaction).not.toHaveBeenCalled();
            expect(mockQueryRaw).not.toHaveBeenCalled();
            expect(mockTxUpdateMany).not.toHaveBeenCalled();
            expect(mockLogWithin).not.toHaveBeenCalled();
            expect(process.exitCode).toBe(0);
        });
    });

    describe('apply — row lock / no-lost-update', () => {
        test('never touches the OUTSIDE (unlocked) read — every read for apply goes through tx', async () => {
            mockApplyRoundTrip(farmApplication);
            process.argv = ['node', 'heal-plot-area-unit.js', ...farmArgvFrom(), '--apply'];

            await heal.__runCli();

            expect(mockFindFirst).not.toHaveBeenCalled();
            expect(process.exitCode).toBe(0);
        });

        test('locks the row (SELECT ... FOR UPDATE) before any tx read', async () => {
            mockApplyRoundTrip(farmApplication);
            process.argv = ['node', 'heal-plot-area-unit.js', ...farmArgvFrom(), '--apply'];

            await heal.__runCli();

            expect(mockQueryRaw).toHaveBeenCalledTimes(1);
            const [strings] = mockQueryRaw.mock.calls[0];
            expect(strings.join(' ')).toMatch(/FOR UPDATE/);
            expect(process.exitCode).toBe(0);
        });

        test('writes formData.farmData.totalAreaUnit + workflowHistory (FARM_AREA_UNIT_HEALED) via updateMany guarded by the tx-read updatedAt, then audit_logs, then verifies — all inside one transaction', async () => {
            mockApplyRoundTrip(farmApplication);
            process.argv = ['node', 'heal-plot-area-unit.js', ...farmArgvFrom(), '--apply'];

            await heal.__runCli();

            expect(mockTransaction).toHaveBeenCalledTimes(1);
            expect(mockTxUpdateMany).toHaveBeenCalledTimes(1);
            const updateArgs = mockTxUpdateMany.mock.calls[0][0];
            expect(updateArgs.where).toEqual({ id: 'app-1', updatedAt: farmApplication.updatedAt });
            expect(updateArgs.data.formData.farmData.totalAreaUnit).toBe('Sqm');
            expect(updateArgs.data.workflowHistory).toHaveLength(1);
            expect(updateArgs.data.workflowHistory[0].action).toBe('FARM_AREA_UNIT_HEALED');
            // NEVER changes status; NEVER calls generateCertificate.
            expect(updateArgs.data.status).toBeUndefined();

            expect(mockLogWithin).toHaveBeenCalledTimes(1);
            const [auditEvent] = mockLogWithin.mock.calls[0];
            expect(auditEvent.action).toBe('FARM_AREA_UNIT_HEALED');
            expect(auditEvent.resourceId).toBe('app-1');
            expect(auditEvent.organizationId).toBe('org-1');

            // Post-write verify re-read happened (2nd tx findFirst call).
            expect(mockTxFindFirst).toHaveBeenCalledTimes(2);
            expect(process.exitCode).toBe(0);
        });

        test('RACE: a concurrent write (e.g. the payment-webhook status writer) landing between "operator looked" and the lock is preserved, not overwritten', async () => {
            const raced = {
                ...farmApplication,
                workflowHistory: [{ action: 'PHASE_1_PAYMENT_CREATED', note: 'concurrent webhook transition' }],
                updatedAt: new Date('2026-08-01T00:05:00.000Z'), // bumped by the concurrent write
            };
            mockApplyRoundTrip(raced);
            process.argv = ['node', 'heal-plot-area-unit.js', ...farmArgvFrom(), '--apply'];

            await heal.__runCli();

            expect(mockFindFirst).not.toHaveBeenCalled(); // stale outside data never consulted
            const updateArgs = mockTxUpdateMany.mock.calls[0][0];
            expect(updateArgs.where.updatedAt).toEqual(raced.updatedAt);
            expect(updateArgs.data.workflowHistory).toHaveLength(2);
            expect(updateArgs.data.workflowHistory[0].action).toBe('PHASE_1_PAYMENT_CREATED');
            expect(updateArgs.data.workflowHistory[1].action).toBe('FARM_AREA_UNIT_HEALED');
            expect(process.exitCode).toBe(0);
        });

        test('updateMany count 0 (updatedAt guard tripped) aborts — no audit write, non-zero exit', async () => {
            mockQueryRaw.mockResolvedValueOnce([{ id: 'app-1' }]);
            mockTxFindFirst.mockResolvedValueOnce(farmApplication);
            mockTxUpdateMany.mockResolvedValueOnce({ count: 0 });
            process.argv = ['node', 'heal-plot-area-unit.js', ...farmArgvFrom(), '--apply'];

            await heal.__runCli();

            expect(mockLogWithin).not.toHaveBeenCalled();
            expect(process.exitCode).not.toBe(0);
        });

        test('post-write verification mismatch aborts (pin: written row does not match intent) — non-zero exit', async () => {
            mockQueryRaw.mockResolvedValueOnce([{ id: 'app-1' }]);
            mockTxFindFirst
                .mockResolvedValueOnce(farmApplication) // post-lock read
                .mockResolvedValueOnce({ ...farmApplication, formData: { farmData: { totalAreaSize: 1000, farmName: 'ไร่ทดสอบ' } } }); // post-write re-read: totalAreaUnit missing — mismatch
            process.argv = ['node', 'heal-plot-area-unit.js', ...farmArgvFrom(), '--apply'];

            await heal.__runCli();

            expect(process.exitCode).not.toBe(0);
        });

        test('application not found (lock query returns no row) refuses with non-zero exit', async () => {
            mockQueryRaw.mockResolvedValueOnce([]);
            process.argv = ['node', 'heal-plot-area-unit.js', ...farmArgvFrom(), '--apply'];

            await heal.__runCli();

            expect(mockTxFindFirst).not.toHaveBeenCalled();
            expect(mockTxUpdateMany).not.toHaveBeenCalled();
            expect(process.exitCode).not.toBe(0);
        });

        test('farmData already has a unit (as read under the lock) refuses with non-zero exit and no write', async () => {
            mockQueryRaw.mockResolvedValueOnce([{ id: 'app-1' }]);
            mockTxFindFirst.mockResolvedValueOnce({
                ...farmApplication,
                formData: { farmData: { totalAreaSize: 1000, totalAreaUnit: 'rai' } },
            });
            process.argv = ['node', 'heal-plot-area-unit.js', ...farmArgvFrom(), '--apply'];

            await heal.__runCli();

            expect(mockTxUpdateMany).not.toHaveBeenCalled();
            expect(mockLogWithin).not.toHaveBeenCalled();
            expect(process.exitCode).not.toBe(0);
        });

        test('application with no formData.farmData (as read under the lock) refuses with non-zero exit and no write', async () => {
            mockQueryRaw.mockResolvedValueOnce([{ id: 'app-1' }]);
            mockTxFindFirst.mockResolvedValueOnce({ ...farmApplication, formData: { plots: [] } });
            process.argv = ['node', 'heal-plot-area-unit.js', ...farmArgvFrom(), '--apply'];

            await heal.__runCli();

            expect(mockTxUpdateMany).not.toHaveBeenCalled();
            expect(process.exitCode).not.toBe(0);
        });

        test('--plot passed with --target farm refuses at arg-parse time, before any DB read, non-zero exit', async () => {
            process.argv = ['node', 'heal-plot-area-unit.js', ...argvFrom({ target: 'farm' }), '--apply'];

            await heal.__runCli();

            expect(mockQueryRaw).not.toHaveBeenCalled();
            expect(mockTransaction).not.toHaveBeenCalled();
            expect(process.exitCode).not.toBe(0);
        });
    });
});

/**
 * Review finding (farm-areaunit T1, round 2): the first cut of the run-intent
 * banner unconditionally printed `target=${parsed.target}`, so a DEFAULT
 * plot invocation (no --target flag at all) rendered
 * "Applying — target=plot app=... plot=0 unit=Sqm" instead of the pre-farm
 * (cdcab667) "Applying — app=... plot=0 unit=Sqm" — falsifying both the
 * "plot CLI byte-identical" claim and this file's own header JSDoc. Pinned
 * directly against the exported pure `formatRunBanner`, not console spying +
 * CLI/tx plumbing, so a regression here fails immediately and unambiguously.
 */
describe('heal-plot-area-unit — formatRunBanner (byte-identical plot banner pin)', () => {
    test('default --target plot: Applying banner is byte-identical to the pre-farm (cdcab667) format', () => {
        const parsed = heal.parseArgs([...argvFrom(), '--apply']);
        expect(parsed.target).toBe('plot');
        expect(heal.formatRunBanner(parsed)).toBe(
            'Applying — app=app-1 plot=0 unit=Sqm',
        );
    });

    test('default --target plot: Dry-run banner is byte-identical to the pre-farm (cdcab667) format', () => {
        const parsed = heal.parseArgs(argvFrom());
        expect(parsed.target).toBe('plot');
        expect(heal.formatRunBanner(parsed)).toBe(
            'Dry-run (nothing will be written; re-run with --apply to write) — app=app-1 plot=0 unit=Sqm',
        );
    });

    test('explicit --target plot renders identically to the default (no target= leak either way)', () => {
        const parsed = heal.parseArgs([...argvFrom({ target: 'plot' }), '--apply']);
        expect(heal.formatRunBanner(parsed)).toBe(
            'Applying — app=app-1 plot=0 unit=Sqm',
        );
    });

    test('--target farm: Applying banner carries "target=farm " and drops plot= entirely', () => {
        const parsed = heal.parseArgs([...farmArgvFrom(), '--apply']);
        expect(parsed.target).toBe('farm');
        expect(heal.formatRunBanner(parsed)).toBe(
            'Applying — target=farm app=app-1 unit=Sqm',
        );
    });

    test('--target farm: Dry-run banner carries "target=farm " and drops plot= entirely', () => {
        const parsed = heal.parseArgs(farmArgvFrom());
        expect(heal.formatRunBanner(parsed)).toBe(
            'Dry-run (nothing will be written; re-run with --apply to write) — target=farm app=app-1 unit=Sqm',
        );
    });
});
