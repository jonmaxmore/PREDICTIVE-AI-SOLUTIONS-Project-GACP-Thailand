'use strict';

/**
 * FU-2 (full-system audit follow-up, owner-approved 2026-07-07) — per-tenant
 * audit-chain baselines, REQUIRED before onboarding org #2.
 *
 * The nightly sweep's baseline floor (AUDIT_CHAIN_VERIFY_FROM_SEQ) exists to
 * skip PRE-CUTOVER benign breaks of the ORIGINAL tenant (PDPA re-key mutated
 * legacy currentHash / dropped seqs). But `sequenceNumber` is PER-TENANT
 * (@@unique([organizationId, sequenceNumber])) while the env floor is GLOBAL:
 * a NEW tenant's fresh chain starts at seq 1 — far below the floor — so
 * startSequence = max(windowStart, 485) > tail and the sweep verifies NOTHING
 * for that org. Live-demonstrated on staging 2026-07-07: the drill org's chain
 * (tail 1) was skipped entirely (start 2101 > end 1). A tampered row in org #2
 * would never alert.
 *
 * Fix: SystemConfig key `audit_chain_baselines` = JSON map {orgId: floor}.
 * When the row exists, each tenant's floor = map[orgId] ?? 0 (fresh chains
 * have no legacy breaks → fully swept). When the row is absent or malformed,
 * behavior is UNCHANGED (env/explicit global floor) — backward compatible.
 * jobs/scheduler.js stops pre-resolving the env floor so the map can apply.
 *
 * RED (pre-fix): the sweep ignores SystemConfig — org-NEW gets the global
 * floor and is skipped → tests A1/A2 fail.
 */

function loadService({ verifyChain, groupByRows, systemConfigRow, envFloor }) {
    jest.resetModules();
    if (envFloor === undefined) {
        delete process.env.AUDIT_CHAIN_VERIFY_FROM_SEQ;
    } else {
        process.env.AUDIT_CHAIN_VERIFY_FROM_SEQ = String(envFloor);
    }
    const prismaMock = {
        auditLog: {
            create: jest.fn(),
            findMany: jest.fn(),
            count: jest.fn(),
            groupBy: jest.fn().mockResolvedValue(groupByRows),
        },
        systemConfig: {
            findUnique: jest.fn().mockResolvedValue(systemConfigRow),
        },
    };
    jest.doMock('../../services/prisma-database', () => ({ prisma: prismaMock }));
    jest.doMock('../../utils/client-ip', () => ({ getRequestIp: jest.fn() }));
    jest.doMock('../../middleware/audit-logger', () => ({
        auditLogger: { log: jest.fn(), verifyChain },
        AuditCategory: { AUTHENTICATION: 'AUTHENTICATION', PAYMENT: 'PAYMENT', SYSTEM: 'SYSTEM' },
        AuditSeverity: { INFO: 'INFO', WARNING: 'WARNING', ERROR: 'ERROR', CRITICAL: 'CRITICAL' },
        ResourceType: { USER: 'USER', APPLICATION: 'APPLICATION', SYSTEM: 'SYSTEM' },
    }));
    return { prismaMock, service: require('../../services/audit-trail') };
}

const clean = () => ({ verified: true, totalLogs: 3, linkMismatches: 0, hashMismatches: 0, corruptedLogs: [] });

const TWO_ORGS = [
    { organizationId: 'org-LEGACY', _max: { sequenceNumber: 500 } },
    { organizationId: 'org-NEW', _max: { sequenceNumber: 6 } },
];

