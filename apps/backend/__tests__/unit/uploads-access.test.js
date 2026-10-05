/**
 * SEC-AUDIT-002 — scoped /uploads protection.
 *
 * Sensitive paths (root-level ID-card/avatar files + payment slips) must require a
 * valid session; intended-public subfolder assets (e.g. lab-test reports linked on
 * the public consumer trace page) must stay reachable anonymously. A mount-wide
 * gate was reverted precisely because it broke those public links.
 *
 * See middleware/uploads-access.js + docs/handoffs/audit-2026-05-31/14-remediation-log.md.
 */
'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../../services/prisma-database', () => ({ prisma: {} }));

const { gateSensitiveUploads } = require('../../middleware/uploads-access');

// Mirror the server.js mount: scoped gate BEFORE the (stubbed) static handler.
const app = express();
app.use('/uploads', gateSensitiveUploads, (_req, res) => res.status(200).send('FILE-BYTES'));

describe('SEC-AUDIT-002 — sensitive /uploads paths require auth', () => {
    test('anonymous CANNOT fetch a root-level file (ID card / avatar) → 401', async () => {
        const res = await request(app).get('/uploads/1716000000000-abc123.jpg');
        expect(res.status).toBe(401);
        expect(res.text).not.toContain('FILE-BYTES');
    });

    test('anonymous CANNOT fetch a payment slip → 401', async () => {
        const res = await request(app).get('/uploads/slips/1716000000000-def456.pdf');
        expect(res.status).toBe(401);
        expect(res.text).not.toContain('FILE-BYTES');
    });

    test('a forged token on a sensitive path is still rejected → 401', async () => {
        const res = await request(app)
            .get('/uploads/secret-idcard.jpg')
            .set('authorization', 'Bearer not-a-real-token');
        expect(res.status).toBe(401);
    });
});

describe('B-DOC-01 — applicant draft documents now require auth', () => {
    test('anonymous CANNOT fetch an application-drafts asset → 401', async () => {
        const res = await request(app).get('/uploads/application-drafts/applicant-doc.pdf');
        expect(res.status).toBe(401);
        expect(res.text).not.toContain('FILE-BYTES');
    });

    test('anonymous CANNOT fetch a wizard-drafts asset → 401', async () => {
        const res = await request(app).get('/uploads/wizard-drafts/doc.pdf');
        expect(res.status).toBe(401);
        expect(res.text).not.toContain('FILE-BYTES');
    });
});

describe('SEC-AUDIT-002 — intended-public /uploads assets stay anonymous', () => {
    test('a public lab-report subfolder asset is served anonymously (consumer trace)', async () => {
        const res = await request(app).get('/uploads/lab-reports/lab-result.pdf');
        expect(res.status).toBe(200);
        expect(res.text).toBe('FILE-BYTES');
    });
});
