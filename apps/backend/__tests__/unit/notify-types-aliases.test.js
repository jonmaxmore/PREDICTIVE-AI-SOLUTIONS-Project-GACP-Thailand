/**
 * NotifyType alias tests.
 *
 * Verifies that:
 *   1. Both the legacy REVISION_REQUIRED and canonical REVISION_REQUESTED
 *      keys exist on the NotifyType enum and resolve to the documented
 *      string values (REVISION_REQUIRED keeps its own string so persisted
 *      DB rows continue to match; REVISION_REQUESTED is the canonical
 *      identifier going forward).
 *   2. resolveNotifyType() folds the legacy string onto the canonical one.
 *   3. The notification template factory (NotifyTemplates) returns the
 *      same Thai farmer-facing copy regardless of which key the caller
 *      uses, so legacy dispatch sites never silently fall through to a
 *      generic fallback title.
 *
 * Locks the deprecation contract documented in
 *   apps/backend/services/notification-service.js
 * — removal target 2026-08-01.
 */

'use strict';

jest.mock('../../shared/logger', () => ({
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
    stream: { write: jest.fn() },
    createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

jest.mock('../../services/prisma-database', () => ({
    prisma: {
        user: { findUnique: jest.fn(), findMany: jest.fn() },
        notification: { create: jest.fn(), createMany: jest.fn() },
        application: { findUnique: jest.fn() },
    },
}));

jest.mock('../../services/tenant-context', () => ({
    getTenantContext: jest.fn(() => ({ organizationId: 'org_test' })),
}));

const {
    NotifyType,
    NotifyTemplates,
    NOTIFY_TYPE_ALIASES,
    resolveNotifyType,
} = require('../../services/notification-service');

describe('NotifyType — REVISION_REQUIRED / REVISION_REQUESTED aliases', () => {
    it('exposes both legacy and canonical keys on NotifyType', () => {
        expect(NotifyType).toHaveProperty('REVISION_REQUIRED');
        expect(NotifyType).toHaveProperty('REVISION_REQUESTED');
    });

    it('canonical key resolves to the documented string value', () => {
        expect(NotifyType.REVISION_REQUESTED).toBe('REVISION_REQUESTED');
    });

    it('legacy key keeps its own string value (DB backward-compat)', () => {
        // Existing notification rows persisted with type='REVISION_REQUIRED'
        // must still match this enum value exactly, otherwise their templates
        // stop resolving in the client.
        expect(NotifyType.REVISION_REQUIRED).toBe('REVISION_REQUIRED');
    });
});

describe('NOTIFY_TYPE_ALIASES — legacy → canonical mapping', () => {
    it('declares REVISION_REQUIRED → REVISION_REQUESTED', () => {
        expect(NOTIFY_TYPE_ALIASES).toEqual(
            expect.objectContaining({ REVISION_REQUIRED: 'REVISION_REQUESTED' }),
        );
    });

    it('is frozen so callers cannot mutate the alias contract at runtime', () => {
        expect(Object.isFrozen(NOTIFY_TYPE_ALIASES)).toBe(true);
    });
});

describe('resolveNotifyType()', () => {
    it('returns the canonical key for legacy input', () => {
        expect(resolveNotifyType('REVISION_REQUIRED')).toBe('REVISION_REQUESTED');
    });

    it('passes canonical input through unchanged', () => {
        expect(resolveNotifyType('REVISION_REQUESTED')).toBe('REVISION_REQUESTED');
    });

    it('passes unknown input through unchanged', () => {
        expect(resolveNotifyType('SOME_OTHER_TYPE')).toBe('SOME_OTHER_TYPE');
    });

    it('handles nullish input without throwing', () => {
        expect(resolveNotifyType(null)).toBe(null);
        expect(resolveNotifyType(undefined)).toBe(undefined);
    });
});

describe('NotifyTemplates — legacy + canonical render identically', () => {
    const sampleData = {
        applicationNumber: 'GACP-2026-0001',
        reason: 'เอกสารใบรับรองหมดอายุ',
    };

    it('canonical REVISION_REQUESTED template renders Thai farmer-facing copy', () => {
        const factory = NotifyTemplates[NotifyType.REVISION_REQUESTED];
        expect(typeof factory).toBe('function');
        const { title, message } = factory(sampleData);
        // Thai title prefix — never English.
        expect(title).toContain('ต้องแก้ไขเอกสาร');
        expect(message).toContain('GACP-2026-0001');
        expect(message).toContain('เอกสารใบรับรองหมดอายุ');
    });

    it('legacy REVISION_REQUIRED key resolves to a Thai template (not a fallback)', () => {
        const factory = NotifyTemplates[NotifyType.REVISION_REQUIRED];
        expect(typeof factory).toBe('function');
        const { title, message } = factory(sampleData);
        expect(title).toContain('ต้องแก้ไขเอกสาร');
        expect(message).toContain('GACP-2026-0001');
    });

    it('canonical and legacy templates produce equivalent output for the same data', () => {
        const canonical = NotifyTemplates[NotifyType.REVISION_REQUESTED](sampleData);
        const legacy = NotifyTemplates[NotifyType.REVISION_REQUIRED](sampleData);
        expect(canonical).toEqual(legacy);
    });
});
