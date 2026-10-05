'use strict';

/**
 * GET /api/applications/:id/requirements — the door every surface reads.
 *
 * Two things are being held down here, and the second one is the reason the door exists
 * at all:
 *   1. it answers only about YOUR filing — the holder scope comes from the token user's
 *      memberships, the row is read scoped by it, and someone else's application is a
 *      404, not a 403;
 *   2. it answers with the SAME lens the submit gate uses, over real uploaded evidence,
 *      so the wizard cannot say ครบ while the gate says ไม่ครบ.
 */

const express = require('express');
const request = require('supertest');

jest.mock('../../middleware/auth-middleware', () => {
    const asHealthUser = (req, _res, next) => {
        req.user = { id: 'user-1', role: 'health', canonicalRole: 'health', healthId: 'health-1' };
        return next();
    };
    return { authenticateHealth: asHealthUser, authenticateAny: asHealthUser, authenticateProvider: asHealthUser };
});

const mockFindFirst = jest.fn();
const mockDocumentFindMany = jest.fn();
jest.mock('../../services/prisma-database', () => ({
    prisma: {
        application: { findFirst: (...args) => mockFindFirst(...args) },
        applicationDocument: { findMany: (...args) => mockDocumentFindMany(...args) },
        // holder-access (spec 2026-09-30 §3.1): user-1 is an ACTIVE member of ent-1.
        entityMembership: { findMany: async () => [{ entityId: 'ent-1', role: 'OWNER' }] },
    },
}));

const mockResolveHealthIdentity = jest.fn();
jest.mock('../../services/application-service', () => ({
    resolveHealthIdentity: (...args) => mockResolveHealthIdentity(...args),
}));

const mockRulesAt = jest.fn();
const mockPlantCodes = jest.fn();
jest.mock('../../services/requirement-rule-service', () => ({
    rulesAt: (...args) => mockRulesAt(...args),
    plantCodesWithRulesAt: (...args) => mockPlantCodes(...args),
    RULE_DIMENSIONS: {
        landTenure: ['OWNED', 'STATE_PERMITTED', 'RENTED'],
        areaType: ['OUTDOOR', 'GREENHOUSE', 'INDOOR'],
        certScope: ['PLANTING', 'PROCESSING'],
    },
}));

jest.mock('../../shared/logger', () => {
    const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...l, createLogger: jest.fn(() => l) };
});

const { buildHerbRuleRows } = require('../../scripts/seed-herb-requirement-rules');
const requirementsRouter = require('../../routes/api/applications/requirements');
const { hasHolderMarker } = require('../../services/holder-access');

const ROWS = buildHerbRuleRows('cannabis', { effectiveFrom: '2026-09-02T00:00:00Z' })
    .map((row, index) => ({ id: `rule-${index}`, ...row }));

function rulesFor(asked) {
    // A case dimension may be asked with several words at once (ลักษณะพื้นที่ is a
    // checkbox row), which the register answers as an IN over the stored word.
    const matches = (column, value) => {
        if (value === null || value === undefined) { return true; }
        const wanted = asked[column];
        return Array.isArray(wanted) ? wanted.includes(value) : wanted === value;
    };
    return ROWS.filter((row) => (
        matches('holderType', row.holderType)
        && matches('requestType', row.requestType)
        && matches('plantCode', row.plantCode)
        && matches('landTenure', row.landTenure)
        && matches('areaType', row.areaType)
        && matches('certScope', row.certScope)
    ));
}

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/applications', requirementsRouter);
    return app;
}

const APPLICATION = {
    id: 'app-1',
    healthId: 'health-1',
    entity: { type: 'INDIVIDUAL' },
    formData: {
        plantId: 'cannabis',
        requestType: 'NEW',
        farmData: { landOwnership: 'RENT' },
        cultivationMethods: ['outdoor'],
    },
};

beforeEach(() => {
    jest.clearAllMocks();
    mockResolveHealthIdentity.mockResolvedValue({ userId: 'user-1', healthId: 'health-1' });
    mockFindFirst.mockResolvedValue(APPLICATION);
    mockDocumentFindMany.mockResolvedValue([]);
    mockRulesAt.mockImplementation(async (asked) => rulesFor(asked));
    mockPlantCodes.mockResolvedValue(['cannabis']);
});

