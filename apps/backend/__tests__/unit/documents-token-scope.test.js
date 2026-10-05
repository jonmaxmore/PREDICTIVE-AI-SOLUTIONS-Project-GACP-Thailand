/**
 * Documents list + detail — ownership scope must survive the STAGE-A FK re-key.
 *
 * RED-first regression test.
 *
 * routes/api/documents/documents.js passed req.user.healthId (the DECRYPTED
 * PLAINTEXT national ID) into documentService.listApplicantApplicationsForDraftDocs /
 * findApplicantDraftDocument, which filter Application.healthId — an FK to
 * User.canonicalId that stores the keyed-HMAC TOKEN since detokenize STAGE A
 * (APP_FK_USE_TOKEN=true, LIVE on prod 2026-06-29). The plaintext never matches
 * the token, so:
 *   GET /api/documents      → [] (empty document list) for every applicant
 *   GET /api/documents/:id  → 404 (viewer dead) for every applicant
 *
 * Fix under test (breaker 3c of the detokenize RFC): the service accepts an
 * ownership scope `{ userId, healthId }` and prefers the
 * `applicant: { id: userId }` relation join (User.id is a UUID, never re-keyed
 * → correct in BOTH data states); the healthId fallback is the live FK key
 * (canonicalId), never the plaintext; empty scope fails closed (no broad query).
 *
 * The prisma mock EMULATES the post-re-key data state (rows carry the token in
 * healthId) instead of pinning a where-shape, so any correct fix passes and any
 * plaintext regression fails. document-service is NOT mocked — the tests drive
 * the real route→service→query chain.
 */

'use strict';

const express = require('express');
const request = require('supertest');

const USER_UUID = 'b3b8a4a0-1111-4222-8333-444455556666';
const OTHER_UUID = 'c4c9b5b1-9999-4888-8777-666655554444';
const PLAINTEXT_ID = '1234567890123'; // req.user.healthId — decrypted national ID
const FK_TOKEN = 'f'.repeat(64); // Application.healthId — post-STAGE-A HMAC token
const OTHER_TOKEN = 'e'.repeat(64);

const mockUser = {
    id: USER_UUID,
    userId: USER_UUID,
    healthId: PLAINTEXT_ID,
    canonicalId: FK_TOKEN,
    role: 'HEALTH_USER',
    canonicalRole: 'health',
};

jest.mock('../../middleware/auth-middleware', () => ({
    authenticateHealth: (req, _res, next) => {
        req.user = { ...mockUser };
        next();
    },
}));

/**
 * Post-STAGE-A rows: FK column holds the TOKEN; the applicant relation joins on
 * the (never re-keyed) User.id UUID.
 */
const mockRows = [
    {
        id: 'app-1',
        applicationNumber: 'GACP-001',
        healthId: FK_TOKEN,
        applicantUserId: USER_UUID,
        entityId: 'entity-own',
        isDeleted: false,
        formData: {
            draftDocuments: [
                {
                    documentId: 'doc-1',
                    fileName: 'sop.pdf',
                    fileUrl: '/uploads/application-drafts/sop.pdf',
                    stepKey: 'farm_info',
                    mimeType: 'application/pdf',
                    size: 1024,
                    uploadedAt: '2026-07-01T00:00:00.000Z',
                },
            ],
        },
    },
    {
        id: 'app-2',
        applicationNumber: 'GACP-002',
        healthId: OTHER_TOKEN,
        applicantUserId: OTHER_UUID,
        entityId: 'entity-other',
        isDeleted: false,
        formData: {
            draftDocuments: [
                { documentId: 'doc-2', fileName: 'other.pdf', fileUrl: '/uploads/application-drafts/other.pdf' },
            ],
        },
    },
];

// Behaves like the real DB post-re-key: a plaintext national ID in
// where.healthId matches nothing; the applicant relation matches on User.id.
function mockRowsMatching(where = {}) {
    return mockRows
        .filter((row) => {
            if (where.isDeleted !== undefined && where.isDeleted !== row.isDeleted) { return false; }
            if (where.healthId !== undefined && where.healthId !== row.healthId) { return false; }
            // R2 Task 12: the holder fragment (spec 2026-09-30 §3.1) decides the rows.
            if (where.entityId && Array.isArray(where.entityId.in) && !where.entityId.in.includes(row.entityId)) { return false; }
            if (where.applicant !== undefined) {
                const applicantWhere = where.applicant || {};
                if (applicantWhere.id !== undefined && applicantWhere.id !== row.applicantUserId) { return false; }
            }
            return true;
        })
        .map(({ id, applicationNumber, formData }) => ({ id, applicationNumber, formData }));
}

