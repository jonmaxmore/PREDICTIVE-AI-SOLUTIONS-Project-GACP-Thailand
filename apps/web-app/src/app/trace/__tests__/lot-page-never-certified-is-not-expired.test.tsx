/**
 * F-QA-02 (deep-qa 2026-09-06) — หน้าล็อตสาธารณะที่ผู้ซื้อสแกนเข้ามา
 *
 * เห็นบนเดโมจริง (evidence/screens-2026-09-06/07-public-trace-lot.png): ล็อต
 * LOT-2569-000019-A ไม่มีใบรับรองเลย แต่หน้าจอขึ้นป้ายแดง "หมดอายุหรือไม่มีผล"
 * และ "เลขที่ใบรับรอง: -" ผู้ซื้ออ่านว่า "ฟาร์มนี้เคยได้ใบรับรอง แล้วปล่อยให้ขาด"
 * ซึ่งเป็นคำกล่าวอ้างคนละเรื่อง และเสียหายกว่าความจริงมาก
 *
 * เทสนี้เรนเดอร์หน้าจริงกับข้อมูลสามแบบ — ไม่มีใบ / ใบใช้ได้ / ใบขาด — แล้วอ่าน
 * ข้อความบนจอ (ไม่ใช่ซอร์ส) ว่าทั้งสามพูดคนละอย่าง
 *
 * รูปแบบ createRoot + act ตามธรรมเนียมของ repo นี้ (ไม่มี @testing-library/react)
 */

import * as React from 'react';
import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

declare global {

    var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('next/navigation', () => {
    const router = {
        push: jest.fn(), replace: jest.fn(), refresh: jest.fn(),
        back: jest.fn(), forward: jest.fn(), prefetch: jest.fn(),
    };
    return {
        useRouter: () => router,
        usePathname: () => '/trace/lot/LOT-2569-000019-A',
        useSearchParams: () => new URLSearchParams(),
        useParams: () => ({ 'lot-id': 'LOT-2569-000019-A' }),
    };
});

const mockFetchTrace = jest.fn<() => Promise<unknown>>();
jest.mock('../trace-fetch', () => ({
    fetchTraceEnvelope: () => mockFetchTrace(),
}));

import ClientView from '../lot/[lot-id]/client-view';

const BASE_LOT = {
    lotId: 'lot-1',
    lotNumber: 'LOT-2569-000019-A',
    batchId: 'batch-1',
    batchNumber: 'HB-2569-000019',
    status: 'Raw Material (GACP)',
    farm: { name: 'ฟาร์มทดสอบ', district: 'เมือง', province: 'เชียงใหม่' },
    harvestDate: '2026-08-01',
    harvestDateTH: '1 ส.ค. 2569',
    packaging: { type: 'ถุงสุญญากาศ', unitWeight: 1, unitCount: 10, totalWeight: 10 },
    qrUrl: null,
    links: { requiresAuthentication: true },
    traceabilityScope: 'RAW_MATERIAL_GACP',
};

const CERT = {
    reference: 'GACP-TH-2569-85B448',
    issuedDate: '2026-01-01',
    issuedDateTH: '1 ม.ค. 2569',
    expiryDate: '2029-01-01',
    expiryDateTH: '1 ม.ค. 2572',
    isValid: true,
};

const EXPIRED_COPY = 'หมดอายุหรือไม่มีผล';
const NEVER_CERTIFIED_COPY = 'ยังไม่มีใบรับรองสำหรับล็อตนี้';

describe('หน้าล็อตสาธารณะ — ไม่เคยมีใบรับรอง ≠ ใบรับรองหมดอายุ', () => {
    let container: HTMLDivElement | null = null;
    let root: Root | null = null;

    beforeEach(() => {
        jest.clearAllMocks();
    });

    afterEach(() => {
        if (root) {
            act(() => { root?.unmount(); });
            root = null;
        }
        if (container) {
            container.remove();
            container = null;
        }
    });

    async function screenText(certificate: unknown): Promise<string> {
        mockFetchTrace.mockResolvedValue({
            kind: 'ok',
            payload: { success: true, data: { ...BASE_LOT, certificate } },
        });
        container = document.createElement('div');
        document.body.appendChild(container);
        act(() => {
            root = createRoot(container!);
            root.render(<ClientView />);
        });
        for (let i = 0; i < 20; i++) {
            await act(async () => { await Promise.resolve(); });
        }
        const text = container.textContent || '';
        expect(text).toContain('LOT-2569-000019-A'); // the page really rendered
        return text;
    }

    it('ล็อตที่ไม่เคยมีใบรับรอง: บอกว่ายังไม่มีใบ และไม่พิมพ์ "หมดอายุหรือไม่มีผล"', async () => {
        const text = await screenText(null);

        expect(text).toContain(NEVER_CERTIFIED_COPY);
        expect(text).not.toContain(EXPIRED_COPY);
    });

    it('ล็อตที่ไม่เคยมีใบรับรอง: ไม่มีแถว "เลขที่ใบรับรอง" ที่ตอบได้แค่ "-"', async () => {
        const text = await screenText(null);

        expect(text).not.toContain('เลขที่ใบรับรอง');
        expect(text).toContain('ยังไม่เคยมีการออกใบรับรอง GACP');
    });

    it('ใบรับรองที่ใช้ได้จริง: เขียว พร้อมเลขที่ใบ และไม่มีคำว่ายังไม่มีใบ', async () => {
        const text = await screenText(CERT);

        expect(text).toContain('ใช้งานได้ ยังไม่หมดอายุ');
        expect(text).toContain(CERT.reference);
        expect(text).not.toContain(NEVER_CERTIFIED_COPY);
    });

    it('ใบรับรองที่ขาดจริง: ยังพูดว่าหมดอายุหรือไม่มีผล — การแก้นี้ไม่ทำให้ของจริงอ่อนลง', async () => {
        const text = await screenText({ ...CERT, isValid: false });

        expect(text).toContain(EXPIRED_COPY);
        expect(text).toContain(CERT.reference);
        expect(text).toContain('เคยได้รับใบรับรอง');
        expect(text).not.toContain(NEVER_CERTIFIED_COPY);
    });
});
