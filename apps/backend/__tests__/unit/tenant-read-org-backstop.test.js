/**
 * ENT-01 — data-layer read backstop (organizationId injection on reads).
 *
 * The org dimension is FLAG-GATED (TENANT_READ_ORG_SCOPE). These tests pin:
 *   - flag OFF (default) → strict no-op (today's behaviour preserved)
 *   - flag ON  → organizationId injected on tenant-scoped reads when a tenant
 *     context is bound; fail-open (no injection) when context is null
 *     (withoutTenantScope / platform-admin / cron / public reads)
 *   - there is no entity dimension any more (R2 Task 12): nothing rewrites entityId
 */

'use strict';

const mockTenant = { ctx: null };

jest.mock('../../services/tenant-context', () => ({
    getTenantContext: () => mockTenant.ctx,
}));

const { applyReadScopes, orgReadScopeEnabled } = require('../../services/tenant-prisma-extension');

describe('ENT-01 read backstop — applyReadScopes', () => {
    const ORIGINAL_FLAG = process.env.TENANT_READ_ORG_SCOPE;
    beforeEach(() => {
        mockTenant.ctx = null;
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

    describe('no entity dimension (R2 Task 12: the active-workspace filter is gone)', () => {
        test('Farm and Application reads keep their own entityId; nothing is injected', () => {
            const out = applyReadScopes('Farm', { where: { entityId: { in: ['e-1', 'e-2'] } } });
            expect(out.where).toEqual({ entityId: { in: ['e-1', 'e-2'] } });
        });

        test('flag ON + Application + tenant ctx → only the organization filter is added', () => {
            process.env.TENANT_READ_ORG_SCOPE = 'true';
            mockTenant.ctx = { organizationId: 'org-A' };
            const out = applyReadScopes('Application', { where: { status: 'DRAFT' } });
            expect(out.where).toEqual({ status: 'DRAFT', organizationId: 'org-A' });
        });
    });
});
