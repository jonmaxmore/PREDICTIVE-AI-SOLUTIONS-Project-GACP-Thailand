/**
 * table-scope.test.tsx — X4-FIX-B (primitive a11y win from X4-C).
 *
 * Pins the `scope="col"` default on the legacy Mantine-port Table.Th
 * primitive used by the main `/provider/accounting` dashboard table
 * (per X4-C §1.2) AND every HEALTH consumer of Table.Th. Adding the
 * default on the primitive fixes every call site for free without
 * requiring per-call edits.
 *
 * WCAG SC: 1.3.1 (Info & Relationships) — programmatically determine
 * column headers in a data table.
 */

import * as React from 'react';
import { describe, expect, it, afterEach } from '@jest/globals';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

declare global {

    var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { Table, TableHead } from '../table';

describe('[X4-FIX-B] table primitive — scope="col" default on TableHead', () => {
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

    it('renders TableHead as <th scope="col"> by default (WCAG 1.3.1)', async () => {
        await mount(
            <Table>
                <thead>
                    <tr>
                        <TableHead>เลขที่</TableHead>
                        <TableHead>ชื่อผู้สมัคร</TableHead>
                    </tr>
                </thead>
            </Table>,
        );

        const ths = container!.querySelectorAll('th');
        expect(ths.length).toBe(2);
        for (const th of Array.from(ths)) {
            expect(th.getAttribute('scope')).toBe('col');
        }
    });

    it('also wires scope="col" when accessed via the Mantine-port Table.Th alias', async () => {
        // The main accounting dashboard table uses Table.Thead/Table.Tr/
        // Table.Th aliases (per X4-C §2.3 — Mantine-port primitive
        // shape). Verify the alias path picks up the same default.
        await mount(
            <Table>
                <Table.Thead>
                    <Table.Tr>
                        <Table.Th>สถานะ</Table.Th>
                    </Table.Tr>
                </Table.Thead>
            </Table>,
        );

        const th = container!.querySelector('th');
        expect(th).not.toBeNull();
        expect(th!.getAttribute('scope')).toBe('col');
    });

    it('respects an explicit scope override (e.g. scope="row")', async () => {
        // Callers should still be able to override the default — some
        // tables have row headers (e.g. summary tables where the first
        // column is a row label).
        await mount(
            <Table>
                <tbody>
                    <tr>
                        <TableHead scope="row">รวม</TableHead>
                        <td>1,000.00 ฿</td>
                    </tr>
                </tbody>
            </Table>,
        );

        const th = container!.querySelector('th');
        expect(th).not.toBeNull();
        expect(th!.getAttribute('scope')).toBe('row');
    });
});