describe('FU-2 — per-tenant audit-chain baselines (SystemConfig audit_chain_baselines)', () => {
    const savedEnv = process.env.AUDIT_CHAIN_VERIFY_FROM_SEQ;
    afterAll(() => {
        if (savedEnv === undefined) { delete process.env.AUDIT_CHAIN_VERIFY_FROM_SEQ; }
        else { process.env.AUDIT_CHAIN_VERIFY_FROM_SEQ = savedEnv; }
    });
    beforeEach(() => { jest.clearAllMocks(); });

    // NOTE mock shape (adversarial-verify MUST-2): SystemConfig.value is a
    // STRING column (prisma/schema/system.prisma) — production rows can ONLY
    // be a JSON string, never a plain object. Mock the real shape so the
    // JSON.parse branch (the only production path) is what these tests pin;
    // A3 keeps the object-shape tolerance branch covered separately.
    const MAP_ROW_STRING = { value: '{"org-LEGACY":485}' };

    test('A1: map present — org-NEW (no entry) gets floor 0 and IS swept from seq 1', async () => {
        const verifyChain = jest.fn().mockResolvedValue(clean());
        const { service } = loadService({
            verifyChain,
            groupByRows: TWO_ORGS,
            systemConfigRow: MAP_ROW_STRING,
            envFloor: 485,
        });

        await service.runScheduledChainVerification();

        expect(verifyChain).toHaveBeenCalledWith(
            expect.objectContaining({ organizationId: 'org-NEW', startSequence: 1 }),
        );
    });

    test('A2: map present — org-LEGACY keeps its mapped floor 485', async () => {
        const verifyChain = jest.fn().mockResolvedValue(clean());
        const { service } = loadService({
            verifyChain,
            groupByRows: TWO_ORGS,
            systemConfigRow: MAP_ROW_STRING,
            envFloor: 485,
        });

        await service.runScheduledChainVerification();

        expect(verifyChain).toHaveBeenCalledWith(
            expect.objectContaining({ organizationId: 'org-LEGACY', startSequence: 485 }),
        );
    });

    test('A3: object-shape value (future Json column) still tolerated', async () => {
        const verifyChain = jest.fn().mockResolvedValue(clean());
        const { service } = loadService({
            verifyChain,
            groupByRows: TWO_ORGS,
            systemConfigRow: { value: { 'org-LEGACY': 485 } },
            envFloor: 485,
        });

        await service.runScheduledChainVerification();

        expect(verifyChain).toHaveBeenCalledWith(
            expect.objectContaining({ organizationId: 'org-NEW', startSequence: 1 }),
        );
    });

    test('B: no SystemConfig row — legacy global env floor applies to BOTH orgs (unchanged)', async () => {
        const verifyChain = jest.fn().mockResolvedValue(clean());
        const { service } = loadService({
            verifyChain,
            groupByRows: TWO_ORGS,
            systemConfigRow: null,
            envFloor: 485,
        });

        await service.runScheduledChainVerification();

        expect(verifyChain).toHaveBeenCalledWith(
            expect.objectContaining({ organizationId: 'org-LEGACY', startSequence: 485 }),
        );
        expect(verifyChain).toHaveBeenCalledWith(
            expect.objectContaining({ organizationId: 'org-NEW', startSequence: 485 }),
        );
    });

    test('C: malformed SystemConfig value — falls back to the env floor (fail-open to legacy)', async () => {
        const verifyChain = jest.fn().mockResolvedValue(clean());
        const { service } = loadService({
            verifyChain,
            groupByRows: TWO_ORGS,
            systemConfigRow: { value: 'not-a-map' },
            envFloor: 485,
        });

        await service.runScheduledChainVerification();

        expect(verifyChain).toHaveBeenCalledWith(
            expect.objectContaining({ organizationId: 'org-NEW', startSequence: 485 }),
        );
    });

    test('D: SystemConfig read failure — sweep still runs on the env floor (never blocks the control)', async () => {
        const verifyChain = jest.fn().mockResolvedValue(clean());
        const { service, prismaMock } = loadService({
            verifyChain,
            groupByRows: TWO_ORGS,
            systemConfigRow: null,
            envFloor: 485,
        });
        prismaMock.systemConfig.findUnique.mockRejectedValue(new Error('db blip'));

        const summary = await service.runScheduledChainVerification();

        expect(summary.orgsChecked).toBe(2);
        expect(verifyChain).toHaveBeenCalledTimes(2);
    });

    test('E: explicit fromSequence (forensic call) still wins when no map row exists', async () => {
        const verifyChain = jest.fn().mockResolvedValue(clean());
        const { service } = loadService({
            verifyChain,
            groupByRows: [{ organizationId: 'org-LEGACY', _max: { sequenceNumber: 500 } }],
            systemConfigRow: null,
            envFloor: 485,
        });

        await service.runScheduledChainVerification({ fromSequence: 490 });

        expect(verifyChain).toHaveBeenCalledWith(
            expect.objectContaining({ organizationId: 'org-LEGACY', startSequence: 490 }),
        );
    });

    test('F: explicit fromSequence OVERRIDES the map (forensic caller intent wins) — MUST-3', async () => {
        // A forensic call like runScheduledChainVerification({windowSize:0,
        // fromSequence:0}) must scan FULL chains even after ops seed the
        // baselines map — deliberate caller intent beats stored config.
        const verifyChain = jest.fn().mockResolvedValue(clean());
        const { service, prismaMock } = loadService({
            verifyChain,
            groupByRows: TWO_ORGS,
            systemConfigRow: MAP_ROW_STRING,
            envFloor: 485,
        });

        await service.runScheduledChainVerification({ windowSize: 0, fromSequence: 0 });

        expect(verifyChain).toHaveBeenCalledWith(
            expect.objectContaining({ organizationId: 'org-LEGACY', startSequence: 1 }),
        );
        expect(verifyChain).toHaveBeenCalledWith(
            expect.objectContaining({ organizationId: 'org-NEW', startSequence: 1 }),
        );
        // Explicit call → the map is not even consulted.
        expect(prismaMock.systemConfig.findUnique).not.toHaveBeenCalled();
    });
});
