/**
 * P1-F — scheduler tool launchpad on the coordinator landing.
 *
 * The coordinator page had ZERO inbound links to the 4 built+gated
 * scheduler tools (queue / workload / reassign / reviewer-reassign) —
 * they were reachable only by typing the URL. P1-F adds a guarded
 * tool-tile row. This suite proves:
 *   1. all 4 tool paths are wired on the page (source-scan — the page's
 *      useAuth+apiClient stack does not resolve under jsdom);
 *   2. each link is guarded by providerRoleCanOpen (the "เด่งไปเด่งมา"
 *      anti-bounce guard);
 *   3. behaviorally: scheduler + admin CAN open all four, while a
 *      non-scheduler/non-admin provider role (e.g. auditor, account)
 *      canNOT — so the guard hides the tiles for them.
 */

import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve } from 'path';

import { providerRoleCanOpen } from '@/lib/provider-role-config';
import { CANONICAL_ROLES } from '@/lib/constants/canonical-roles';

const SOURCE = readFileSync(
    resolve(__dirname, '..', 'client-view.tsx'),
    'utf-8',
);

const TOOL_PATHS = [
    '/provider/scheduler/queue',
    '/provider/scheduler/workload',
    '/provider/scheduler/reassign',
    '/provider/scheduler/reviewer-reassign',
];

describe('[P1-F] coordinator scheduler-tools — source wiring', () => {
    it('links all 4 scheduler tools', () => {
        for (const path of TOOL_PATHS) {
            expect(SOURCE).toContain(path);
        }
    });

    it('guards each tool link with providerRoleCanOpen (anti-bounce)', () => {
        expect(SOURCE).toMatch(/providerRoleCanOpen\(user\?\.role, tool\.href\)/);
        // The tile row is only rendered when at least one tool is openable.
        expect(SOURCE).toMatch(/SCHEDULER_TOOLS\.some\(\(tool\) => providerRoleCanOpen/);
        // And each tile is filtered by the same guard.
        expect(SOURCE).toMatch(/SCHEDULER_TOOLS\.filter\(\(tool\) => providerRoleCanOpen/);
    });

    it('renders the tools via the shipped KpiTile vocab (token-only)', () => {
        expect(SOURCE).toMatch(/KpiTile/);
        expect(SOURCE).toMatch(/เครื่องมือจัดตาราง/);
        // No raw hex — token-only.
        expect(SOURCE).not.toMatch(/#[0-9a-fA-F]{3,6}/);
    });
});

describe('[P1-F] scheduler-tools — role gating behaviour', () => {
    it('SCHEDULER can open all 4 tools', () => {
        for (const path of TOOL_PATHS) {
            expect(providerRoleCanOpen(CANONICAL_ROLES.DISPATCHER, path)).toBe(true);
        }
    });

    it('ADMIN can open all 4 tools (admin bypass)', () => {
        for (const path of TOOL_PATHS) {
            expect(providerRoleCanOpen(CANONICAL_ROLES.SYSTEM_ADMIN_DTAM, path)).toBe(true);
        }
    });

    it('a non-scheduler/non-admin role (AUDITOR, ACCOUNT_DTAM) canNOT open the tools → tiles hidden', () => {
        for (const role of [CANONICAL_ROLES.FIELD_INSPECTOR, CANONICAL_ROLES.FINANCE_OFFICER_DTAM]) {
            for (const path of TOOL_PATHS) {
                expect(providerRoleCanOpen(role, path)).toBe(false);
            }
        }
    });

    it('a null role canNOT open the tools (fail-closed)', () => {
        for (const path of TOOL_PATHS) {
            expect(providerRoleCanOpen(null, path)).toBe(false);
        }
    });
});
