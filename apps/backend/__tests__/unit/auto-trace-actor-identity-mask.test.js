/**
 * PDPA close-natid-round4 — auto-trace notes mask the actor's national ID.
 *
 * `getActorIdentity` (routes/api/helpers/applications-helpers.js) returns a RAW
 * providerId/healthId — a 13-digit Thai national ID (falling back to the User
 * UUID). That value used to be persisted verbatim into the AUTO_TRACE_META JSON
 * embedded in HarvestBatch.notes (services/traceability/auto-first-cycle-trace.js)
 * and PlantingCycle.notes (services/traceability-service.js ensureAutoTraceCycle).
 * audit_logs-style masking-at-source is the convention (these `notes` text
 * columns have no PDPA encrypt hook). This suite proves the masked value is
 * written — never the raw 13-digit ID.
 *
 * The auto-trace core is dead-code today (0 runtime callers, 0 rows) but a
 * 0-row uncovered write still counts, so we drive the exported core with fakes
 * and assert the persisted batch note; a static-source assertion guards BOTH
 * note-building sites (batch + cycle) against a stale-buffer regression.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { maskThaiId } = require('../../utils/field-encryption');
const {
    autoCreateFirstCycleTraceForPassedAudit,
} = require('../../services/traceability/auto-first-cycle-trace');

const RAW_NATIONAL_ID = '1100100100011'; // 13-digit
const MASKED = maskThaiId(RAW_NATIONAL_ID); // 1-XXXX-XXXX-X-0011

const AUTO_TRACE_META_PREFIX = 'AUTO_TRACE_META:';

// A minimal packaging row the harvest-weight checks accept.
const PACKAGING_ROW = {
    packagingType: 'BAG',
    unitCount: 1,
    unitWeight: 1,
    totalWeight: 1,
};

function buildDeps(captured) {
    // Real note-builders so we exercise the ACTUAL JSON shape that lands in the
    // DB column (the masking happens in the core, before buildAutoTraceNote).
    const buildAutoTraceNote = (meta) => `${AUTO_TRACE_META_PREFIX}${JSON.stringify(meta || {})}`;

    const tx = {
        harvestBatch: {
            create: jest.fn(async ({ data }) => {
                captured.batchNotes = data.notes;
                captured.recordedBy = data.recordedBy;
                return { id: 'batch-1', batchNumber: data.batchNumber, qrCode: data.qrCode };
            }),
            update: jest.fn(async () => ({
                id: 'batch-1', batchNumber: 'BATCH-2026-0001', trackingUrl: 'u',
                qrCode: 'qr', harvestDate: new Date(), freshWeight: 1,
            })),
        },
        lot: {
            create: jest.fn(async ({ data }) => ({ id: 'lot-1', lotNumber: data.lotNumber, qrCode: data.qrCode })),
            update: jest.fn(async () => ({
                id: 'lot-1', lotNumber: 'LOT-1', packageType: 'BAG', quantity: 1,
                unitWeight: 1, totalWeight: 1, trackingUrl: 'u', qrCode: 'qr',
            })),
        },
    };

    const prisma = {
        application: {
            findFirst: jest.fn(async () => ({
                id: 'app-1',
                applicationNumber: 'APP-2026-0001',
                healthId: 'hash-token',
                formData: {},
                status: 'AUDIT_PASSED',
            })),
        },
        harvestBatch: {
            findFirst: jest.fn(async () => null), // no existing auto batch
        },
        $transaction: jest.fn(async (cb) => cb(tx)),
    };

    return {
        prisma,
        qrcodeService: {
            generateQRCodeId: jest.fn(() => 'qr-id'),
            generatePublicTraceUrl: jest.fn((p) => `https://trace/${p}`),
            registerTraceIntegrity: jest.fn(async () => ({})),
        },
        logger: { warn: jest.fn(), info: jest.fn() },
        logAction: jest.fn(async () => ({})),
        logQrGenerated: jest.fn(async () => ({})),
        extractApplicationPackagingRows: jest.fn(() => [PACKAGING_ROW]),
        resolveFarmIdForApplication: jest.fn(async () => 'farm-1'),
        ensureAutoTraceCycle: jest.fn(async () => 'cycle-1'),
        resolveDeclaredHarvestWeight: jest.fn(() => 1),
        EPSILON: 0.0001,
        buildBatchNumber: jest.fn(async () => 'BATCH-2026-0001'),
        buildAutoTraceNote,
        buildLotNumber: jest.fn((b, i) => `${b}-L${i}`),
        AUTO_TRACE_META_PREFIX,
    };
}

describe('[ROUND-4] auto-first-cycle-trace masks actorIdentity in HarvestBatch.notes', () => {
    it('persists the MASKED national ID into the batch note (never the raw 13-digit ID)', async () => {
        const captured = {};
        const deps = buildDeps(captured);
        const result = await autoCreateFirstCycleTraceForPassedAudit({
            applicationId: 'app-1',
            certificateId: 'cert-1',
            actorId: 'user-uuid-1',
            actorRole: 'AUDITOR',
            actorIdentity: RAW_NATIONAL_ID,
            ipAddress: '127.0.0.1',
            userAgent: 'jest',
        }, deps);

        expect(result.created).toBe(true);
        expect(captured.batchNotes).toContain(AUTO_TRACE_META_PREFIX);
        const meta = JSON.parse(captured.batchNotes.slice(AUTO_TRACE_META_PREFIX.length));
        expect(meta.actorIdentity).toBe(MASKED);
        // Hard guarantee: the raw 13-digit national ID is NOWHERE in the note.
        expect(captured.batchNotes).not.toContain(RAW_NATIONAL_ID);
        // recordedBy still carries the (non-PII) User UUID for attribution.
        expect(captured.recordedBy).toBe('user-uuid-1');
    });

    it('keeps a null actorIdentity as null (no mask on absent value)', async () => {
        const captured = {};
        const deps = buildDeps(captured);
        await autoCreateFirstCycleTraceForPassedAudit({
            applicationId: 'app-1',
            certificateId: 'cert-1',
            actorId: 'user-uuid-1',
            actorRole: 'AUDITOR',
            actorIdentity: null,
            ipAddress: '127.0.0.1',
            userAgent: 'jest',
        }, deps);
        const meta = JSON.parse(captured.batchNotes.slice(AUTO_TRACE_META_PREFIX.length));
        expect(meta.actorIdentity).toBeNull();
    });
});

describe('[ROUND-4] both auto-trace note sites wrap actorIdentity in maskThaiId (source guard)', () => {
    // A stale-buffer / accidental-revert guard: the two note-building sites must
    // never persist a raw actorIdentity. We assert the source wraps it.
    it('auto-first-cycle-trace.js masks actorIdentity at the batch note', () => {
        const src = fs.readFileSync(
            path.join(__dirname, '..', '..', 'services', 'traceability', 'auto-first-cycle-trace.js'),
            'utf8',
        );
        expect(src).toMatch(/actorIdentity:\s*actorIdentity\s*\?\s*maskThaiId\(actorIdentity\)\s*:\s*null/);
        // The bare unmasked persist form must be gone.
        expect(src).not.toMatch(/actorIdentity:\s*actorIdentity\s*\|\|\s*null/);
    });

    it('traceability-service.js ensureAutoTraceCycle masks actorIdentity at the cycle note', () => {
        const src = fs.readFileSync(
            path.join(__dirname, '..', '..', 'services', 'traceability-service.js'),
            'utf8',
        );
        expect(src).toMatch(/actorIdentity:\s*actorIdentity\s*\?\s*maskThaiId\(actorIdentity\)\s*:\s*null/);
        expect(src).not.toMatch(/actorIdentity:\s*actorIdentity\s*\|\|\s*null/);
    });
});
