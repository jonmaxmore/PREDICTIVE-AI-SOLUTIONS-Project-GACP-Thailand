/**
 * W1-2 — the authenticated mint endpoint.
 *
 * Contract: `POST /api/files/signed-url { fileUrl }` mints a short-lived signed
 * URL ONLY for a file the caller is already entitled to read. The invariant is
 * "a mint is never more permissive than what this caller's own session could
 * already GET from /uploads" — the mint reuses the SAME object ACL the static
 * gate uses (middleware/uploads-access.js), it does not fork a second one.
 */
'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../../services/prisma-database', () => ({
    prisma: {
        user: { findUnique: jest.fn() },
        applicationDocument: { findFirst: jest.fn() },
        applicationDraft: { findFirst: jest.fn() },
        attachment: { findFirst: jest.fn() },
        application: { findFirst: jest.fn() },
    },
}));

// `mock`-prefixed so the jest.mock factory may close over it (jest hoists the
// factory above the variable declarations otherwise).
let mockUser = null;
jest.mock('../../middleware/auth-middleware', () => ({
    authenticateAny: (req, res, next) => {
        if (!mockUser) {
            return res.status(401).json({ success: false, error: 'Unauthorized', code: 'NO_TOKEN' });
        }
        req.user = mockUser;
        return next();
    },
}));

const { prisma } = require('../../services/prisma-database');
const storage = require('../../services/storage-service');
const filesRouter = require('../../routes/api/files/files');

const app = express();
app.use(express.json());
app.use('/api/files', filesRouter);

function setUser(user) {
    mockUser = user;
}

beforeEach(() => {
    jest.clearAllMocks();
    setUser({ id: 'user-owner-1', organizationId: 'org-1', role: 'health', canonicalRole: 'health' });
});

describe('POST /api/files/signed-url — authentication', () => {
    test('anonymous → 401', async () => {
        setUser(null);
        const res = await request(app).post('/api/files/signed-url').send({ fileUrl: '/uploads/x.png' });
        expect(res.status).toBe(401);
        expect(res.body.code).toBe('NO_TOKEN');
    });

    test('a non-/uploads path → 400 INVALID_PATH', async () => {
        const res = await request(app)
            .post('/api/files/signed-url')
            .send({ fileUrl: '/etc/passwd' });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('INVALID_PATH');
    });

    test('a traversal path → 400 INVALID_PATH', async () => {
        const res = await request(app)
            .post('/api/files/signed-url')
            .send({ fileUrl: '/uploads/../server.js' });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('INVALID_PATH');
    });
});

describe('POST /api/files/signed-url — entitlement (avatar root file)', () => {
    test('the avatar owner can mint', async () => {
        prisma.user.findUnique.mockResolvedValue({
            id: 'user-owner-1',
            privacySettings: { avatar: '/uploads/my-avatar.png' },
        });

        const res = await request(app)
            .post('/api/files/signed-url')
            .send({ fileUrl: '/uploads/my-avatar.png' });

        expect(res.status).toBe(200);
        const query = Object.fromEntries(new URLSearchParams(res.body.data.url.split('?')[1]));
        expect(storage.verifySignedObjectRequest('my-avatar.png', query).valid).toBe(true);
    });

    test('another user cannot mint for someone else\'s avatar → 404', async () => {
        prisma.user.findUnique.mockResolvedValue({
            id: 'user-owner-1',
            privacySettings: { avatar: '/uploads/my-avatar.png' },
        });

        const res = await request(app)
            .post('/api/files/signed-url')
            .send({ fileUrl: '/uploads/someone-elses-avatar.png' });

        expect(res.status).toBe(404);
    });
});

describe('POST /api/files/signed-url — entitlement (application draft documents)', () => {
    test('the document owner can mint', async () => {
        prisma.applicationDocument.findFirst.mockResolvedValue({
            uploadedBy: 'user-owner-1',
            application: { healthId: null, organizationId: 'org-1' },
        });

        const res = await request(app)
            .post('/api/files/signed-url')
            .send({ fileUrl: '/uploads/application-drafts/doc.pdf' });

        expect(res.status).toBe(200);
    });

    test('a stranger in another tenant → 404', async () => {
        prisma.applicationDocument.findFirst.mockResolvedValue({
            uploadedBy: 'someone-else',
            application: { healthId: null, organizationId: 'org-OTHER' },
        });

        const res = await request(app)
            .post('/api/files/signed-url')
            .send({ fileUrl: '/uploads/application-drafts/doc.pdf' });

        expect(res.status).toBe(404);
    });
});

describe('POST /api/files/signed-url — the mint never logs or echoes a secret', () => {
    test('the response carries only url + expiresAt', async () => {
        prisma.user.findUnique.mockResolvedValue({
            id: 'user-owner-1',
            privacySettings: { avatar: '/uploads/my-avatar.png' },
        });
        const res = await request(app)
            .post('/api/files/signed-url')
            .send({ fileUrl: '/uploads/my-avatar.png' });

        expect(Object.keys(res.body.data).sort()).toEqual(['expiresAt', 'url']);
    });
});

describe('public /uploads assets do not need a mint', () => {
    test('a lab-report path mints without an object lookup (already anonymous)', async () => {
        const res = await request(app)
            .post('/api/files/signed-url')
            .send({ fileUrl: '/uploads/lab-reports/report.pdf' });
        expect(res.status).toBe(200);
        expect(mockUser).toBeTruthy();
    });
});