describe('GET /applications/:id/requirements', () => {
    test('answers with what this filing needs and why', async () => {
        const res = await request(buildApp()).get('/api/applications/app-1/requirements');

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.dims).toMatchObject({
            holderType: 'INDIVIDUAL', requestType: 'NEW', plantCode: 'cannabis',
            landTenure: 'RENTED', areaTypes: ['OUTDOOR'], certScope: 'PLANTING',
        });
        const landlord = res.body.data.slots.find((slot) => slot.slotId === 'landlord_consent');
        expect(landlord).toMatchObject({ required: true, requiredReason: 'RENTED', satisfied: false });
        expect(res.body.data.complete).toBe(false);
        expect(res.body.data.missingRequired).toContain('landlord_consent');
    });

    test('the wire contract carries no rule-engine internals', async () => {
        const res = await request(buildApp()).get('/api/applications/app-1/requirements');
        // blockingIssues joined the contract on 2026-09-05: a filing the law cannot reach
        // has to say so on the surface a farmer is looking at, not only at the submit door.
        // editable joined on 2026-09-29 (walk D3): the wizard's delete control is
        // disabled from the same status set the delete door refuses with.
        expect(Object.keys(res.body.data).sort()).toEqual([
            'blockingIssues', 'complete', 'dims', 'editable', 'missingRequired', 'slots',
        ]);
        expect(JSON.stringify(res.body)).not.toContain('rule-0');
    });

    test('a filing whose plant has no filed law is told so, on the page, before it submits', async () => {
        mockFindFirst.mockResolvedValue({
            ...APPLICATION,
            formData: { ...APPLICATION.formData, plantId: 'turmeric' },
        });
        const res = await request(buildApp()).get('/api/applications/app-1/requirements');
        expect(res.status).toBe(200);
        expect(res.body.data.blockingIssues).toEqual([
            expect.objectContaining({ code: 'PLANT_LAW_NOT_FILED' }),
        ]);
        expect(res.body.data.complete).toBe(false);
    });

    test('a document filed under an old slot name still counts', async () => {
        mockDocumentFindMany.mockResolvedValue([
            { documentType: 'CHANOTE', fileUrl: '/uploads/deed.pdf', fileName: 'deed.pdf', createdAt: '2026-09-01T00:00:00.000Z', currentForSlot: 'CHANOTE', supersededAt: null },
        ]);
        const res = await request(buildApp()).get('/api/applications/app-1/requirements');
        const land = res.body.data.slots.find((slot) => slot.slotId === 'land_rights');
        expect(land).toMatchObject({ required: true, satisfied: true });
        expect(res.body.data.missingRequired).not.toContain('land_rights');
    });

    test('the row is read scoped by the caller’s holder scope, never by anything in the request', async () => {
        await request(buildApp()).get('/api/applications/app-1/requirements');
        const { where } = mockFindFirst.mock.calls[0][0];
        // Spec 2026-09-30 §3.1: the holder fragment of the token user's ACTIVE
        // memberships, carrying the marker; no filer (healthId) pin at the top level.
        // R1-legacy-pin (removed in Task 12): OR [fragment, the token's healthId pin] and the
        // pin as the AND member (final review C1: neutral with or without an entity context).
        expect(Object.keys(where).sort()).toEqual(['AND', 'OR', 'id', 'isDeleted']);
        expect(where).toEqual(expect.objectContaining({
            id: 'app-1', AND: [{ healthId: 'health-1' }], isDeleted: false,
        }));
        expect(where.OR[0].entityId).toEqual({ in: ['ent-1'] });
        expect(hasHolderMarker(where.OR[0])).toBe(true);
        expect(JSON.parse(JSON.stringify(where.OR[1]))).toEqual({ healthId: 'health-1' });
        expect(hasHolderMarker(where.OR[1])).toBe(true);
    });

    test('someone else’s filing is a 404, not a 403 — asking must not confirm it exists', async () => {
        mockFindFirst.mockResolvedValue(null);
        const res = await request(buildApp()).get('/api/applications/not-mine/requirements');
        expect(res.status).toBe(404);
        expect(res.body).toEqual({ success: false, error: 'Application not found' });
    });

    test('an unresolvable identity is refused by the identity service, not answered', async () => {
        mockResolveHealthIdentity.mockRejectedValue(
            Object.assign(new Error('Health identity is required and must include healthId'), { statusCode: 401 }),
        );
        const res = await request(buildApp()).get('/api/applications/app-1/requirements');
        expect(res.status).toBe(401);
        expect(mockFindFirst).not.toHaveBeenCalled();
    });

    test('a rule-engine refusal reaches the applicant as an internal error, not as rule vocabulary', async () => {
        mockRulesAt.mockRejectedValue(Object.assign(
            new Error('มิติกติกาไม่อยู่ในชุดค่าที่ระบบรู้จัก: landTenure=LEASE กรุณาแก้เป็นค่าใดค่าหนึ่งใน OWNED / STATE_PERMITTED / RENTED'),
            { code: 'INVALID_RULE_DIMENSION', status: 422, statusCode: 422 },
        ));
        const res = await request(buildApp()).get('/api/applications/app-1/requirements');
        expect(res.status).toBe(500);
        expect(JSON.stringify(res.body)).not.toMatch(/landTenure|STATE_PERMITTED/);
    });

    // Walk D3 (2026-09-29): the wizard card gained a delete control that calls
    // DELETE /applications/draft-documents/:documentId?applicationId=… — so the card
    // needs the file's documentId, and needs to know whether the door would refuse.
    describe('what the delete control needs (walk D3)', () => {
        test.each([
            ['DRAFT', true],
            ['REVISION_REQUESTED', true],
            ['CAR_PENDING', true],
            ['PENDING_DOC_FEE', false],
            ['SUBMITTED', false],
            [undefined, false],
        ])('status %s → editable %s (the set the draft-document doors enforce)', async (status, editable) => {
            mockFindFirst.mockResolvedValue({ ...APPLICATION, status });
            const res = await request(buildApp()).get('/api/applications/app-1/requirements');
            expect(res.body.data.editable).toBe(editable);
        });

        test('the editable set is the one applications.js refuses writes with — one definition', () => {
            const { APPLICANT_EDITABLE_STATUSES, isApplicantEditable } = require('../../constants/applicant-editable-statuses');
            expect([...APPLICANT_EDITABLE_STATUSES].sort()).toEqual(['CAR_PENDING', 'DRAFT', 'REVISION_REQUESTED']);
            // Fix round 1: the exported list cannot be widened at runtime (Object.freeze on a
            // Set protected nothing — .add still worked).
            expect(Object.isFrozen(APPLICANT_EDITABLE_STATUSES)).toBe(true);
            expect(() => APPLICANT_EDITABLE_STATUSES.push('SUBMITTED')).toThrow(TypeError);
            expect(typeof APPLICANT_EDITABLE_STATUSES.add).toBe('undefined');
            expect(isApplicantEditable('draft')).toBe(true);
            expect(isApplicantEditable('SUBMITTED')).toBe(false);
            expect(isApplicantEditable(null)).toBe(false);
            const src = require('fs').readFileSync(require.resolve('../../routes/api/applications/applications.js'), 'utf8');
            expect(src).not.toMatch(/new Set\(\['DRAFT', 'REVISION_REQUESTED', 'CAR_PENDING'\]\)/);
            expect(src).toContain("require('../../../constants/applicant-editable-statuses')");
            expect(src).toMatch(/isApplicantEditable\(application\.status\)/);
        });

        test('an attached slot carries the documentId of its file — from the draft array', async () => {
            mockFindFirst.mockResolvedValue({
                ...APPLICATION,
                formData: {
                    ...APPLICATION.formData,
                    draftDocuments: [{ documentId: 'doc-draft-1', slotId: 'land_rights', fileUrl: '/uploads/a.pdf', fileName: 'a.pdf' }],
                },
            });
            const res = await request(buildApp()).get('/api/applications/app-1/requirements');
            const land = res.body.data.slots.find((slot) => slot.slotId === 'land_rights');
            expect(land).toMatchObject({ satisfied: true, documentId: 'doc-draft-1' });
        });

        test('…and from the application_documents row, which wins; the row read selects it', async () => {
            mockDocumentFindMany.mockResolvedValue([
                { documentId: 'doc-row-1', documentType: 'land_rights', fileUrl: '/uploads/b.pdf', fileName: 'b.pdf', createdAt: '2026-09-01T00:00:00.000Z', currentForSlot: 'land_rights', supersededAt: null },
            ]);
            const res = await request(buildApp()).get('/api/applications/app-1/requirements');
            const land = res.body.data.slots.find((slot) => slot.slotId === 'land_rights');
            expect(land.documentId).toBe('doc-row-1');
            expect(mockDocumentFindMany.mock.calls[0][0].select).toMatchObject({ documentId: true });
        });

        test('an empty slot has documentId null', async () => {
            const res = await request(buildApp()).get('/api/applications/app-1/requirements');
            const landlord = res.body.data.slots.find((slot) => slot.slotId === 'landlord_consent');
            expect(landlord.documentId).toBeNull();
        });
    });
});
