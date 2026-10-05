/**
 * Farm-worker Wave B, Chunk 2 — farm-operation capability taxonomy +
 * role defaults (owner decisions, plan doc
 * docs/handoffs/farm-worker-permissions-plan-2026-07-02.md).
 *
 * Owner decisions pinned here:
 *   - activity permissions are PER-TYPE (7 ACTIVITY_* codes)
 *   - FARM_EDIT reuses the existing EDIT_FARM code string (no synonym)
 *   - OWNER/ADMIN = all farm-operation codes
 *   - MANAGER    = all EXCEPT FARM_CREATE + EDIT_FARM (binding plan line 22 —
 *                  overrides the legacy MANAGER bundle that carried the
 *                  defined-but-unenforced EDIT_FARM)
 *   - VIEWER    = none
 *   - BINDING: no FARM_DELETE / draft-delete permission exists in the
 *     taxonomy (destructive ops stay owner-only in code)
 */

'use strict';

jest.mock('../../services/prisma-database', () => ({
    prisma: {},
}));

jest.mock('../../shared/logger', () => {
    const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return { ...l, createLogger: jest.fn(() => l) };
});

const {
    CAPABILITIES,
    FARM_OPERATION_CAPABILITIES,
    DEFAULT_PERMISSIONS_BY_ROLE,
} = require('../../services/entity-service');
const { isGrantableFarmOperation } = require('../../services/entity-effective-permissions-service');

const NEW_CODES = [
    'FARM_CREATE',
    'CYCLE_CREATE',
    'UNIT_MANAGE',
    'ACTIVITY_IRRIGATION',
    'ACTIVITY_FERTILIZER',
    'ACTIVITY_PEST_CONTROL',
    'ACTIVITY_WEED_CONTROL',
    'ACTIVITY_INSPECTION',
    'ACTIVITY_INCIDENT',
    'ACTIVITY_OTHER',
    'HARVEST_RECORD',
    'QR_GENERATE',
    'RECORDS_MANAGE',
    'REPORT_SUBMIT',
];

describe('Wave B chunk 2 — farm-operation CAPABILITIES', () => {
    it('defines every farm-operation code as its own stable string', () => {
        for (const code of NEW_CODES) {
            expect(CAPABILITIES[code]).toBe(code);
        }
    });

    it('reuses EDIT_FARM for farm edit — no FARM_EDIT duplicate synonym', () => {
        expect(CAPABILITIES.EDIT_FARM).toBe('EDIT_FARM');
        expect(CAPABILITIES.FARM_EDIT).toBeUndefined();
        expect(Object.values(CAPABILITIES)).not.toContain('FARM_EDIT');
    });

    it('BINDING: no FARM_DELETE or draft-delete code in the taxonomy', () => {
        const values = Object.values(CAPABILITIES);
        expect(values).not.toContain('FARM_DELETE');
        expect(values.some((v) => /DELETE_DRAFT|DRAFT_DELETE/.test(v))).toBe(false);
        // DELETE_ENTITY (workspace-management, pre-existing) is NOT a farm op.
        expect(FARM_OPERATION_CAPABILITIES).not.toContain('DELETE_ENTITY');
    });

    // M1 D6 (2026-08-15): SUBMIT_APPLICATION joined the GRANTABLE set so an
    // OWNER can hand submit rights to one named member. It is grantable, NOT
    // a MANAGER role default — that separation is pinned below.
    it('FARM_OPERATION_CAPABILITIES = the 14 new codes + EDIT_FARM + SUBMIT_APPLICATION, frozen', () => {
        expect(Object.isFrozen(FARM_OPERATION_CAPABILITIES)).toBe(true);
        expect([...FARM_OPERATION_CAPABILITIES].sort()).toEqual(
            [...NEW_CODES, 'EDIT_FARM', 'SUBMIT_APPLICATION'].sort(),
        );
    });

    it('keeps the 10 pre-existing workspace-management codes intact', () => {
        for (const code of [
            'SUBMIT_APPLICATION', 'APPROVE_APPLICATION', 'PRINT_QR', 'EDIT_FARM',
            'INVITE_MEMBER', 'REVOKE_MEMBER', 'VIEW_FINANCIAL',
            'EDIT_ENTITY_PROFILE', 'TRANSFER_OWNERSHIP', 'DELETE_ENTITY',
        ]) {
            expect(CAPABILITIES[code]).toBe(code);
        }
    });
});

