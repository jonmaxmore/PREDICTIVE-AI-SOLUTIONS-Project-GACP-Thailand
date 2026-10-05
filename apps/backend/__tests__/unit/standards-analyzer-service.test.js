'use strict';

/**
 * Standards Analyzer Service (สัญญา C05F680149 — ต้นแบบที่ 1 "ระบบวิเคราะห์
 * มาตรฐาน GACP 3 ระบบ": WHO / Thai FDA / ASEAN).
 *
 * Contract under test (contract C05F680149 acceptance mapping — B1):
 *   - analyzeApplication(applicationId, standardCode, { actor }) evaluates every
 *     seeded StandardRequirement against real application signals (uploaded
 *     document slots, canonical formData paths, workflow state, platform
 *     capability) and returns per-requirement MET / NOT_MET / NEEDS_REVIEW
 *     with Thai evidence + recommendation, plus a summary block.
 *   - Deterministic precedence: platform → docs → certified workflow state →
 *     secondary docs/formData (NEEDS_REVIEW) → mapped-but-no-evidence
 *     (NOT_MET) → unmapped (NEEDS_REVIEW).
 *   - Unknown standard / unknown application throw with .statusCode 404 at the
 *     throw site (sendServiceError-compatible — bug-hunt 7.4 lesson).
 *   - HEALTH actor that does not own the application → 404 (anti-probe,
 *     matches canSeeSlip / invoice cross-side convention).
 *   - getAseanComparison() returns reference rows for all 10 ASEAN countries.
 */

jest.mock('../../shared/logger', () => {
    const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...l, createLogger: jest.fn(() => l) };
});

const mockStandardFindUnique = jest.fn();
const mockApplicationFindFirst = jest.fn();

jest.mock('../../services/prisma-database', () => ({
    prisma: {
        certificationStandard: { findUnique: (...a) => mockStandardFindUnique(...a) },
        application: { findFirst: (...a) => mockApplicationFindFirst(...a) },
    },
}));

const analyzer = require('../../services/standards-analyzer-service');

const APP_ID = '11111111-1111-4111-8111-111111111111';

function whoStandard() {
    return {
        id: 'std-who',
        code: 'WHO',
        name: 'WHO GACP',
        nameTH: 'มาตรฐาน WHO',
        version: 'v2003',
        isActive: true,
        requirements: [
            { id: 'r1', category: 'CONTAMINANT', name: 'Heavy Metals Analysis', nameTH: 'การวิเคราะห์โลหะหนัก', description: 'limits', isRequired: true, sortOrder: 1 },
            { id: 'r2', category: 'CONTAMINANT', name: 'Pesticide Residues', nameTH: 'สารตกค้างกำจัดศัตรูพืช', description: 'limits', isRequired: true, sortOrder: 2 },
            { id: 'r3', category: 'PROCESS', name: 'Drying Protocols', nameTH: 'กระบวนการตากแห้ง', description: 'drying', isRequired: true, sortOrder: 3 },
            { id: 'r4', category: 'DOCUMENTATION', name: 'Batch Traceability', nameTH: 'การตรวจสอบย้อนกลับรุ่นผลิต', description: 'trace', isRequired: true, sortOrder: 4 },
            { id: 'r5', category: 'OTHER', name: 'Unmapped Requirement', nameTH: 'ข้อกำหนดที่ยังไม่แม็ป', description: null, isRequired: false, sortOrder: 5 },
        ],
    };
}

function baseApplication(overrides = {}) {
    return {
        id: APP_ID,
        applicationNumber: 'GACP-2569-0001',
        status: 'ASSIGNED_FOR_REVIEW',
        healthId: 'tok_owner',
        isDeleted: false,
        formData: {},
        documents: [],
        ...overrides,
    };
}

