/**
 * C2 (HIGH) — draft document bytes need an owner/tenant object-ACL, not just a
 * valid session.
 *
 * `gateSensitiveUploads` proves only that a `/uploads/{application,wizard}-drafts/*`
 * request carries a session; the owner check lives on the JSON metadata route
 * (documents.js), NOT on the byte stream. So any authenticated user (another
 * applicant, or a cross-tenant provider) who learns a draft URL could stream
 * another applicant's ID-card / farm-deed scan.
 *
 * Fix: gateSlipObjectAccess now also gates draft paths. It resolves the file →
 * owning application (application-drafts, via the relational application_documents
 * store dual-written on upload) or owning draft (wizard-drafts, via ApplicationDraft),
 * then denies non-owner / non-authorized-reviewer with 404 (anti-enumeration).
 *
 * B3 (2026-08-23) — the INTERIM pass-through is REMOVED. It made deleting a
 * draft attachment INCREASE its exposure: the delete hard-deleted the
 * `application_documents` row (the only owner record this gate read) and left
 * the bytes on disk, so the object flipped from "404 for everyone but the owner"
 * to "200 for any logged-in user". The gate now fails CLOSED — an object whose
 * owner cannot be established is refused — and resolution first falls back to
 * the canonical `Application.formData.draftDocuments` store, so a legitimate
 * owner whose best-effort dual-write never landed (H7) keeps their access.
 */
'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../../middleware/auth-middleware', () => ({
    authenticateAny: (req, res, next) => {
        const raw = req.headers['x-test-user'];
        if (!raw) {
            return res.status(401).json({ success: false, code: 'NO_TOKEN' });
        }
        req.user = JSON.parse(raw);
        return next();
    },
}));

const mockPrisma = {
    applicationDocument: { findFirst: jest.fn() },
    applicationDraft: { findFirst: jest.fn() },
    // B3: canonical-store fallback for application-drafts.
    application: { findFirst: jest.fn() },
};
jest.mock('../../services/prisma-database', () => ({ prisma: mockPrisma }));


const { gateSensitiveUploads, gateSlipObjectAccess } = require('../../middleware/uploads-access');

function buildApp() {
    const app = express();
    app.use(
        '/uploads',
        gateSensitiveUploads,
        gateSlipObjectAccess,
        (_req, res) => res.status(200).send('FILE-BYTES'),
    );
    return app;
}

const APP_DRAFT = '/uploads/application-drafts/1716000000000-abc.pdf';
const WIZ_DRAFT = '/uploads/wizard-drafts/1716000000000-def.pdf';

function u(obj) { return JSON.stringify(obj); }

beforeEach(() => {
    mockPrisma.applicationDocument.findFirst.mockReset();
    mockPrisma.applicationDraft.findFirst.mockReset();
    mockPrisma.application.findFirst.mockReset();
    mockPrisma.application.findFirst.mockResolvedValue(null);
});

describe('C2 — application-drafts object-ACL', () => {
    beforeEach(() => {
        // Resolves to an app owned by canonicalId token 'TOK', uploaded by UUID 'u1', org 'org1'.
        mockPrisma.applicationDocument.findFirst.mockResolvedValue({
            uploadedBy: 'u1',
            application: { healthId: 'TOK', organizationId: 'org1' },
        });
    });

    test('owner (by FK token / canonicalId) is served → 200', async () => {
        const res = await request(buildApp())
            .get(APP_DRAFT)
            .set('x-test-user', u({ id: 'uX', canonicalId: 'TOK', canonicalRole: 'health', organizationId: 'orgX' }));
        expect(res.status).toBe(200);
        expect(res.text).toBe('FILE-BYTES');
    });

    test('owner (by uploader UUID) is served → 200', async () => {
        const res = await request(buildApp())
            .get(APP_DRAFT)
            .set('x-test-user', u({ id: 'u1', canonicalId: 'nomatch', canonicalRole: 'health' }));
        expect(res.status).toBe(200);
    });

    test('a DIFFERENT authenticated applicant → 404 (anti-enumeration, not served)', async () => {
        const res = await request(buildApp())
            .get(APP_DRAFT)
            .set('x-test-user', u({ id: 'u2', canonicalId: 'OTHER', canonicalRole: 'health', organizationId: 'org1' }));
        expect(res.status).toBe(404);
        expect(res.text).not.toContain('FILE-BYTES');
    });

    test('a cross-TENANT provider → 404 (not served)', async () => {
        const res = await request(buildApp())
            .get(APP_DRAFT)
            .set('x-test-user', u({ id: 'p1', canonicalRole: 'field_inspector', organizationId: 'orgZ' }));
        expect(res.status).toBe(404);
        expect(res.text).not.toContain('FILE-BYTES');
    });

    test('a same-tenant provider reviewer → 200 (may view application docs)', async () => {
        const res = await request(buildApp())
            .get(APP_DRAFT)
            .set('x-test-user', u({ id: 'p1', canonicalRole: 'field_inspector', organizationId: 'org1' }));
        expect(res.status).toBe(200);
    });
});

