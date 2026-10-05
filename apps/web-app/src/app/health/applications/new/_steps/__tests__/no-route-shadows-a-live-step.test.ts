/**
 * ไม่มีเส้นทางลัดใดมาบังขั้นที่ยังมีชีวิต
 *
 * `app/health/applications/new/step/<n>/page.tsx` ที่เป็นตัวเลขคงที่ **ชนะ** `[id]/page.tsx`
 * เสมอตามกติกาของ Next · ไฟล์แบบนี้ถูกเขียนไว้ตอน v3.1.0 และ v3.2.0 เพื่อพาบุ๊กมาร์กเก่า
 * ของช่องที่ถูกยุบไปให้ไปยังที่ที่ถูก ซึ่งตอนนั้นถูกต้อง
 *
 * แล้ว wizard ถูกสร้างใหม่เป็นหกขั้น และ **ช่องที่ 3 กลับมามีชีวิต** (สถานที่และที่ดิน) แต่
 * `step/3/page.tsx` ยังยืนอยู่และ redirect ไปขั้น 4 อย่างไม่มีเงื่อนไข ⇒ ผู้ยื่นทุกคนที่กด
 * "ถัดไป" จากขั้น 2 ถูกโยนข้ามไปขั้น 4 ทันที แล้วยามเส้นทางก็บล็อกขั้น 4 เพราะขั้น 3
 * ไม่เคยถูกกรอก · จบลงที่หน้าที่ไปไหนไม่ได้ และไม่มีอะไรแดงให้เห็น
 *
 * เจอตอนเดินจริง 2026-09-06: กด ถัดไป จากขั้น 2 → url เป็น /step/3 หนึ่งอึดใจ แล้วเด้งเป็น
 * /step/4 เอง · การกวาดล้างของ Task 15 ไล่ตามไฟล์คอมโพเนนต์ ไม่ได้ไล่ไฟล์ route
 */
import { describe, expect, it } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import { FLOW_STEPS } from '../application-flow-config';

const STEP_DIR = path.join(__dirname, '..', '..', 'step');

/** เลขขั้นที่มีไฟล์ route แบบคงที่ของตัวเอง */
function staticStepRoutes(): number[] {
    return fs.readdirSync(STEP_DIR, { withFileTypes: true })
        .filter((e) => e.isDirectory() && /^[0-9]+$/.test(e.name))
        .filter((e) => fs.existsSync(path.join(STEP_DIR, e.name, 'page.tsx')))
        .map((e) => Number(e.name));
}

describe('เส้นทางคงที่ของขั้น ไม่บังขั้นที่ยังมีชีวิต', () => {
    const live = new Set(FLOW_STEPS.map((s) => s.stepNumber));

    it('อ่านทั้งสองรายการได้จริง ไม่ใช่รายการว่าง', () => {
        expect(live.size).toBeGreaterThan(5);
        expect(FLOW_STEPS.some((s) => s.key === 'site-land')).toBe(true);
    });

    it('ทุกไฟล์ route แบบคงที่ ต้องเป็นช่องที่ไม่มีขั้นอยู่แล้วเท่านั้น', () => {
        const shadowing = staticStepRoutes().filter((n) => live.has(n));
        // ถ้าข้อนี้แดง: ลบไฟล์ route นั้นทิ้ง อย่าลบขั้นออกจาก FLOW_STEPS เพื่อให้เทสผ่าน
        expect(shadowing).toEqual([]);
    });

    it('ช่องที่ยุบไปแล้วยังพาบุ๊กมาร์กเก่าไปที่ถูกได้อยู่', () => {
        // 11 ถูกยุบเข้ากับ 10 ตั้งแต่ v3.2.0 และยังไม่ได้กลับมามีชีวิต
        expect(live.has(11)).toBe(false);
        expect(fs.existsSync(path.join(STEP_DIR, '11', 'page.tsx'))).toBe(true);
    });
});
