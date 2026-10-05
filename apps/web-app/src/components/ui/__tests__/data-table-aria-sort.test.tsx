/**
 * data-table-aria-sort.test.tsx — X4-FIX-B (primitive a11y win from
 * X4-C).
 *
 * Pins the `aria-sort` attribute on the shared shadcn DataTable's
 * column headers (per X4-C §2.2 best-practice finding). Used by
 * `/provider/receipts/page.tsx` in this scope; many more callers
 * exist across HEALTH + ADMIN/PROVIDER. The fix lives in the shared
 * primitive so every caller benefits.
 *
 * WCAG SC: 4.1.2 — Status messages (sort state announced to SRs).
 * WCAG Technique H80.
 */

import * as React from 'react';
import { describe, expect, it, afterEach } from '@jest/globals';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

declare global {

    var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Mock next/navigation hooks used by DataTable's optional URL-state
// sync — none of the tests exercise URL state but the hooks must
// return safe defaults so the component can render under jsdom.
jest.mock('next/navigation', () => ({
    usePathname: () => '/test',
    useRouter: () => ({ replace: () => {}, push: () => {} }),
    useSearchParams: () => new URLSearchParams(),
}));

import { DataTable, type ColumnDef } from '../data-table';

type Row = { id: string; name: string; amount: number };

const SAMPLE: Row[] = [
    { id: 'a', name: 'Alpha', amount: 100 },
    { id: 'b', name: 'Bravo', amount: 250 },
];

const COLUMNS: ColumnDef<Row>[] = [
    {
        key: 'name',
        header: 'ชื่อ',
        sortable: true,
        render: (row) => row.name,
    },
    {
        key: 'amount',
        header: 'จำนวน',
        sortable: true,
        numeric: true,
        render: (row) => row.amount,
    },
    {
        key: 'id',
        header: 'รหัส',
        sortable: false,
        render: (row) => row.id,
    },
];

describe('[X4-FIX-B] DataTable — aria-sort on sortable column headers', () => {
    let container: HTMLDivElement | null = null;
    let root: Root | null = null;

    afterEach(() => {
        if (root) {
            act(() => {
                root?.unmount();
            });
            root = null;
        }
        if (container) {
            container.remove();
            container = null;
        }
    });

    async function mount(node: React.ReactElement) {
        container = document.createElement('div');
        document.body.appendChild(container);
        await act(async () => {
            root = createRoot(container!);
            root.render(node);
        });
    }

    it('renders aria-sort="none" on sortable columns when no sort is active', async () => {
        await mount(
            <DataTable<Row>
                data={SAMPLE}
                columns={COLUMNS}
                rowKey="id"
            />,
        );

        const ths = container!.querySelectorAll('th');
        // 3 columns total. The first two are sortable.
        expect(ths.length).toBe(3);

        // Sortable columns must announce aria-sort="none" when no
        // active sort — without it, SRs can't tell the column IS
        // sortable.
        expect(ths[0]!.getAttribute('aria-sort')).toBe('none');
        expect(ths[1]!.getAttribute('aria-sort')).toBe('none');

        // Non-sortable column must NOT carry aria-sort — passing a
        // bogus value would mislead SRs.
        expect(ths[2]!.getAttribute('aria-sort')).toBeNull();
    });

    it('reflects defaultSort via aria-sort="ascending" / "descending"', async () => {
        await mount(
            <DataTable<Row>
                data={SAMPLE}
                columns={COLUMNS}
                rowKey="id"
                defaultSort={{ key: 'amount', dir: 'desc' }}
            />,
        );

        const ths = container!.querySelectorAll('th');
        // First column not sorted — none.
        expect(ths[0]!.getAttribute('aria-sort')).toBe('none');
        // Second column sorted descending.
        expect(ths[1]!.getAttribute('aria-sort')).toBe('descending');
        // Third column non-sortable — no attribute.
        expect(ths[2]!.getAttribute('aria-sort')).toBeNull();
    });

    it('TableHead default scope="col" is inherited (X4-FIX-B table primitive)', async () => {
        // Sanity check that the primitive-level scope="col" default
        // also flows through DataTable callers.
        await mount(
            <DataTable<Row>
                data={SAMPLE}
                columns={COLUMNS}
                rowKey="id"
            />,
        );

        const ths = container!.querySelectorAll('th');
        for (const th of Array.from(ths)) {
            expect(th.getAttribute('scope')).toBe('col');
        }
    });
});
