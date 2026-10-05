/**
 * SEC/PDPA — a workspace peer must not receive another member's raw national ID.
 *
 * User.healthId is the 13-digit Thai citizen ID. It is in
 * PHASE_3_NATIONAL_ID_COLUMNS (services/prisma-pdpa-extension.js), so it is
 * encrypted at rest and the PDPA extension DECRYPTS it on read — every
 * `select: { healthId: true }` hands the caller plaintext.
 *
 * Two entity-service shapes returned it to peers:
 *
 *   • listMembersForEntity  → GET /api/entities/:id/members. Guarded by
 *     "caller must be a member", with no role floor — a VIEWER on a shared
 *     workspace received the plaintext citizen ID of the OWNER and of every
 *     other member.
 *   • listMembershipEvents  → the workspace audit log, which returned the raw
 *     ID for both the actor and the target of each membership event.
 *
 * The web UI already masked this at render (see the members page's
 * maskHealthIdCard call and its guard test), but that is a client-side control
 * only: the plaintext still crossed the wire, so it sat in the browser cache,
 * any proxy log, and the response of a plain `curl`. Masking belongs on the
 * server, where the value is decrypted.
 *
 * Direction: the service layer is the boundary. It emits the masked form, so no
 * route, serializer or future caller has a raw value available to leak. Callers
 * that legitimately need identity use `userId`, which is already returned.
 *
 * Composition with the frontend: maskThaiId yields `1-XXXX-XXXX-X-0123`, whose
 * digit count is not 13, and the web helper maskHealthIdCard returns its input
 * unchanged when the cleaned length is not 13. So the existing UI call passes
 * the masked value straight through — no double-masking, no frontend change.
 * It is also strictly less revealing than what the UI produced on its own
 * (5 of 13 digits rather than 10).
 */

'use strict';

jest.mock('../../shared/logger', () => {
    const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    return { ...log, createLogger: jest.fn(() => log) };
});

const mockMembershipFindMany = jest.fn();
const mockEventFindMany = jest.fn();
jest.mock('../../services/prisma-database', () => ({
    prisma: {
        entityMembership: { findMany: (...a) => mockMembershipFindMany(...a) },
        entityMembershipEvent: { findMany: (...a) => mockEventFindMany(...a) },
    },
}));

const entityService = require('../../services/entity-service');

const OWNER_ID = '1100000000008';
const VIEWER_ID = '1100000000009';

describe('SEC/PDPA — entity member listings mask the national ID', () => {
    beforeEach(() => jest.clearAllMocks());

    it('does not return a peer plaintext healthId from the members list', async () => {
        mockMembershipFindMany.mockResolvedValue([
            {
                id: 'm-1', userId: 'u-owner', role: 'OWNER', status: 'ACTIVE',
                permissions: [], invitedBy: null, invitedAt: null, acceptedAt: null,
                user: {
                    id: 'u-owner', healthId: OWNER_ID,
                    firstName: 'สมชาย', lastName: 'ใจดี', email: 'owner@example.com',
                },
            },
            {
                id: 'm-2', userId: 'u-viewer', role: 'VIEWER', status: 'ACTIVE',
                permissions: [], invitedBy: 'u-owner', invitedAt: null, acceptedAt: null,
                user: {
                    id: 'u-viewer', healthId: VIEWER_ID,
                    firstName: 'สมหญิง', lastName: 'ดีใจ', email: 'viewer@example.com',
                },
            },
        ]);

        const rows = await entityService.listMembersForEntity({ entityId: 'ent-1' });

        expect(JSON.stringify(rows)).not.toContain(OWNER_ID);
        expect(JSON.stringify(rows)).not.toContain(VIEWER_ID);
        // Masked, not dropped — the UI still shows a recognisable tail.
        expect(rows[0].healthId).toBe('1-XXXX-XXXX-X-0008');
        expect(rows[1].healthId).toBe('1-XXXX-XXXX-X-0009');
        // Everything else the caller legitimately needs is intact.
        expect(rows[0].userId).toBe('u-owner');
        expect(rows[0].displayName).toBe('สมชาย ใจดี');
        expect(rows[0].role).toBe('OWNER');
    });

    it('keeps a null healthId null rather than masking it into a string', async () => {
        mockMembershipFindMany.mockResolvedValue([{
            id: 'm-1', userId: 'u-1', role: 'VIEWER', status: 'ACTIVE',
            permissions: [], invitedBy: null, invitedAt: null, acceptedAt: null,
            user: { id: 'u-1', healthId: null, firstName: 'ก', lastName: 'ข', email: 'a@b.co' },
        }]);

        const rows = await entityService.listMembersForEntity({ entityId: 'ent-1' });

        expect(rows[0].healthId).toBeNull();
    });

    it('does not return plaintext healthId in the membership audit log', async () => {
        mockEventFindMany.mockResolvedValue([{
            id: 'ev-1', createdAt: new Date('2026-07-01'), eventType: 'INVITED',
            metadata: null, ipAddress: '10.0.0.1',
            actorUser: { id: 'u-owner', healthId: OWNER_ID, firstName: 'สมชาย', lastName: 'ใจดี' },
            targetUser: { id: 'u-viewer', healthId: VIEWER_ID, firstName: 'สมหญิง', lastName: 'ดีใจ' },
        }]);

        const events = await entityService.listMembershipEvents({ entityId: 'ent-1' });

        expect(JSON.stringify(events)).not.toContain(OWNER_ID);
        expect(JSON.stringify(events)).not.toContain(VIEWER_ID);
        expect(events[0].actor.healthId).toBe('1-XXXX-XXXX-X-0008');
        expect(events[0].target.healthId).toBe('1-XXXX-XXXX-X-0009');
        expect(events[0].actor.id).toBe('u-owner');
        expect(events[0].eventType).toBe('INVITED');
    });

    it('handles an audit event with no actor or target', async () => {
        mockEventFindMany.mockResolvedValue([{
            id: 'ev-1', createdAt: new Date('2026-07-01'), eventType: 'SYSTEM',
            metadata: null, ipAddress: null, actorUser: null, targetUser: null,
        }]);

        const events = await entityService.listMembershipEvents({ entityId: 'ent-1' });

        expect(events[0].actor).toBeNull();
        expect(events[0].target).toBeNull();
    });
});