describe('Wave B chunk 2 — role defaults for farm-operation codes', () => {
    it('OWNER holds every farm-operation code', () => {
        for (const code of FARM_OPERATION_CAPABILITIES) {
            expect(DEFAULT_PERMISSIONS_BY_ROLE.OWNER).toContain(code);
        }
    });

    it('ADMIN holds every farm-operation code', () => {
        for (const code of FARM_OPERATION_CAPABILITIES) {
            expect(DEFAULT_PERMISSIONS_BY_ROLE.ADMIN).toContain(code);
        }
    });

    it('MANAGER holds every farm-operation code EXCEPT FARM_CREATE + EDIT_FARM + SUBMIT_APPLICATION', () => {
        const m = DEFAULT_PERMISSIONS_BY_ROLE.MANAGER;
        for (const code of FARM_OPERATION_CAPABILITIES) {
            if (code === 'FARM_CREATE' || code === 'EDIT_FARM' || code === 'SUBMIT_APPLICATION') {
                expect(m).not.toContain(code);
            } else {
                expect(m).toContain(code);
            }
        }
        // pre-existing MANAGER capability retained
        expect(m).toContain('PRINT_QR');
    });

    it('VIEWER default stays empty (read-only)', () => {
        expect(DEFAULT_PERMISSIONS_BY_ROLE.VIEWER).toEqual([]);
    });

    it('workspace-management bundles unchanged: ADMIN still lacks TRANSFER_OWNERSHIP/DELETE_ENTITY, MANAGER still lacks INVITE_MEMBER', () => {
        expect(DEFAULT_PERMISSIONS_BY_ROLE.ADMIN).not.toContain('TRANSFER_OWNERSHIP');
        expect(DEFAULT_PERMISSIONS_BY_ROLE.ADMIN).not.toContain('DELETE_ENTITY');
        expect(DEFAULT_PERMISSIONS_BY_ROLE.MANAGER).not.toContain('INVITE_MEMBER');
    });
});

/**
 * M1 Task C1 Step 3b — SUBMIT_APPLICATION becomes GRANTABLE without becoming
 * a MANAGER default.
 *
 * AC3 ("the OWNER may grant one member the right to submit") is unreachable
 * while the permission-admin API refuses the code: it accepts only
 * `isGrantableFarmOperation` values (member-permissions.js:194,251), i.e. the
 * FARM_OPERATION_CAPABILITIES set. But that same set is spread into the
 * MANAGER default bundle (entity-service.js:127-131,165-168) — so adding the
 * code naively would hand EVERY manager submit rights, against the standing
 * owner decision "MANAGER can fill the wizard / save drafts but not submit"
 * (applications.js:516-518) and against
 * applications-submit-capability-gate.test.js:158-163.
 *
 * These two pins hold the two halves apart. Pin (a) is the escalation guard:
 * it fails the moment someone removes the MANAGER exclusion.
 */
describe('M1 D6 — SUBMIT_APPLICATION is grantable, never a MANAGER default', () => {
    it('(a) MANAGER default bundle does NOT contain SUBMIT_APPLICATION (no silent escalation)', () => {
        expect(DEFAULT_PERMISSIONS_BY_ROLE.MANAGER).not.toContain('SUBMIT_APPLICATION');
        expect(DEFAULT_PERMISSIONS_BY_ROLE.VIEWER).not.toContain('SUBMIT_APPLICATION');
    });

    it('(b) the grantable set contains SUBMIT_APPLICATION, so an OWNER can GRANT it per member', () => {
        expect(FARM_OPERATION_CAPABILITIES).toContain('SUBMIT_APPLICATION');
        expect(isGrantableFarmOperation('SUBMIT_APPLICATION')).toBe(true);
    });

    it('OWNER and ADMIN still hold SUBMIT_APPLICATION exactly once (no duplicate from the spread)', () => {
        for (const role of ['OWNER', 'ADMIN']) {
            const bundle = DEFAULT_PERMISSIONS_BY_ROLE[role];
            expect(bundle).toContain('SUBMIT_APPLICATION');
            expect(bundle.filter((c) => c === 'SUBMIT_APPLICATION')).toHaveLength(1);
        }
    });
});
