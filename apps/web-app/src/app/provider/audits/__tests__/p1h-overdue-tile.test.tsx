/**
 * p1h-overdue-tile.test.tsx — Wave-3 P1-H auditor overdue visibility.
 *
 * Locks the ADDITIVE overdue surface on the auditor dashboard:
 *   - a danger-tone "เลยกำหนดตรวจ" KpiTile bound to `kpi.overdue`
 *   - a red date tint / "เลยกำหนด" chip on past-due AUDIT_CONFIRMED rows
 *   - the auditor-types kpi shape carries `overdue`
 *
 * Shape — source-read assertion (matches the sibling applications
 * x2-fix-a-filter-chips convention): the client-view mounts ProviderLayout +
 * apiClient + Radix + Spinner, none of which the audits tests instantiate, so
 * reading the source is more deterministic than a full SSR pass.
 */

import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const CLIENT_SOURCE = readFileSync(
    path.resolve(__dirname, '..', 'client-view.tsx'),
    'utf8',
);
const TYPES_SOURCE = readFileSync(
    path.resolve(__dirname, '..', 'auditor-types.ts'),
    'utf8',
);

describe('P1-H auditor dashboard — overdue KPI tile + row tint', () => {
    it('renders a danger-tone KpiTile bound to kpi.overdue', () => {
        // The tile label + the value binding + the danger tone must all be present
        // in a single KpiTile block.
        expect(CLIENT_SOURCE).toMatch(
            /<KpiTile[\s\S]*?label="เลยกำหนดตรวจ"[\s\S]*?value=\{dashboard\.kpi\?\.overdue \?\? 0\}[\s\S]*?tone="danger"[\s\S]*?\/>/,
        );
    });

    it('tints the scheduled date red for a past-due AUDIT_CONFIRMED row', () => {
        // The row-overdue predicate keys off BOTH the AUDIT_CONFIRMED state and a
        // scheduledDate in the past — mirroring the backend metric.
        expect(CLIENT_SOURCE).toMatch(/item\.workflowState === 'AUDIT_CONFIRMED'/);
        expect(CLIENT_SOURCE).toMatch(/new Date\(item\.scheduledDate\)\.getTime\(\) < Date\.now\(\)/);
        // Red tint token + a testable hook.
        expect(CLIENT_SOURCE).toMatch(/text-destructive/);
        expect(CLIENT_SOURCE).toMatch(/data-testid=\{isRowOverdue \? "auditor-row-overdue" : undefined\}/);
    });

    it('carries `overdue` in the auditor-types kpi shape + EMPTY_DASHBOARD default', () => {
        expect(TYPES_SOURCE).toMatch(/overdue:\s*number;/);
        expect(TYPES_SOURCE).toMatch(/overdue:\s*0,/);
    });
});
