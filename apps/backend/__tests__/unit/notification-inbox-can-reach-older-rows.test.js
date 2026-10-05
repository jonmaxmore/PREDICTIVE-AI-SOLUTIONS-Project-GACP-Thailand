/**
 * The inbox door hard-capped at the 50 newest rows and offered no way to ask for
 * older ones: `take: 50`, `orderBy: createdAt desc`, no `skip`, no `cursor`. Row 51
 * was unreachable forever, whatever the client did.
 *
 * That mattered more than a missing convenience, because two invisible ceilings
 * compounded: the weekly sweep also deletes READ rows older than 30 days
 * (job-scheduler.js:95-104), so anything past the 50th that a user had read was
 * both unreachable and on its way out, with no page of the inbox ever showing it.
 *
 * The cursor is a TIMESTAMP, not an offset. An offset re-reads a list that shifts
 * under it — a notification arriving between two pages silently pushes one row past
 * the boundary and the reader never sees it. `?before=<ISO>` asks for rows strictly
 * older than a fixed instant, so a new arrival cannot displace anything.
 */
'use strict';

const mockFindMany = jest.fn();

jest.mock('../../services/prisma-database', () => ({
    getClient: () => ({ notification: { findMany: mockFindMany } }),
}));
jest.mock('../../shared/logger', () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn() }));
jest.mock('../../middleware/auth-middleware', () => ({
    authenticateAny: (_req, _res, next) => next(),
    checkPermission: () => (_req, _res, next) => next(),
}));
jest.mock('../../services/notification-service', () => ({}));

const express = require('express');
const request = require('supertest');

function appWithUser(user) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = user; next(); });
    app.use('/api/system/notifications', require('../../routes/api/system/notifications'));
    return app;
}

const USER = { id: 'user-1' };

beforeEach(() => {
    jest.clearAllMocks();
    mockFindMany.mockResolvedValue([]);
});

describe('GET /api/system/notifications — older rows are reachable', () => {
    test('without ?before it still answers with the newest page', async () => {
        await request(appWithUser(USER)).get('/api/system/notifications').expect(200);

        const args = mockFindMany.mock.calls[0][0];
        expect(args.where).toEqual({ userId: 'user-1' });
        expect(args.orderBy).toEqual({ createdAt: 'desc' });
        expect(args.take).toBe(50);
    });

    test('?before=<ISO> asks for rows STRICTLY older than that instant', async () => {
        const before = '2026-08-01T00:00:00.000Z';
        await request(appWithUser(USER))
            .get(`/api/system/notifications?before=${encodeURIComponent(before)}`)
            .expect(200);

        const args = mockFindMany.mock.calls[0][0];
        // `lt`, not `lte` — `lte` re-serves the row the cursor came from, so a client
        // paging by "the oldest row I have" loops on it forever.
        expect(args.where.createdAt).toEqual({ lt: new Date(before) });
        expect(args.where.userId).toBe('user-1');
        expect(args.orderBy).toEqual({ createdAt: 'desc' });
    });

    test('an unparseable ?before is ignored, not turned into an Invalid Date filter', async () => {
        // `createdAt: { lt: Invalid Date }` makes Prisma throw, the outer catch turns
        // that into an empty list, and the inbox looks EMPTY rather than broken — the
        // exact failure the removed `.catch(()=>[])` was deleted for.
        for (const bad of ['tomorrow', '', 'null', '2026-13-45']) {
            mockFindMany.mockClear();
            await request(appWithUser(USER))
                .get(`/api/system/notifications?before=${encodeURIComponent(bad)}`)
                .expect(200);
            const args = mockFindMany.mock.calls[0][0];
            expect(args.where).toEqual({ userId: 'user-1' });
        }
    });

    test('the page size is capped however large ?limit asks', async () => {
        await request(appWithUser(USER))
            .get('/api/system/notifications?limit=5000')
            .expect(200);
        expect(mockFindMany.mock.calls[0][0].take).toBe(50);
    });

    test('a smaller ?limit is honoured', async () => {
        await request(appWithUser(USER))
            .get('/api/system/notifications?limit=10')
            .expect(200);
        expect(mockFindMany.mock.calls[0][0].take).toBe(10);
    });

    test('a junk ?limit falls back to the default rather than NaN', async () => {
        await request(appWithUser(USER))
            .get('/api/system/notifications?limit=abc')
            .expect(200);
        expect(mockFindMany.mock.calls[0][0].take).toBe(50);
    });
});
