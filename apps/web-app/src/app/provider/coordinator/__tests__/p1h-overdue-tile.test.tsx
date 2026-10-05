/**
 * p1h-overdue-tile.test.tsx — Wave-3 P1-H scheduler/coordinator overdue tile.
 *
 * Locks the ADDITIVE danger-tone "งานเลยกำหนด / ผิด SLA" KpiTile bound to
 * `data.kpi.overdue` on the coordinator (scheduler landing) page, plus the
 * coordinator-types kpi shape + EMPTY default carrying `overdue`.
 *
 * Shape — source-read assertion (repo FE convention; the coordinator client
 * mounts ProviderLayout + apiClient + auth-provider which the coordinator
 * tests avoid instantiating).
 */

import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const CLIENT_SOURCE = readFileSync(
    path.resolve(__dirname, '..', 'client-view.tsx'),
    'utf8',
);
const TYPES_SOURCE = readFileSync(
    path.resolve(__dirname, '..', 'coordinator-types.ts'),
    'utf8',
);

describe('P1-H coordinator dashboard — overdue/SLA KPI tile', () => {
    it('renders a danger-tone KpiTile bound to data.kpi.overdue', () => {
        expect(CLIENT_SOURCE).toMatch(
            /<KpiTile[\s\S]*?label="งานเลยกำหนด \/ ผิด SLA"[\s\S]*?value=\{data\.kpi\.overdue \?\? 0\}[\s\S]*?tone="danger"[\s\S]*?\/>/,
        );
    });

    it('carries `overdue` in the coordinator-types kpi shape + EMPTY default', () => {
        expect(TYPES_SOURCE).toMatch(/overdue:\s*number;/);
        expect(TYPES_SOURCE).toMatch(/overdue:\s*0,/);
    });
});
