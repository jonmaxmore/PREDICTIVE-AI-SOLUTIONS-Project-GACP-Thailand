/**
 * SEC-SYS-002 regression (Prisma-backed) — support-ticket endpoints addressed by
 * :id must scope to the ticket owner for HEALTH users. getTicketById / addMessage /
 * resolve / close fetch the ticket then apply the ownership gate (HEALTH callers
 * may only touch tickets where creatorId === their userId); provider/support roles
 * unrestricted. Denials return 404 so existence is not leaked.
 *
 * Tickets are now persisted via Prisma (Ticket + TicketMessage) — was in-memory.
 */
'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../../middleware/auth-middleware', () => ({
    authenticateHealth: (req, _res, next) => {
        // Faithful to what authenticateHealth actually builds
        // (middleware/auth-middleware.js:482). This fixture used to supply
        // `role: 'health'` (lowercase) and `userId` — neither of which the real
        // middleware produces: `role` is the raw DB column `"HEALTH"` and the
        // identity field is `id`. Because the fixture matched the BUG's
        // assumptions rather than production, every assertion below passed
        // while cross-tenant reads were wide open in the running system.
        const rawRole = req.headers['x-test-role'] || 'HEALTH';
        req.user = {
            id: req.headers['x-test-user-id'] || 'u-health',
            role: rawRole,
            canonicalRole: rawRole.toLowerCase(),
        };
        next();
    },
    checkPermission: () => (_req, _res, next) => next(),
}));

jest.mock('../../services/prisma-database', () => ({
    prisma: {
        ticket: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
        ticketMessage: { create: jest.fn() },
    },
}));

const { prisma } = require('../../services/prisma-database');
const ticketsRouter = require('../../routes/api/system/tickets');

const app = express();
app.use(express.json());
app.use('/api/tickets', ticketsRouter);

const asHealth = (req, userId) => req.set('x-test-role', 'health').set('x-test-user-id', userId);
const OWNED = { id: 't1', creatorId: 'owner-A', isDeleted: false, status: 'open', messages: [] };

beforeEach(() => {
    jest.clearAllMocks();
    // Honour `where.creatorId` instead of returning the row unconditionally.
    // A filter-blind mock cannot observe an ownership scope at all: it returned
    // the ticket no matter who asked, so these assertions could never fail —
    // which is the second reason the cross-tenant read went unnoticed.
    prisma.ticket.findFirst.mockImplementation(async ({ where = {} } = {}) => {
        if (where.creatorId !== undefined && where.creatorId !== OWNED.creatorId) {return null;}
        return { ...OWNED };
    });
    prisma.ticket.update.mockImplementation(({ data }) => Promise.resolve({ ...OWNED, ...data }));
    prisma.ticketMessage.create.mockResolvedValue({});
});

describe('SEC-SYS-002 — ticket ownership scoping (Prisma-backed)', () => {
    test('a different HEALTH user cannot read another user\'s ticket (404)', async () => {
        const res = await asHealth(request(app).get('/api/tickets/t1'), 'attacker-B');
        expect(res.status).toBe(404);
    });

    test('the owner can read their own ticket (200)', async () => {
        const res = await asHealth(request(app).get('/api/tickets/t1'), 'owner-A');
        expect(res.status).toBe(200);
        expect(res.body.data.id).toBe('t1');
    });

    test('a provider/support role can read any ticket (200)', async () => {
        const res = await request(app).get('/api/tickets/t1').set('x-test-role', 'admin').set('x-test-user-id', 'support-1');
        expect(res.status).toBe(200);
    });

    test('a different HEALTH user cannot message another user\'s ticket (404, no write)', async () => {
        const res = await asHealth(request(app).post('/api/tickets/t1/messages'), 'attacker-B').send({ content: 'sneaky' });
        expect(res.status).toBe(404);
        expect(prisma.ticketMessage.create).not.toHaveBeenCalled();
    });

    test('a different HEALTH user cannot resolve or close another user\'s ticket (404, no update)', async () => {
        const r1 = await asHealth(request(app).put('/api/tickets/t1/resolve'), 'attacker-B');
        const r2 = await asHealth(request(app).put('/api/tickets/t1/close'), 'attacker-B');
        expect(r1.status).toBe(404);
        expect(r2.status).toBe(404);
        expect(prisma.ticket.update).not.toHaveBeenCalled();
    });
});

describe('tickets are persisted via Prisma', () => {
    test('createTicket writes through prisma.ticket.create (201)', async () => {
        prisma.ticket.create.mockResolvedValue({ id: 't2', creatorId: 'owner-A', status: 'open', messages: [] });
        const res = await asHealth(request(app).post('/api/tickets'), 'owner-A').send({ title: 'help me' });
        expect(res.status).toBe(201);
        expect(prisma.ticket.create).toHaveBeenCalledTimes(1);
        expect(prisma.ticket.create.mock.calls[0][0].data.creatorId).toBe('owner-A');
    });

    test('the owner can resolve their own ticket (200, update called)', async () => {
        const res = await asHealth(request(app).put('/api/tickets/t1/resolve'), 'owner-A');
        expect(res.status).toBe(200);
        expect(prisma.ticket.update).toHaveBeenCalledTimes(1);
    });

    test('list scopes a HEALTH caller to their own tickets', async () => {
        prisma.ticket.findMany.mockResolvedValue([]);
        await asHealth(request(app).get('/api/tickets'), 'owner-A');
        expect(prisma.ticket.findMany.mock.calls[0][0].where.creatorId).toBe('owner-A');
    });
});

// HD-ADMIN info-disclosure hardening: a thrown DB error must surface a 500
// with a generic, sanitized body — never the raw error.message (which can
// leak Prisma/SQL internals, file paths, or PII like column names + values).
describe('info-disclosure — raw error.message is not echoed in 5xx', () => {
    // A message that the safeErrorMessage allowlist must reject (it names a
    // Prisma internal + a file path + a constraint, all unsafe indicators).
    const LEAKY =
        'Invalid `prisma.ticket.findMany()` invocation in /app/routes/api/system/tickets.js:38 — unique constraint failed on healthIdHash';

    test('list (GET /) returns generic 500, not the raw Prisma message', async () => {
        prisma.ticket.findMany.mockRejectedValue(new Error(LEAKY));
        const res = await asHealth(request(app).get('/api/tickets'), 'owner-A');
        expect(res.status).toBe(500);
        const body = JSON.stringify(res.body);
        expect(body).not.toContain('prisma.ticket');
        expect(body).not.toContain('healthIdHash');
        expect(body).not.toContain('/app/');
        expect(res.body.success).toBe(false);
    });

    test('get-by-id (GET /:id) returns generic 500, not the raw Prisma message', async () => {
        prisma.ticket.findFirst.mockRejectedValue(new Error(LEAKY));
        const res = await asHealth(request(app).get('/api/tickets/t1'), 'owner-A');
        expect(res.status).toBe(500);
        expect(JSON.stringify(res.body)).not.toContain('healthIdHash');
    });

    test('a P2025 (record-not-found) Prisma error maps to 404, not 500', async () => {
        // respondError classifies known Prisma client errors: a missing-record
        // update should be a 404, not a server fault.
        const notFound = Object.assign(new Error('Record to update not found'), {
            name: 'PrismaClientKnownRequestError',
            code: 'P2025',
        });
        prisma.ticket.findFirst.mockResolvedValue({ ...OWNED });
        prisma.ticket.update.mockRejectedValue(notFound);
        const res = await asHealth(request(app).put('/api/tickets/t1/resolve'), 'owner-A');
        expect(res.status).toBe(404);
    });
});
