/**
 * บัญชีที่ seed ไว้ — ใช้เมื่อไม่มีการตั้งค่าจากภายนอก
 *
 * ทำไมไฟล์นี้ถึงมี: เทส e2e หลายไฟล์เคยข้ามตัวเองด้วย `test.skip(!HAS_CREDS, ...)`
 * เมื่อไม่มี `E2E_TEST_IDENTIFIER` / `E2E_TEST_PASSWORD` · สองตัวแปรนั้นถูกตั้งไว้เฉพาะใน
 * workflow กลางคืนซึ่งไม่รันอีกแล้ว ⇒ **เทสเหล่านั้นข้ามตัวเองตลอดกาล** และไม่มีใครรู้
 * เพราะผลรันขึ้นเป็นสีเขียว
 *
 * เทสที่ข้ามตัวเองเงียบ ๆ แย่กว่าเทสที่ไม่มี เพราะมันนับรวมอยู่ในตัวเลข "ผ่านทั้งหมด"
 *
 * ค่าปริยายที่นี่คือบัญชีของ `apps/backend/prisma/seed-gacp.js` — ไม่ใช่ความลับ
 * (รหัสเดียวกันนี้เขียนตรง ๆ อยู่ใน e2e/e2e-golden-scenario.spec.ts อยู่แล้ว) ·
 * สภาพแวดล้อมที่ seed แล้วจะมีบัญชีนี้เสมอ ⇒ ไม่ต้องข้าม
 *
 * ถ้าสภาพแวดล้อมยังไม่ได้ seed เทสจะ **ล้มเหลว** ไม่ใช่ข้าม — ซึ่งเป็นคำตอบที่ถูกต้อง:
 * มันบอกว่าสภาพแวดล้อมผิด ส่วนการข้ามไม่บอกอะไรเลย
 *
 * ระวัง: ล็อกอินผิดรหัสห้าครั้งติดจะล็อกบัญชี 15 นาที (the change log) — อย่าใช้ไฟล์นี้
 * อุ่นประตูด้วยรหัสผิด ใช้ผู้ใช้ที่ไม่มีอยู่จริงแทน
 */

/** ผู้ขอรับรองคนแรกใน seed — `APPLICANTS[0].healthId` */
export const SEEDED_HEALTH_IDENTIFIER = '1186494077533';

/** `PASSWORDS.APPLICANT` ใน seed-gacp.js */
export const SEEDED_PASSWORD = 'Test@12345';

/** เลขบัตรที่ไม่มีในระบบ — สำหรับอุ่นประตูโดยไม่เสี่ยงล็อกบัญชีจริง */
export const NONEXISTENT_IDENTIFIER = '9999999999999';

export const healthIdentifier = (): string =>
    process.env.E2E_TEST_IDENTIFIER || SEEDED_HEALTH_IDENTIFIER;

export const healthPassword = (): string =>
    process.env.E2E_TEST_PASSWORD || SEEDED_PASSWORD;