describe('standards-analyzer-service.analyzeApplication', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('LAB_CERTIFICATE document present → Heavy Metals Analysis = MET (docs signal)', async () => {
        mockStandardFindUnique.mockResolvedValue(whoStandard());
        mockApplicationFindFirst.mockResolvedValue(baseApplication({
            documents: [{ documentType: 'LAB_CERTIFICATE', fileUrl: 'u' }],
        }));

        const result = await analyzer.analyzeApplication(APP_ID, 'WHO', { actor: { role: 'ADMIN' } });

        const heavyMetals = result.requirements.find(r => r.name === 'Heavy Metals Analysis');
        expect(heavyMetals.status).toBe('MET');
        expect(heavyMetals.evidence).toBeTruthy();
    });

    test('no evidence at all → mapped requirement = NOT_MET with Thai recommendation', async () => {
        mockStandardFindUnique.mockResolvedValue(whoStandard());
        mockApplicationFindFirst.mockResolvedValue(baseApplication());

        const result = await analyzer.analyzeApplication(APP_ID, 'WHO', { actor: { role: 'ADMIN' } });

        const heavyMetals = result.requirements.find(r => r.name === 'Heavy Metals Analysis');
        expect(heavyMetals.status).toBe('NOT_MET');
        expect(typeof heavyMetals.recommendation).toBe('string');
        expect(heavyMetals.recommendation.length).toBeGreaterThan(0);
    });

    test('secondary evidence only (SOP_PEST, no lab cert) → Pesticide Residues = NEEDS_REVIEW', async () => {
        mockStandardFindUnique.mockResolvedValue(whoStandard());
        mockApplicationFindFirst.mockResolvedValue(baseApplication({
            documents: [{ documentType: 'SOP_PEST', fileUrl: 'u' }],
        }));

        const result = await analyzer.analyzeApplication(APP_ID, 'WHO', { actor: { role: 'ADMIN' } });

        const pesticide = result.requirements.find(r => r.name === 'Pesticide Residues');
        expect(pesticide.status).toBe('NEEDS_REVIEW');
    });

    test('formData path signal (harvestData.dryingMethod) → Drying Protocols = NEEDS_REVIEW', async () => {
        mockStandardFindUnique.mockResolvedValue(whoStandard());
        mockApplicationFindFirst.mockResolvedValue(baseApplication({
            formData: { harvestData: { dryingMethod: 'SUN_DRY' } },
        }));

        const result = await analyzer.analyzeApplication(APP_ID, 'WHO', { actor: { role: 'ADMIN' } });

        const drying = result.requirements.find(r => r.name === 'Drying Protocols');
        expect(drying.status).toBe('NEEDS_REVIEW');
    });

    test('platform capability signal → Batch Traceability = MET even with empty application', async () => {
        mockStandardFindUnique.mockResolvedValue(whoStandard());
        mockApplicationFindFirst.mockResolvedValue(baseApplication());

        const result = await analyzer.analyzeApplication(APP_ID, 'WHO', { actor: { role: 'ADMIN' } });

        const trace = result.requirements.find(r => r.name === 'Batch Traceability');
        expect(trace.status).toBe('MET');
    });

    test('unmapped requirement → NEEDS_REVIEW (expert assessment), never NOT_MET', async () => {
        mockStandardFindUnique.mockResolvedValue(whoStandard());
        mockApplicationFindFirst.mockResolvedValue(baseApplication());

        const result = await analyzer.analyzeApplication(APP_ID, 'WHO', { actor: { role: 'ADMIN' } });

        const unmapped = result.requirements.find(r => r.name === 'Unmapped Requirement');
        expect(unmapped.status).toBe('NEEDS_REVIEW');
    });

    test('summary counts add up and readinessPct is 0-100', async () => {
        mockStandardFindUnique.mockResolvedValue(whoStandard());
        mockApplicationFindFirst.mockResolvedValue(baseApplication({
            documents: [{ documentType: 'LAB_CERTIFICATE', fileUrl: 'u' }],
        }));

        const result = await analyzer.analyzeApplication(APP_ID, 'WHO', { actor: { role: 'ADMIN' } });

        const { summary } = result;
        expect(summary.total).toBe(5);
        expect(summary.met + summary.notMet + summary.needsReview).toBe(summary.total);
        expect(summary.readinessPct).toBeGreaterThanOrEqual(0);
        expect(summary.readinessPct).toBeLessThanOrEqual(100);
    });

    test('AUDIT_PASSED workflow state upgrades onsite-checklist requirements to MET', async () => {
        const std = {
            id: 'std-asean', code: 'ASEAN', name: 'ASEAN GHP', nameTH: 'มาตรฐาน ASEAN', version: 'v2021', isActive: true,
            requirements: [
                { id: 'a1', category: 'PROCESS', name: 'Waste Management', nameTH: 'การจัดการของเสีย', description: null, isRequired: true, sortOrder: 1 },
            ],
        };
        mockStandardFindUnique.mockResolvedValue(std);

        mockApplicationFindFirst.mockResolvedValue(baseApplication({ status: 'CERTIFIED' }));
        const passed = await analyzer.analyzeApplication(APP_ID, 'ASEAN', { actor: { role: 'ADMIN' } });
        expect(passed.requirements[0].status).toBe('MET');

        mockApplicationFindFirst.mockResolvedValue(baseApplication({ status: 'ASSIGNED_FOR_REVIEW' }));
        const pending = await analyzer.analyzeApplication(APP_ID, 'ASEAN', { actor: { role: 'ADMIN' } });
        expect(pending.requirements[0].status).toBe('NEEDS_REVIEW');
    });

    test('unknown standard code → throws with statusCode 404 + code STANDARD_NOT_FOUND', async () => {
        mockStandardFindUnique.mockResolvedValue(null);
        mockApplicationFindFirst.mockResolvedValue(baseApplication());

        await expect(analyzer.analyzeApplication(APP_ID, 'NOPE', { actor: { role: 'ADMIN' } }))
            .rejects.toMatchObject({ statusCode: 404, code: 'STANDARD_NOT_FOUND' });
    });

    test('unknown application → throws with statusCode 404 + code APPLICATION_NOT_FOUND', async () => {
        mockStandardFindUnique.mockResolvedValue(whoStandard());
        mockApplicationFindFirst.mockResolvedValue(null);

        await expect(analyzer.analyzeApplication(APP_ID, 'WHO', { actor: { role: 'ADMIN' } }))
            .rejects.toMatchObject({ statusCode: 404, code: 'APPLICATION_NOT_FOUND' });
    });

    // The route passes normalizeRole(...) output — the CANONICAL lowercase
    // 'health', NOT the literal 'HEALTH'. Feeding the canonical value here is
    // what makes this a real regression guard (the old test passed uppercase,
    // which the runtime path never produces → false-green; PR-666 review).
    test('HEALTH actor that is not the owner → 404 APPLICATION_NOT_FOUND (anti-probe)', async () => {
        mockStandardFindUnique.mockResolvedValue(whoStandard());
        mockApplicationFindFirst.mockResolvedValue(baseApplication({ healthId: 'tok_owner' }));

        await expect(analyzer.analyzeApplication(APP_ID, 'WHO', {
            actor: { role: 'health', canonicalId: 'tok_someone_else' },
        })).rejects.toMatchObject({ statusCode: 404, code: 'APPLICATION_NOT_FOUND' });
    });

    test('HEALTH owner → allowed', async () => {
        mockStandardFindUnique.mockResolvedValue(whoStandard());
        mockApplicationFindFirst.mockResolvedValue(baseApplication({ healthId: 'tok_owner' }));

        const result = await analyzer.analyzeApplication(APP_ID, 'WHO', {
            actor: { role: 'health', canonicalId: 'tok_owner' },
        });
        expect(result.application.id).toBe(APP_ID);
    });

    test('standard exists but zero requirements seeded → empty requirements + total 0 (no crash)', async () => {
        mockStandardFindUnique.mockResolvedValue({ ...whoStandard(), requirements: [] });
        mockApplicationFindFirst.mockResolvedValue(baseApplication());

        const result = await analyzer.analyzeApplication(APP_ID, 'WHO', { actor: { role: 'ADMIN' } });
        expect(result.requirements).toEqual([]);
        expect(result.summary.total).toBe(0);
        expect(result.summary.readinessPct).toBe(0);
    });
});

describe('standards-analyzer-service.getAseanComparison', () => {
    test('returns all 10 ASEAN member countries with Thai-facing fields', () => {
        const rows = analyzer.getAseanComparison();
        expect(rows).toHaveLength(10);
        const codes = rows.map(r => r.countryCode).sort();
        expect(codes).toEqual(['BN', 'ID', 'KH', 'LA', 'MM', 'MY', 'PH', 'SG', 'TH', 'VN']);
        for (const row of rows) {
            expect(row.countryTH).toBeTruthy();
            expect(row.regulator).toBeTruthy();
            expect(typeof row.gapVsThai).toBe('string');
        }
    });
});
