/**
 * M1 Task C1 — the one gate every submit door asks.
 *
 * Contract under test (plan D5/D7/D9/D10):
 *   assertSubmitAllowed({ userId, application, auditContext }) -> { entityId }
 *   - application.entityId missing  → 400 VALIDATION_ERROR
 *   - engine denies                 → 403 ENTITY_PERMISSION_DENIED (the
 *     engine's OWN code — no new code is invented here)
 *   - every throw writes an AuditLog FAILURE row (best-effort, D10) carrying
 *     metadata.onBehalfOfEntityId + actorId
 *   - the permission is keyed off the APPLICATION ROW's entityId, never the
 *     x-active-entity header (that is the "submit someone else's draft" hole).
 *
 * Mock shape follows the REAL engine API (review M1): the primitive
 * `assertEntityActionPermission({ entityId, userId, permission })` resolves on
 * allow and rejects with { status/statusCode 403, code
 * 'ENTITY_PERMISSION_DENIED' } on deny — REVOKE-wins lives inside the engine.
 */

'use strict';

jest.mock('../../services/prisma-database', () => ({ prisma: {} }));

jest.mock('../../services/entity-effective-permissions-service', () => ({
    assertEntityActionPermission: jest.fn(),
}));

jest.mock('../../middleware/audit-logger', () => ({
    auditLogger: { log: jest.fn().mockResolvedValue(null) },
    AuditCategory: {
        AUTHENTICATION: 'AUTHENTICATION',
        APPLICATION: 'APPLICATION',
        SECURITY: 'SECURITY',
        SYSTEM: 'SYSTEM',
    },
    AuditSeverity: { INFO: 'INFO', WARNING: 'WARNING', ERROR: 'ERROR', CRITICAL: 'CRITICAL' },
    ResourceType: { APPLICATION: 'APPLICATION', USER: 'USER', SYSTEM: 'SYSTEM' },
}));

const { assertEntityActionPermission } = require('../../services/entity-effective-permissions-service');
const { auditLogger } = require('../../middleware/audit-logger');
const { assertSubmitAllowed, SUBMIT_PERMISSION } = require('../../services/application-submit-guard');

// The engine's canonical denial (entity-effective-permissions-service.js:259-266).
function deniedError() {
    return Object.assign(new Error('Workspace member lacks permission SUBMIT_APPLICATION'), {
        code: 'ENTITY_PERMISSION_DENIED',
        statusCode: 403,
        httpStatus: 403,
        permission: 'SUBMIT_APPLICATION',
    });
}

const ctx = {
    actorRole: 'HEALTH_USER',
    ipAddress: '10.0.0.9',
    userAgent: 'jest',
    organizationId: 'org-1',
    route: 'POST /api/applications/submit',
};

