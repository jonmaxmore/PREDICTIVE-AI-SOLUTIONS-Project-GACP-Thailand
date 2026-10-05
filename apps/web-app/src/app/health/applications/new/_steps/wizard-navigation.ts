/**
 * ปุ่ม "ย้อนกลับ / ถัดไป" ของ wizard — ตัดสินที่เดียว ให้ขั้นไหนก็ลืมไม่ได้
 *
 * จนถึง 2026-09-06 มีเพียงขั้นที่ 1 ที่เรนเดอร์ `ApplicationNavigation` ของตัวเอง ส่วนขั้น
 * 2-6 ไม่มีปุ่มอะไรเลยสักปุ่ม — เดินจริงผ่านเบราว์เซอร์แล้วกรอกขั้น 2 ครบ พบว่า **ไปต่อไม่ได้
 * และย้อนกลับไม่ได้** ทั้งหน้าไม่มี `<button>` แม้แต่ตัวเดียว · แถบขั้นด้านบนเป็นตัวบอกความ
 * คืบหน้าอย่างเดียว กดไม่ได้ตามคอมเมนต์ของมันเอง
 *
 * บทเรียนคือ "ให้แต่ละขั้นเรนเดอร์ปุ่มของตัวเอง" แปลว่าขั้นที่ลืมจะกลายเป็นทางตัน โดยไม่มี
 * อะไรพัง ไม่มีเทสแดง และไม่มีใครเห็นจนกว่าจะมีคนกดจริง · การตัดสินจึงย้ายมาอยู่ที่นี่ และ
 * หน้าห่อของ wizard เรนเดอร์มันให้ทุกขั้นเหมือนกันหมด
 *
 * เงื่อนไข "ไปต่อได้ไหม" ไม่ได้เขียนใหม่ที่นี่ — ถามจาก `isStepComplete` ตัวเดียวกับที่ยาม
 * เส้นทาง (`canProceedFromStep`) ใช้ ปุ่มกับยามจึงขัดกันไม่ได้
 */
import { FLOW_STEPS } from './application-flow-config';
import { isStepComplete, type WizardState } from './hooks/use-application-flow-store';

/** ขั้นที่เป็น "แบบฟอร์ม" — หลังจากนี้เป็นเฟสชำระเงิน ซึ่งมีปุ่มของตัวเอง */
const FORM_STEP_NUMBERS: readonly number[] = Object.freeze(
    FLOW_STEPS.map((s) => s.stepNumber).filter((n) => n <= 6),
);

export interface WizardNavPlan {
    /** เส้นทางของปุ่มย้อนกลับ — null แปลว่าไม่แสดงปุ่ม (ขั้นแรก) */
    backHref: string | null;
    /** เส้นทางของปุ่มถัดไป — null แปลว่าไม่แสดงปุ่ม (ขั้นสุดท้ายมีปุ่มยื่นของตัวเอง) */
    nextHref: string | null;
    /** แสดงปุ่มถัดไปแต่กดไม่ได้ เพราะขั้นนี้ยังกรอกไม่ครบ */
    nextDisabled: boolean;
}

const hrefFor = (stepNumber: number) => `/health/applications/new/step/${stepNumber}`;

/**
 * ขั้นสุดท้ายของแบบฟอร์ม (ตรวจทาน) ไม่มีปุ่ม "ถัดไป" — ปุ่มที่นั่นคือ "ยื่นคำขอ" ซึ่งมีเงื่อนไข
 * ของตัวเอง (คำรับรองครบ + เอกสารครบ) และเป็นของหน้าตรวจทานโดยเฉพาะ
 */
export function wizardNavFor(stepNumber: number, state: WizardState): WizardNavPlan {
    const index = FORM_STEP_NUMBERS.indexOf(stepNumber);
    if (index === -1) {
        // ไม่ใช่ขั้นของแบบฟอร์ม (เฟสชำระเงิน / หน้าสำเร็จ) — ไม่ยุ่ง
        return { backHref: null, nextHref: null, nextDisabled: true };
    }
    const previous = index > 0 ? (FORM_STEP_NUMBERS[index - 1] ?? null) : null;
    const next = index < FORM_STEP_NUMBERS.length - 1 ? (FORM_STEP_NUMBERS[index + 1] ?? null) : null;
    return {
        backHref: previous === null ? null : hrefFor(previous),
        nextHref: next === null ? null : hrefFor(next),
        nextDisabled: !isStepComplete(state, stepNumber),
    };
}
