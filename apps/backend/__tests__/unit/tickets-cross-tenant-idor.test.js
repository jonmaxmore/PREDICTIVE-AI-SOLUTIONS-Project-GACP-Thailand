/**
 * SEC — support tickets must not cross applicant boundaries.
 *
 * The ownership gate in routes/api/system/tickets.js was dead code, for two
 * INDEPENDENT reasons. Either one alone is enough to expose every tenant's
 * tickets to every authenticated applicant:
 *
 *   1. Case mismatch. `User.role` is `@default("HEALTH")` (auth.prisma:104) and
 *      the token carries that raw value, but the guard compared it against the
 *      lowercase literal `'health'`. `'HEALTH' !== 'health'` is always true, so
 *      `healthOwns()` returned true for every caller.
 *
 *   2. Field that does not exist. The token payload carries `id`
 *      (prisma-auth-service.js:481), never `userId`. The handlers read
 *      `req.user.userId` → `undefined` → `where.creatorId = undefined`, and
 *      Prisma DROPS an undefined filter rather than matching nothing. The list
 *      endpoints therefore returned every row instead of none.
 *
 * The tenant Prisma extension does scope `Ticket` by organizationId, but that
 * is not a boundary between applicants: every self-registered applicant is
 * placed in the single `default` organization (prisma-auth-service.js:184-203),
 * so they all share one tenant.
 *
 * These tests mirror the REAL token shape — uppercase `role`, no `userId` —
 * because a fixture that supplies `userId` or a lowercase role would pass
 * against the vulnerable code and prove nothing.
 */

'use strict';

const express = require('express');
const request = require('supertest');

// Auth mock — deliberately faithful to what authenticateHealth actually builds:
// raw uppercase `role` from the DB, normalised `canonicalRole`, `id` and NO
// `userId`. See middleware/auth-middleware.js:482.
jest.mock('../../middleware/auth-middleware', () => {
    const attach = (req, res, next) => {
        const userId = req.headers['x-test-user-id'];
        if (!userId) {return res.status(401).json({ success: false, error: 'Unauthorized' });}
        req.user = {
            id: userId,
            role: req.headers['x-test-role'] || 'HEALTH',
            canonicalRole: (req.headers['x-test-role'] || 'HEALTH').toLowerCase(),
            healthId: req.headers['x-test-health-id'] || `health-${userId}`,
            organizationId: 'org-default',
        };
        return next();
    };
    return {
        authenticateHealth: attach,
        authenticateAny: attach,
        authenticateProvider: attach,
        checkPermission: () => (_req, _res, next) => next(),
    };
});

const ticketStore = [];

jest.mock('../../services/prisma-database', () => ({
    prisma: {
        ticket: {
            // Faithful to Prisma semantics: an `undefined` value in `where` is
            // IGNORED, which is precisely how the vulnerability leaked rows.
            findMany: jest.fn(async ({ where = {} }) => ticketStore.filter((t) => {
                if (where.isDeleted === false && t.isDeleted) {return false;}
                if (where.creatorId !== undefined && t.creatorId !== where.creatorId) {return false;}
                if (where.relatedApplication !== undefined
                    && t.relatedApplication !== where.relatedApplication) {return false;}
                return true;
            })),
            findFirst: jest.fn(async ({ where = {} }) => ticketStore.find((t) => {
                if (where.id !== undefined && t.id !== where.id) {return false;}
                if (where.isDeleted === false && t.isDeleted) {return false;}
                if (where.creatorId !== undefined && t.creatorId !== where.creatorId) {return false;}
                return true;
            }) || null),
            create: jest.fn(async ({ data }) => {
                const row = { id: `ticket-${ticketStore.length + 1}`, messages: [], isDeleted: false, ...data };
                ticketStore.push(row);
                return row;
            }),
            update: jest.fn(async ({ where, data }) => {
                const row = ticketStore.find((t) => t.id === where.id);
                Object.assign(row, data);
                return row;
            }),
        },
        ticketMessage: { create: jest.fn(async ({ data }) => data) },
    },
}));

jest.mock('../../shared/api-response', () => ({
    respondError: (res, _req, err) => res.status(500).json({ success: false, message: err.message }),
}));

const ticketsRouter = require('../../routes/api/system/tickets');

const APPLICANT_A = 'user-applicant-a';
const APPLICANT_B = 'user-applicant-b';

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/tickets', ticketsRouter);
    return app;
}

function asApplicant(agent, userId) {
    return agent.set('x-test-user-id', userId).set('x-test-role', 'HEALTH');
}

describe('SEC — ticket isolation between applicants', () => {
    let app;

    beforeEach(() => {
        ticketStore.length = 0;
        ticketStore.push({
            id: 'ticket-a',
            title: 'ใบรับรองของผมหาย',
            description: 'เอกสารส่วนตัวของ A',
            creatorId: APPLICANT_A,
            status: 'open',
            isDeleted: false,
            relatedApplication: 'app-a',
            messages: [],
        });
        app = buildApp();
    });

    it('does not let applicant B read applicant A ticket by id', async () => {
        const res = await asApplicant(request(app).get('/api/tickets/ticket-a'), APPLICANT_B);
        expect(res.status) /* applicant B was served another applicant ticket */.toBe(404);
        expect(JSON.stringify(res.body)).not.toContain('เอกสารส่วนตัวของ A');
    });

    it('does not list another applicant tickets', async () => {
        const res = await asApplicant(request(app).get('/api/tickets'), APPLICANT_B);
        expect(res.status).toBe(200);
        const ids = (res.body.data || []).map((t) => t.id);
        expect(ids) /* ticket list leaked rows belonging to another applicant */.toEqual([]);
    });

    it('does not list another applicant tickets for a given application', async () => {
        const res = await asApplicant(
            request(app).get('/api/tickets/application/app-a'), APPLICANT_B,
        );
        expect(res.status).toBe(200);
        expect((res.body.data || []).map((t) => t.id)).toEqual([]);
    });

    it('does not let applicant B post a message onto applicant A ticket', async () => {
        const res = await asApplicant(
            request(app).post('/api/tickets/ticket-a/messages'), APPLICANT_B,
        ).send({ content: 'injected by B' });
        expect(res.status) /* applicant B wrote into another applicant ticket */.toBe(404);
    });

    it('does not let applicant B resolve or close applicant A ticket', async () => {
        const resolve = await asApplicant(
            request(app).put('/api/tickets/ticket-a/resolve'), APPLICANT_B,
        );
        expect(resolve.status).toBe(404);

        const close = await asApplicant(
            request(app).put('/api/tickets/ticket-a/close'), APPLICANT_B,
        );
        expect(close.status).toBe(404);

        expect(ticketStore.find((t) => t.id === 'ticket-a').status) /* another applicant changed the ticket state */.toBe('open');
    });

    it('still lets the owner read their own ticket', async () => {
        const res = await asApplicant(request(app).get('/api/tickets/ticket-a'), APPLICANT_A);
        expect(res.status) /* the legitimate owner was locked out */.toBe(200);
        expect(res.body.data.id).toBe('ticket-a');
    });

    it('records the creator from the identity field that actually exists', async () => {
        // Pins the `userId` half of the defect: a ticket created with an
        // undefined creator is unownable, so it leaks to everyone forever.
        const res = await asApplicant(request(app).post('/api/tickets'), APPLICANT_B)
            .send({ title: 'B ticket', description: 'x', category: 'general', priority: 'low' });
        expect(res.status).toBe(201);
        expect(res.body.data.creatorId) /* creatorId was not persisted from req.user.id */.toBe(APPLICANT_B);
    });
});