describe('C2 — wizard-drafts object-ACL (owner-only)', () => {
    test('owner (ApplicationDraft.userId UUID) → 200', async () => {
        mockPrisma.applicationDraft.findFirst.mockResolvedValue({ userId: 'u1', organizationId: 'org1' });
        const res = await request(buildApp())
            .get(WIZ_DRAFT)
            .set('x-test-user', u({ id: 'u1', canonicalId: 'TOK', canonicalRole: 'health' }));
        expect(res.status).toBe(200);
    });

    test('a different authenticated user → 404', async () => {
        mockPrisma.applicationDraft.findFirst.mockResolvedValue({ userId: 'u1', organizationId: 'org1' });
        const res = await request(buildApp())
            .get(WIZ_DRAFT)
            .set('x-test-user', u({ id: 'u2', canonicalId: 'X', canonicalRole: 'health' }));
        expect(res.status).toBe(404);
        expect(res.text).not.toContain('FILE-BYTES');
    });
});

describe('B3 — unresolvable draft object fails CLOSED', () => {
    test('an application-draft with NO owner record anywhere → 404, bytes never served', async () => {
        mockPrisma.applicationDocument.findFirst.mockResolvedValue(null);
        mockPrisma.application.findFirst.mockResolvedValue(null);
        const res = await request(buildApp())
            .get(APP_DRAFT)
            .set('x-test-user', u({ id: 'u1', canonicalRole: 'health' }));
        expect(res.status).toBe(404);
        expect(res.text).not.toContain('FILE-BYTES');
        // never mistaken for a slip
    });

    test('an unresolvable wizard-draft → 404, bytes never served', async () => {
        mockPrisma.applicationDraft.findFirst.mockResolvedValue(null);
        const res = await request(buildApp())
            .get(WIZ_DRAFT)
            .set('x-test-user', u({ id: 'u1', canonicalRole: 'health' }));
        expect(res.status).toBe(404);
        expect(res.text).not.toContain('FILE-BYTES');
    });

    test('a resolver ERROR does not serve the bytes → 500', async () => {
        mockPrisma.applicationDocument.findFirst.mockRejectedValue(new Error('db down'));
        const res = await request(buildApp())
            .get(APP_DRAFT)
            .set('x-test-user', u({ id: 'u1', canonicalRole: 'health' }));
        expect(res.status).toBe(500);
        expect(res.text).not.toContain('FILE-BYTES');
    });
});

describe('B3 — canonical-store fallback keeps the real owner working (H7)', () => {
    beforeEach(() => {
        // The best-effort dual-write never landed: no application_documents row,
        // but the canonical JSON store still records the upload.
        mockPrisma.applicationDocument.findFirst.mockResolvedValue(null);
        mockPrisma.application.findFirst.mockResolvedValue({
            healthId: 'TOK', organizationId: 'org1', submitterId: 'u1',
        });
    });

    test('owner (by FK token) still served → 200', async () => {
        const res = await request(buildApp())
            .get(APP_DRAFT)
            .set('x-test-user', u({ id: 'uX', canonicalId: 'TOK', canonicalRole: 'health' }));
        expect(res.status).toBe(200);
        expect(res.text).toBe('FILE-BYTES');
    });

    test('a DIFFERENT applicant is still refused → 404', async () => {
        const res = await request(buildApp())
            .get(APP_DRAFT)
            .set('x-test-user', u({ id: 'u2', canonicalId: 'OTHER', canonicalRole: 'health' }));
        expect(res.status).toBe(404);
        expect(res.text).not.toContain('FILE-BYTES');
    });
});

describe('C2 — regression', () => {
    test('anonymous draft request is still auth-gated → 401', async () => {
        const res = await request(buildApp()).get(APP_DRAFT);
        expect(res.status).toBe(401);
    });
});
