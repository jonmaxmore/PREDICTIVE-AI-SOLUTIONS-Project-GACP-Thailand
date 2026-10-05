/**
 * @jest-environment jsdom
 *
 * Smoke tests for the FlowAccount-style <DataTable /> shared
 * finance component. Verifies column rendering, money-column
 * right alignment, empty state, and row-click delegation.
 */
import React from 'react';
import { render, screen, fireEvent } from '@/__tests__/test-utils';
import '@testing-library/jest-dom';

import { DataTable, type DataColumn } from '@/components/finance';

type Row = { id: string; number: string; amount: string };

describe('DataTable (finance)', () => {
    const columns: ReadonlyArray<DataColumn<Row>> = [
        { key: 'num', header: 'เลขที่เอกสาร', type: 'link', render: (r) => r.number },
        { key: 'amt', header: 'จำนวนเงิน', type: 'money', render: (r) => r.amount },
    ];

    it('renders headers and rows', () => {
        const rows: Row[] = [
            { id: '1', number: 'INV-001', amount: '1,000.00' },
            { id: '2', number: 'INV-002', amount: '2,000.00' },
        ];
        render(
            <DataTable
                columns={columns}
                rows={rows}
                getRowKey={(r) => r.id}
            />,
        );
        expect(screen.getByText('เลขที่เอกสาร')).toBeInTheDocument();
        expect(screen.getByText('จำนวนเงิน')).toBeInTheDocument();
        expect(screen.getByText('INV-001')).toBeInTheDocument();
        expect(screen.getByText('INV-002')).toBeInTheDocument();
    });

    it('right-aligns money columns by default', () => {
        const rows: Row[] = [{ id: '1', number: 'INV-001', amount: '1,000.00' }];
        render(
            <DataTable
                columns={columns}
                rows={rows}
                getRowKey={(r) => r.id}
            />,
        );
        const moneyHeader = screen.getByText('จำนวนเงิน');
        expect(moneyHeader.className).toMatch(/text-right/);
    });

    it('renders the Thai empty state when rows is empty', () => {
        render(
            <DataTable
                columns={columns}
                rows={[]}
                getRowKey={(r) => r.id}
                emptyTitle="ไม่พบข้อมูลที่ค้นหา"
                emptyDescription="ลองเปลี่ยนช่วงวันที่อื่น"
            />,
        );
        expect(screen.getByText('ไม่พบข้อมูลที่ค้นหา')).toBeInTheDocument();
        expect(screen.getByText('ลองเปลี่ยนช่วงวันที่อื่น')).toBeInTheDocument();
    });

    it('invokes onRowClick when a row is clicked', () => {
        const rows: Row[] = [{ id: '1', number: 'INV-001', amount: '1,000.00' }];
        const onRowClick = jest.fn();
        render(
            <DataTable
                columns={columns}
                rows={rows}
                getRowKey={(r) => r.id}
                onRowClick={onRowClick}
            />,
        );
        fireEvent.click(screen.getByText('INV-001'));
        expect(onRowClick).toHaveBeenCalledTimes(1);
        expect(onRowClick).toHaveBeenCalledWith(rows[0]);
    });
});