const mockFindMany = jest.fn(async ({ where }) => mockRowsMatching(where));

// the project rules rule: mock prisma-database (process.exit(1) without DATABASE_URL).
// The caller is an ACTIVE OWNER of entity-own only (holder-access reads memberships).
jest.mock('../../services/prisma-database', () => ({
    prisma: {
        application: { findMany: mockFindMany },
        entityMembership: {
            findMany: jest.fn(async ({ where } = {}) => (where && where.userId === 'b3b8a4a0-1111-4222-8333-444455556666'
                ? [{ entityId: 'entity-own', role: 'OWNER' }] : [])),
        },
    },
}));

jest.mock('../../shared/api-response', () => ({
    safeErrorMessage: jest.fn((e) => (e && e.message) || 'error'),
}));

jest.mock('../../shared/logger', () => {
    const mockLogger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...mockLogger, createLogger: jest.fn(() => mockLogger), stream: { write: jest.fn() } };
});

jest.mock('../../middleware/upload-middleware', () => ({
    single: jest.fn(() => (req, _res, next) => { req.file = null; next(); }),
    array: jest.fn(() => (_req, _res, next) => next()),
}));

const documentService = require('../../services/document-service');
const documentsRouter = require('../../routes/api/documents/documents');

describe('documents routes — ownership scope survives the STAGE-A healthId re-key', () => {
    let app;

    beforeAll(() => {
        app = express();
        app.use(express.json());
        app.use('/api/documents', documentsRouter);
    });

    beforeEach(() => {
        jest.clearAllMocks();
        mockFindMany.mockImplementation(async ({ where }) => mockRowsMatching(where));
        mockUser.id = USER_UUID;
        mockUser.userId = USER_UUID;
        mockUser.healthId = PLAINTEXT_ID;
        mockUser.canonicalId = FK_TOKEN;
    });

    describe('GET /api/documents (list)', () => {
        it('returns the owner\'s draft documents when Application.healthId stores the FK token', async () => {
            const res = await request(app).get('/api/documents');

            expect(res.status).toBe(200);
            expect(res.body.total).toBe(1);
            expect(res.body.data[0]).toMatchObject({
                id: 'doc-1',
                fileName: 'sop.pdf',
                applicationId: 'app-1',
            });
        });

        it('never queries Application.healthId with the plaintext national ID', async () => {
            await request(app).get('/api/documents');

            for (const [args] of mockFindMany.mock.calls) {
                expect(JSON.stringify(args && args.where)).not.toContain(PLAINTEXT_ID);
            }
        });

        it('does not return another applicant\'s documents (no over-broadening)', async () => {
            const res = await request(app).get('/api/documents');

            expect(res.status).toBe(200);
            expect(JSON.stringify(res.body)).not.toContain('doc-2');
        });
    });

    describe('GET /api/documents/:id (detail viewer)', () => {
        it('returns the owned document detail when Application.healthId stores the FK token', async () => {
            const res = await request(app).get('/api/documents/doc-1');

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data).toMatchObject({
                id: 'doc-1',
                fileName: 'sop.pdf',
                fileUrl: '/uploads/application-drafts/sop.pdf',
                applicationId: 'app-1',
            });
        });

        it('404s for a cross-owner document id (anti-IDOR preserved)', async () => {
            const res = await request(app).get('/api/documents/doc-2');

            expect(res.status).toBe(404);
            expect(res.body.success).toBe(false);
        });

        it('never queries Application.healthId with the plaintext national ID', async () => {
            await request(app).get('/api/documents/doc-1');

            for (const [args] of mockFindMany.mock.calls) {
                expect(JSON.stringify(args && args.where)).not.toContain(PLAINTEXT_ID);
            }
        });
    });

    describe('document-service fail-closed scope (no broad query)', () => {
        it('listApplicantApplicationsForDraftDocs with an empty scope returns [] without querying', async () => {
            const result = await documentService.listApplicantApplicationsForDraftDocs({});

            expect(result).toEqual([]);
            expect(mockFindMany).not.toHaveBeenCalled();
        });

        it('findApplicantDraftDocument with an empty scope returns null without querying', async () => {
            const result = await documentService.findApplicantDraftDocument({}, 'doc-1');

            expect(result).toBeNull();
            expect(mockFindMany).not.toHaveBeenCalled();
        });
    });
});
