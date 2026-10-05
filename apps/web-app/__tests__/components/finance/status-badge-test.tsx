/**
 * @jest-environment jsdom
 *
 * Smoke tests for the FlowAccount-style <StatusBadge /> shared
 * finance component. Verifies the canonical status → Thai label
 * + tone class mapping used across the slip queue, AR aging,
 * customer statement, and report pages.
 */
import React from 'react';
import { render, screen } from '@/__tests__/test-utils';
import '@testing-library/jest-dom';

import { StatusBadge } from '@/components/finance';

describe('StatusBadge (finance)', () => {
    it('renders the pending Thai label with amber tone for PENDING', () => {
        const { container } = render(<StatusBadge status="PENDING" />);
        expect(screen.getByText('รอดำเนินการ')).toBeInTheDocument();
        const el = container.firstElementChild as HTMLElement;
        expect(el.className).toMatch(/bg-amber-100/);
        expect(el.className).toMatch(/text-amber-800/);
    });

    it('renders the paid Thai label with emerald tone for PAID', () => {
        const { container } = render(<StatusBadge status="PAID" />);
        expect(screen.getByText('ชำระแล้ว')).toBeInTheDocument();
        const el = container.firstElementChild as HTMLElement;
        expect(el.className).toMatch(/bg-emerald-100/);
        expect(el.className).toMatch(/text-emerald-800/);
    });

    it('renders the cancelled Thai label with rose tone for CANCELLED', () => {
        const { container } = render(<StatusBadge status="CANCELLED" />);
        expect(screen.getByText('ยกเลิก')).toBeInTheDocument();
        const el = container.firstElementChild as HTMLElement;
        expect(el.className).toMatch(/bg-rose-100/);
    });

    it('falls back to draft tone for unknown statuses', () => {
        const { container } = render(<StatusBadge status="UNKNOWN_STATUS" />);
        expect(screen.getByText('UNKNOWN_STATUS')).toBeInTheDocument();
        const el = container.firstElementChild as HTMLElement;
        expect(el.className).toMatch(/bg-slate-100/);
    });

    it('respects label override', () => {
        render(<StatusBadge status="PAID" label="ออกใบเสร็จแล้ว" />);
        expect(screen.getByText('ออกใบเสร็จแล้ว')).toBeInTheDocument();
    });

    it('respects tone override', () => {
        const { container } = render(<StatusBadge status="PENDING" tone="info" />);
        const el = container.firstElementChild as HTMLElement;
        expect(el.className).toMatch(/bg-sky-100/);
    });
});