describe('M1 assertSubmitAllowed', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        auditLogger.log.mockResolvedValue(null);
    });

    it('exports the SUBMIT_APPLICATION permission string it gates on', () => {
        expect(SUBMIT_PERMISSION).toBe('SUBMIT_APPLICATION');
    });

    it('400 VALIDATION_ERROR when application has no entityId', async () => {
        await expect(assertSubmitAllowed({ userId: 'u1', application: { id: 'a1', entityId: null }, auditContext: ctx }))
            .rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
        expect(assertEntityActionPermission).not.toHaveBeenCalled();
        expect(auditLogger.log).toHaveBeenCalledWith(expect.objectContaining({
            result: 'FAILURE',
            actorId: 'u1',
            resourceId: 'a1',
            metadata: expect.objectContaining({ onBehalfOfEntityId: null }),
        }));
    });

    it('403 ENTITY_PERMISSION_DENIED + audit FAILURE when neither ACTIVE member nor grant-holder', async () => {
        assertEntityActionPermission.mockRejectedValue(deniedError());
        await expect(assertSubmitAllowed({ userId: 'u1', application: { id: 'a1', entityId: 'e9' }, auditContext: ctx }))
            .rejects.toMatchObject({ status: 403, code: 'ENTITY_PERMISSION_DENIED' });
        expect(assertEntityActionPermission).toHaveBeenCalledWith(
            expect.objectContaining({ userId: 'u1', entityId: 'e9', permission: 'SUBMIT_APPLICATION' }));
        expect(auditLogger.log).toHaveBeenCalledWith(expect.objectContaining({
            result: 'FAILURE',
            actorId: 'u1',
            metadata: expect.objectContaining({ onBehalfOfEntityId: 'e9' }),
        }));
    });

    it('passes when the engine allows (role default / GRANT row — REVOKE-wins lives in the engine)', async () => {
        assertEntityActionPermission.mockResolvedValue({ allowed: true, via: 'ENTITY_PERMISSION' });
        await expect(assertSubmitAllowed({ userId: 'u1', application: { id: 'a1', entityId: 'e1' }, auditContext: ctx }))
            .resolves.toEqual({ entityId: 'e1' });
        expect(auditLogger.log).not.toHaveBeenCalled();
    });

    it('keys off the APPLICATION row entityId — an x-active-entity header for another entity changes nothing', async () => {
        assertEntityActionPermission.mockImplementation(({ entityId }) => (
            entityId === 'e1' ? Promise.resolve({ allowed: true }) : Promise.reject(deniedError())
        ));
        await expect(assertSubmitAllowed({
            userId: 'u1',
            application: { id: 'a1', entityId: 'e2' },
            auditContext: { ...ctx, activeEntityId: 'e1' },
        })).rejects.toMatchObject({ status: 403, code: 'ENTITY_PERMISSION_DENIED' });
        expect(assertEntityActionPermission).toHaveBeenCalledWith(
            expect.objectContaining({ entityId: 'e2', permission: 'SUBMIT_APPLICATION' }));
    });

    it('fails CLOSED when the engine throws something that is not the canonical denial', async () => {
        assertEntityActionPermission.mockRejectedValue(new Error('pool exhausted'));
        await expect(assertSubmitAllowed({ userId: 'u1', application: { id: 'a1', entityId: 'e3' }, auditContext: ctx }))
            .rejects.toMatchObject({ status: 403, code: 'ENTITY_PERMISSION_DENIED' });
        expect(auditLogger.log).toHaveBeenCalledWith(expect.objectContaining({ result: 'FAILURE' }));
    });

    it('a missing userId is a denial, not a pass', async () => {
        await expect(assertSubmitAllowed({ userId: '', application: { id: 'a1', entityId: 'e1' }, auditContext: ctx }))
            .rejects.toMatchObject({ status: 403, code: 'ENTITY_PERMISSION_DENIED' });
        expect(assertEntityActionPermission).not.toHaveBeenCalled();
    });

    it('the audit write is best-effort — a failing auditLogger never converts a 403 into a 500', async () => {
        assertEntityActionPermission.mockRejectedValue(deniedError());
        auditLogger.log.mockRejectedValue(new Error('audit chain down'));
        await expect(assertSubmitAllowed({ userId: 'u1', application: { id: 'a1', entityId: 'e9' }, auditContext: ctx }))
            .rejects.toMatchObject({ status: 403, code: 'ENTITY_PERMISSION_DENIED' });
    });

    it('carries the denial through as an http-shaped error (statusCode/httpStatus) for sendServiceError', async () => {
        await expect(assertSubmitAllowed({ userId: 'u1', application: { id: 'a1', entityId: null }, auditContext: ctx }))
            .rejects.toMatchObject({ status: 400, statusCode: 400, httpStatus: 400 });
    });

    // AuditLog columns actorId / actorRole / resourceType / resourceId are NOT
    // NULL (prisma/schema/audit.prisma:22,25,28,29). auditLogger.log() swallows
    // the insert error (:526-541), so a null here does not raise — it silently
    // DROPS the very row the refusal exists to leave behind. These cases pin
    // the FAILURE row as insertable on the two paths where the caller has the
    // least context.
    const NOT_NULL_COLUMNS = ['actorId', 'actorRole', 'resourceType', 'resourceId'];

    it('the FAILURE row is insertable when the caller passes no auditContext (no null NOT-NULL column)', async () => {
        await expect(assertSubmitAllowed({ userId: 'u1', application: { id: 'a1', entityId: null } }))
            .rejects.toMatchObject({ status: 400 });
        const [event] = auditLogger.log.mock.calls[0];
        for (const column of NOT_NULL_COLUMNS) {
            expect(typeof event[column]).toBe('string');
            expect(event[column].length).toBeGreaterThan(0);
        }
    });

    it('the FAILURE row is insertable for an actor-less attempt (actorId still a string)', async () => {
        await expect(assertSubmitAllowed({ userId: null, application: { entityId: 'e1' }, auditContext: {} }))
            .rejects.toMatchObject({ status: 403 });
        const [event] = auditLogger.log.mock.calls[0];
        for (const column of NOT_NULL_COLUMNS) {
            expect(typeof event[column]).toBe('string');
            expect(event[column].length).toBeGreaterThan(0);
        }
        expect(event.metadata).toMatchObject({ onBehalfOfEntityId: 'e1' });
    });

    it('works without an auditContext at all (guard must not depend on the caller remembering it)', async () => {
        assertEntityActionPermission.mockResolvedValue({ allowed: true });
        await expect(assertSubmitAllowed({ userId: 'u1', application: { id: 'a1', entityId: 'e1' } }))
            .resolves.toEqual({ entityId: 'e1' });
    });
});
