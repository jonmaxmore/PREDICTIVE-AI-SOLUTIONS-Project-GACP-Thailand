/**
 * ป้าย QR กลางแปลง — คำกล่าวอ้างเรื่องใบรับรองต้องมาจากข้อมูล ไม่ใช่จากข้อความคงที่
 *
 * หน้าที่คนทั่วไปสแกนป้ายกลางแปลงแล้วเจอ พิมพ์บรรทัด "แหล่งปลูกได้รับการรับรอง GACP"
 * พร้อมไอคอนโล่ **ทุกครั้ง** โดยไม่อ่านอะไรเลย · เซิร์ฟเวอร์ส่งสถานะจริงมาให้อยู่แล้ว
 * (resolve-plot-cycle.js:620 `certificate: publicCertificateState(...)`) แต่ชนิดข้อมูล
 * ของหน้าจอไม่ได้ประกาศคีย์นั้นไว้ด้วยซ้ำ ⇒ ไม่มีใครอ่าน
 *
 * ผลคือแปลงที่ยังไม่เคยได้ใบรับรอง และแปลงที่ใบถูกเพิกถอน ต่างก็ประกาศกับคนที่เดินผ่าน
 * ว่า "ได้รับการรับรอง GACP" — เป็นคำกล่าวอ้างเท็จบนป้ายสาธารณะของหน่วยงานรัฐ
 *
 * หน้าล็อตแก้เรื่องเดียวกันไปแล้วใน F-QA-02 และมีตัวตัดสินร่วมอยู่ที่ ../certificate-status
 * ("เพื่อให้ประตูสาธารณะทุกบานพูดตรงกัน") — ป้ายแปลงไม่เคยถูกต่อเข้ากับมัน
 *
 * อีกข้อในไฟล์เดียวกัน: ตัวเลขที่ระบบ "ตั้งใจไม่เปิดเผย" สำหรับพืชควบคุม (จำนวนต้นตามแผน
 * และขนาดพื้นที่) ถูกพิมพ์เป็น "0" เพราะ formatNumber(undefined) = 0 · "0 ต้น" ไม่ใช่
 * การปกปิด มันคือการบอกข้อเท็จจริงที่ผิด
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
    const router = { push: jest.fn(), replace: jest.fn(), refresh: jest.fn(), back: jest.fn(), forward: jest.fn(), prefetch: jest.fn() };
    return {
        useRouter: () => router,
        usePathname: () => '/trace/plot-cycle/PLOT-QR-1',
        useSearchParams: () => new URLSearchParams(),
        useParams: () => ({ 'qr-code': 'PLOT-QR-1' }),
    };
});

const mockFetchTrace = jest.fn<() => Promise<unknown>>();
jest.mock('../trace-fetch', () => ({ fetchTraceEnvelope: () => mockFetchTrace() }));

import ClientView from '../plot-cycle/[qr-code]/client-view';

const BASE = {
    farm: { name: 'ไร่ทดสอบสมุนไพร', district: 'สันทราย', province: 'เชียงใหม่' },
    source: { plot: { plotId: 'p1', plotName: null, cyclePlotId: null }, cycle: { cycleId: 'c1', cycleName: null } },
    cycle: { name: null, status: 'PLANTED', startDateTH: '1 ม.ค. 2569', expectedHarvestDateTH: null },
    plot: {},                                   // ตัวเลขถูกกันไว้ตามมติพืชควบคุม
    traceSummary: { batchCount: 0, lotCount: 0, latestBatch: null, latestLots: [] },
};

const UNCONDITIONAL_CLAIM = 'แหล่งปลูกได้รับการรับรอง GACP';
const NEVER = 'ยังไม่มีใบรับรองสำหรับแปลงนี้';
const LAPSED = 'หมดอายุหรือไม่มีผล';
const VALID = 'ใช้งานได้ ยังไม่หมดอายุ';

describe('ป้าย QR กลางแปลง — พูดตามใบรับรองที่มีจริง', () => {
    let container: HTMLDivElement | null = null;
    let root: Root | null = null;

    beforeEach(() => { jest.clearAllMocks(); });
    afterEach(() => {
        if (root) { act(() => { root?.unmount(); }); root = null; }
        if (container) { container.remove(); container = null; }
    });

    async function screenText(certificate: unknown): Promise<string> {
        mockFetchTrace.mockResolvedValue({ kind: 'ok', payload: { success: true, data: { ...BASE, certificate } } });
        container = document.createElement('div');
        document.body.appendChild(container);
        act(() => { root = createRoot(container!); root.render(<ClientView />); });
        for (let i = 0; i < 20; i++) { await act(async () => { await Promise.resolve(); }); }
        const text = container.textContent || '';
        expect(text).toContain('ไร่ทดสอบสมุนไพร');   // หน้าจอเรนเดอร์จริง
        return text;
    }

    it('แปลงที่ยังไม่เคยมีใบรับรอง: ไม่ประกาศว่าได้รับการรับรอง', async () => {
        const text = await screenText({ status: 'NONE', isValid: false });
        expect(text).not.toContain(UNCONDITIONAL_CLAIM);
        expect(text).toContain(NEVER);
        expect(text).not.toContain(LAPSED);
    });

    it('เซิร์ฟเวอร์ไม่ส่งสถานะมาเลย ก็ยังไม่ประกาศว่ารับรองแล้ว', async () => {
        const text = await screenText(undefined);
        expect(text).not.toContain(UNCONDITIONAL_CLAIM);
        expect(text).toContain(NEVER);
    });

    it('ใบรับรองใช้ได้: บอกว่าใช้ได้', async () => {
        const text = await screenText({ status: 'ACTIVE', isValid: true });
        expect(text).toContain(VALID);
        expect(text).not.toContain(NEVER);
    });

    it('ใบรับรองถูกเพิกถอน: บอกตรง ๆ ไม่กลบเป็น "ยังไม่เคยมี"', async () => {
        const text = await screenText({ status: 'REVOKED', isValid: false });
        expect(text).toContain(LAPSED);
        expect(text).not.toContain(NEVER);
        expect(text).not.toContain(UNCONDITIONAL_CLAIM);
    });

    it('ตัวเลขที่ตั้งใจไม่เปิดเผย ไม่ถูกพิมพ์เป็น 0', async () => {
        const text = await screenText({ status: 'ACTIVE', isValid: true });
        const plantCountBlock = text.slice(Math.max(0, text.indexOf('จำนวนต้นตามแผน') - 8), text.indexOf('จำนวนต้นตามแผน') + 24);
        expect(plantCountBlock).not.toMatch(/0\s*จำนวนต้นตามแผน/);
        expect(text).toContain('ไม่เปิดเผย');
    });
});
