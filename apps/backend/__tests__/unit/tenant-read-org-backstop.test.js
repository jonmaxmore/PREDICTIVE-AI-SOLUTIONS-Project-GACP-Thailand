/**
 * ENT-01 — data-layer read backstop (organizationId injection on reads).
 *
 * The org dimension is FLAG-GATED (TENANT_READ_ORG_SCOPE). These tests pin:
 *   - flag OFF (default) → strict no-op (today's behaviour preserved)
 *   - flag ON  → organizationId injected on tenant-scoped reads when a tenant
 *     context is bound; fail-open (no injection) when context is null
 *     (withoutTenantScope / platform-admin / cron / public reads)
 *   - the entity dimension (entityId) is independent + always on
 */

'use strict';

const mockTenant = { ctx: null };
const mockEntity = { ctx: null };

jest.mock('../../services/tenant-context', () => ({
    getTenantContext: () => mockTenant.ctx,
}));
jest.mock('../../services/entity-context', () => ({
    getEntityContext: () => mockEntity.ctx,
}));

const { applyReadScopes, orgReadScopeEnabled } = require('../../services/tenant-prisma-extension');

describe('ENT-01 read backstop — applyReadScopes', () => {
    const ORIGINAL_FLAG = process.env.TENANT_READ_ORG_SCOPE;
    beforeEach(() => {
        mockTenant.ctx = null;
        mockEntity.ctx = null;
        delete process.env.TENANT_READ_ORG_SCOPE;
    });
    afterAll(() => {
        if (ORIGINAL_FLAG === undefined) { delete process.env.TENANT_READ_ORG_SCOPE; }
        else { process.env.TENANT_READ_ORG_SCOPE = ORIGINAL_FLAG; }
    });

    describe('DEFAULT (flag unset) — org dimension ON (Gap-1 GREEN)', () => {
        test('tenant-scoped read with tenant ctx → organizationId injected by default', () => {
            mockTenant.ctx = { organizationId: 'org-A' };
            const out = applyReadScopes('Invoice', { where: { status: 'PAID' } });
            expect(out.where).toEqual({ status: 'PAID', organizationId: 'org-A' });
            expect(orgReadScopeEnabled()).toBe(true);
        });
    });

    describe('kill-switch (TENANT_READ_ORG_SCOPE=false) — org dimension is a no-op', () => {
        beforeEach(() => { process.env.TENANT_READ_ORG_SCOPE = 'false'; });
        test('tenant-scoped read with tenant ctx → NO organizationId injected', () => {
            mockTenant.ctx = { organizationId: 'org-A' };
            const out = applyReadScopes('Invoice', { where: { status: 'PAID' } });
            expect(out.where).toEqual({ status: 'PAID' });
            expect(orgReadScopeEnabled()).toBe(false);
        });
    });

    describe('flag ON — org dimension active', () => {
        beforeEach(() => { process.env.TENANT_READ_ORG_SCOPE = 'true'; });

        test('tenant-scoped read + bound tenant ctx → organizationId injected', () => {
            mockTenant.ctx = { organizationId: 'org-A' };
            const out = applyReadScopes('Invoice', { where: { status: 'PAID' } });
            expect(out.where).toEqual({ status: 'PAID', organizationId: 'org-A' });
        });

        test('tenant-scoped read + NO tenant ctx (withoutTenantScope/public) → fail-open, no injection', () => {
            mockTenant.ctx = null;
            const out = applyReadScopes('Invoice', { where: { status: 'PAID' } });
            expect(out.where).toEqual({ status: 'PAID' });
        });

        test('NON-tenant-scoped model → no org injection even with ctx', () => {
            mockTenant.ctx = { organizationId: 'org-A' };
            const out = applyReadScopes('SystemConfig', { where: { key: 'x' } });
            expect(out.where).toEqual({ key: 'x' });
        });

        test('handles missing where / args', () => {
            mockTenant.ctx = { organizationId: 'org-A' };
            expect(applyReadScopes('Invoice', {}).where).toEqual({ organizationId: 'org-A' });
            expect(applyReadScopes('Invoice', undefined).where).toEqual({ organizationId: 'org-A' });
        });
    });

    describe('entity dimension — independent, always on (flag-agnostic)', () => {
        test('entity-scoped model + entity ctx → entityId injected regardless of flag', () => {
            mockEntity.ctx = { entityId: 'ent-1' };
            const out = applyReadScopes('Farm', { where: {} });
            expect(out.where).toEqual({ entityId: 'ent-1' });
        });

        test('flag ON + Application (entity AND tenant scoped) + both ctx → both filters', () => {
            process.env.TENANT_READ_ORG_SCOPE = 'true';
            mockEntity.ctx = { entityId: 'ent-1' };
            mockTenant.ctx = { organizationId: 'org-A' };
            const out = applyReadScopes('Application', { where: { status: 'DRAFT' } });
            expect(out.where).toEqual({ status: 'DRAFT', entityId: 'ent-1', organizationId: 'org-A' });
        });
    });
});
