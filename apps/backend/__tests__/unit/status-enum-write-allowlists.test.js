'use strict';

/**
 * DEFENSIVE BOUNDARY — status enum writes must be allowlisted at the entrypoint.
 *
 * Two handlers wrote a caller-supplied `status` string straight into a column
 * whose legal values the schema itself documents:
 *
 *   routes/api/documents/templates.js:174   `if (status) { updateData.status = status; }`
 *       system.prisma:110  status String @default("DRAFT") // DRAFT, ACTIVE, DEPRECATED
 *
 *   routes/api/cultivation/harvest-batches.js  `status: status || 'RECEIVED'`
 *       harvest.prisma:54  status String @default("RECEIVED") // RECEIVED, DRYING, PROCESSED, PACKED, SOLD
 *
 * Neither is a privilege escalation — templates is admin-gated, and an applicant
 * can only do this to their OWN harvest batch. Both are integrity breaks, and
 * the harvest one is the worse of the two because the value is a lifecycle
 * state: writing an unknown string strands the row outside every status filter
 * and dashboard bucket that switches on it, with no error at write time and
 * nothing to notice later. `String` columns give no database-level protection,
 * so the entrypoint is the only place this can be caught.
 *
 * The allowlists below are taken from the schema comments, not invented — the
 * schema is the declared contract for these columns.
 *
 * Note both handlers previously accepted the bad value silently; rejecting it
 * with a 400 is a behaviour change only for input that was already malformed.
 */

const express = require('express');
const request = require('supertest');

jest.mock('../../shared/logger', () => {
    const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...l, createLogger: jest.fn(() => l) };
});

let mockUser = { id: 'admin-1', canonicalRole: 'admin', role: 'ADMIN', organizationId: 'org-1' };
jest.mock('../../middleware/auth-middleware', () => {
    const pass = (req, _res, next) => { req.user = mockUser; next(); };
    return {
        authenticateProvider: pass, authenticatePROVIDER: pass,
        authenticateAny: pass, authenticateHealth: pass,
    };
});
jest.mock('../../middleware/role-middleware', () => ({
    adminOnly: (_req, _res, next) => next(),
    providerOnly: (_req, _res, next) => next(),
    requireRole: () => (_req, _res, next) => next(),
}));

const mockTemplateUpdate = jest.fn(async ({ data }) => ({ id: 'tpl-1', ...data }));
const mockTemplateFindUnique = jest.fn(async () => ({ id: 'tpl-1', status: 'ACTIVE' }));
const mockHarvestCreate = jest.fn(async ({ data }) => ({ id: 'hb-1', ...data }));

jest.mock('../../services/prisma-database', () => ({
    prisma: {
        documentTemplate: {
            update: (...a) => mockTemplateUpdate(...a),
            findUnique: (...a) => mockTemplateFindUnique(...a),
            findFirst: (...a) => mockTemplateFindUnique(...a),
        },
        template: {
            update: (...a) => mockTemplateUpdate(...a),
            findUnique: (...a) => mockTemplateFindUnique(...a),
        },
        harvestBatch: {
            create: (...a) => mockHarvestCreate(...a),
            findFirst: jest.fn(async () => null),
            count: jest.fn(async () => 0),
        },
        farm: { findFirst: jest.fn(async () => ({ id: 'farm-1', ownerId: 'user-1' })) },
        $transaction: jest.fn(async (cb) => (typeof cb === 'function' ? cb({}) : cb)),
    },
}));

describe('DEFENSIVE BOUNDARY — Template.status is allowlisted', () => {
    let app;

    beforeEach(() => {
        jest.clearAllMocks();
        mockUser = { id: 'admin-1', canonicalRole: 'admin', role: 'ADMIN', organizationId: 'org-1' };
        app = express();
        app.use(express.json());
        app.use('/api/templates', require('../../routes/api/documents/templates'));
    });

    it.each([
        ['garbage'],
        ['active'],       // right word, wrong case — the column is uppercase
        ['DELETED'],      // plausible but not a declared value
        ['  ACTIVE  '],   // untrimmed
        [''],
    ])('refuses status %p and writes nothing', async (bad) => {
        const res = await request(app).put('/api/templates/tpl-1').send({ status: bad });

        if (bad === '') {
            // Falsy — the handler legitimately treats it as "not supplied".
            expect(mockTemplateUpdate.mock.calls[0]?.[0]?.data?.status).toBeUndefined();
            return;
        }
        expect(res.status).toBe(400);
        expect(mockTemplateUpdate).not.toHaveBeenCalled();
    });

    it.each([['DRAFT'], ['ACTIVE'], ['DEPRECATED']])('still accepts the declared value %p', async (good) => {
        const res = await request(app).put('/api/templates/tpl-1').send({ status: good });

        expect(res.status).not.toBe(400);
        expect(mockTemplateUpdate.mock.calls[0][0].data.status).toBe(good);
    });

    it('still allows a metadata-only update with no status', async () => {
        const res = await request(app).put('/api/templates/tpl-1').send({ titleTH: 'แบบฟอร์มใหม่' });

        expect(res.status).not.toBe(400);
        expect(mockTemplateUpdate.mock.calls[0][0].data.titleTH).toBe('แบบฟอร์มใหม่');
    });
});
