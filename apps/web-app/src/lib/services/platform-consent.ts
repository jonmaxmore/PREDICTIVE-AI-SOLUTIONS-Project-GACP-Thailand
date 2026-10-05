/**
 * ความยินยอมของแพลตฟอร์ม — ข้อตกลงการใช้บริการ และนโยบายความเป็นส่วนตัว
 *
 * คนละอย่างกับคำรับรอง ส่วนที่ ๔ ของ กทล.1 ซึ่งเป็นคำรับรองต่อกรมฯ เกี่ยวกับตัวคำขอ ·
 * สองใบนี้เป็นฐานทางกฎหมายของ **แพลตฟอร์ม** ในการประมวลผลข้อมูลส่วนบุคคล (PDPA)
 * และหลังบ้านปฏิเสธการยื่นคำขอด้วย 403 `CONSENT_REQUIRED` จนกว่าจะมีบันทึกทั้งสองใบ
 *
 * ทำไมไฟล์นี้ถึงเกิด: wizard รุ่นก่อนมีขั้น "ความยินยอม" เป็นขั้นหนึ่ง และการกวาดล้าง
 * ของ Task 15 ลบขั้นนั้นทิ้งพร้อมของเก่าอื่น ๆ · ประตูยื่นยังบังคับเหมือนเดิม ⇒ ตั้งแต่
 * wizard หกขั้นขึ้นมา **ไม่มีคำขอใดยื่นได้เลย** ทุกคนได้ 403 ที่หน้าจอแปลว่า
 * "ส่งคำขอไม่สำเร็จ" โดยไม่มีทางแก้ (เดินจริงเจอ 2026-09-06)
 *
 * เก็บเป็นสองใบแยกกัน ไม่ยุบเป็นติ๊กเดียว: หลังบ้านบันทึกเป็นคนละหมวด มีเลขเวอร์ชันของ
 * ตัวเอง และ PDPA ต้องการความยินยอมที่ "เฉพาะเจาะจง" — ติ๊กเดียวครอบสองเรื่องไม่ใช่
 */
import { api } from '@/lib/api/api-client';

export const PLATFORM_CONSENT_CATEGORIES = Object.freeze([
    'TERMS_OF_SERVICE',
    'PRIVACY_POLICY',
] as const);

export type PlatformConsentCategory = (typeof PLATFORM_CONSENT_CATEGORIES)[number];

export const PLATFORM_CONSENT_COPY_TH: Record<PlatformConsentCategory, string> = Object.freeze({
    TERMS_OF_SERVICE: 'ข้าพเจ้ายอมรับข้อตกลงการใช้บริการของระบบรับรองมาตรฐาน GACP',
    PRIVACY_POLICY: 'ข้าพเจ้ายินยอมให้เก็บ ใช้ และเปิดเผยข้อมูลส่วนบุคคลตามนโยบายความเป็นส่วนตัว',
});

/** เอกสารฉบับเต็มของแต่ละหมวด — ประตูเดียวกับที่หลังบ้านเสิร์ฟข้อความไว้ */
export function platformConsentDocumentUrl(category: PlatformConsentCategory): string {
    return `/api/consent/document/${category}`;
}

type ConsentRow = { granted?: boolean };
type ConsentsPayload = { consents?: Record<string, ConsentRow> };

/**
 * หมวดที่ยัง **ไม่ได้** ให้ความยินยอม · อ่านไม่ได้ = ถือว่ายังไม่ได้ให้ทั้งสองใบ
 * ไม่ใช่ถือว่าให้แล้ว — เดาไปทางที่ผ่อนปรนคือการยื่นคำขอโดยไม่มีฐานทางกฎหมาย
 */
export function missingPlatformConsents(payload: ConsentsPayload | null | undefined): PlatformConsentCategory[] {
    const consents = payload?.consents;
    if (!consents || typeof consents !== 'object') { return [...PLATFORM_CONSENT_CATEGORIES]; }
    return PLATFORM_CONSENT_CATEGORIES.filter((category) => consents[category]?.granted !== true);
}

export async function readPlatformConsents(): Promise<PlatformConsentCategory[]> {
    const response = await api.get<ConsentsPayload>('/consent');
    if (!response.success) { return [...PLATFORM_CONSENT_CATEGORIES]; }
    return missingPlatformConsents(response.data);
}

/** บันทึกความยินยอมทีละหมวด · คืนหมวดที่บันทึกไม่สำเร็จ เพื่อให้ผู้เรียกบอกผู้ใช้ได้ตามจริง */
export async function grantPlatformConsents(
    categories: readonly PlatformConsentCategory[],
): Promise<PlatformConsentCategory[]> {
    const failed: PlatformConsentCategory[] = [];
    for (const category of categories) {
        const response = await api.post<{ granted?: boolean }>('/consent', { category, granted: true });
        if (!response.success) { failed.push(category); }
    }
    return failed;
}
