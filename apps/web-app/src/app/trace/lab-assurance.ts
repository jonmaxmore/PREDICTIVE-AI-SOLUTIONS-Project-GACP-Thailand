/**
 * ผลวิเคราะห์บนหน้าสแกนสาธารณะ — มติ operator 2026-09-05
 *
 * ไฟล์นี้เคยบังคับมติ R9: หน้าสาธารณะพูดได้อย่างเดียวว่า "มีผลตรวจ" หรือ "ยังไม่มี" ห้ามแสดง
 * ไฟล์รายงาน · มตินั้นถูกต้องตอนที่มันมีผล และคำอธิบายเดิมยังอยู่ในประวัติ git
 *
 * มติใหม่: "ให้อัปโหลด COA และพวกชื่อฟาร์ม และที่อยู่ติดต่อได้ **เมื่อสแกนต้องเห็นทั้งหมด**"
 * หลังบ้านทำตามแล้ว (T13 — `services/lab-evidence-service.js`) แต่ไฟล์นี้ยังบังคับมติเดิม
 * และยังอ่านรูปร่างก่อน T13 (`labTest.tested` แทน `labTest.lot.tested`) ⇒ หน้าจอไม่แสดง
 * ผลแล็บเลย ทั้งที่ API ส่งมาครบ
 *
 * **เจอด้วยการกดผ่านเบราว์เซอร์จริง** ไม่ใช่จากการอ่านโค้ด: payload มีที่อยู่และไฟล์ COA
 * แต่หน้าที่ผู้ซื้อเห็นไม่มีทั้งสองอย่าง — "เมื่อสแกนต้องเห็น" ไม่ได้แปลว่า "อยู่ใน JSON"
 *
 * สิ่งที่ไม่เปลี่ยน: ค่าที่วัดได้ (THC/CBD/ความชื้น) ไม่แสดง — ไม่ใช่เพราะเป็นความลับ แต่เพราะ
 * แพลตฟอร์มไม่เก็บมันเลย มติคือ "ไม่พิมพ์ค่าเอง ให้แนบผลแล็บ" ⇒ เอกสารคือคำตอบ ไม่ใช่ตัวเลข
 */
import type { TraceData } from './[qr-code]/trace-page-types';

export interface LabAssurance {
    /** ให้การ์ด "ผลตรวจวิเคราะห์" แสดงหรือไม่ */
    show: boolean;
    /** มีผลตรวจของรุ่นที่ล็อตนี้มาจากหรือไม่ */
    tested: boolean;
    labName: string | null;
    /** ไฟล์ COA ที่เปิดดูได้ — สิ่งที่มติ 2026-09-05 เปิด */
    fileUrl: string | null;
    fileName: string | null;
    reportNumber: string | null;
    reportedAt: string | null;
    /** ใครเป็นคนใส่เอกสารนี้เข้ามา — ผู้ซื้อต้องไม่ต้องเดา */
    verificationStatus: string | null;
    captionTH: string;
    noteTH: string;
}

const EMPTY: LabAssurance = {
    show: false, tested: false, labName: null, fileUrl: null, fileName: null,
    reportNumber: null, reportedAt: null, verificationStatus: null,
    captionTH: 'ยังไม่มีผลตรวจ Lab',
    noteTH: 'ผู้รับซื้อขอเอกสารฉบับเต็มจากเกษตรกรได้โดยตรง',
};

/** ก้อนผลแล็บของล็อต ตามรูปร่างหลัง T13 — เผื่อรูปร่างก่อนหน้าไว้ด้วยสำหรับหน้าที่ยังไม่อัปเดต */
function lotLabOf(data: TraceData['data'] | undefined | null) {
    const labTest = (data as { lot?: { labTest?: unknown } } | null | undefined)?.lot?.labTest as
        | { lot?: Record<string, unknown>; tested?: boolean }
        | null
        | undefined;
    if (!labTest) { return null; }
    // หลัง T13: { lot: {...}, farm: {...} } · ก่อนหน้านั้น: { tested }
    return (labTest.lot as Record<string, unknown> | undefined) ?? (labTest as Record<string, unknown>);
}

export function deriveLabAssurance(
    data: TraceData['data'] | undefined | null,
    isLot: boolean,
): LabAssurance {
    const cycleOrBatchLab = (data as { lab_analysis?: { tested?: boolean; labName?: string } } | null | undefined)?.lab_analysis ?? null;
    const lotLab = isLot ? lotLabOf(data) : null;
    if (!cycleOrBatchLab && !lotLab) { return EMPTY; }

    const latest = (lotLab?.latest ?? null) as Record<string, string | null> | null;
    const tested = Boolean(cycleOrBatchLab?.tested) || Boolean(lotLab?.tested);
    const labName = (latest?.labName ?? cycleOrBatchLab?.labName) || null;

    return {
        show: true,
        tested,
        labName,
        fileUrl: latest?.fileUrl ?? null,
        fileName: latest?.fileName ?? null,
        reportNumber: latest?.reportNumber ?? null,
        reportedAt: latest?.reportedAt ?? null,
        verificationStatus: latest?.verificationStatus ?? null,
        captionTH: tested
            ? (labName ? `มีผลตรวจ Lab แล้ว ตรวจโดย ${labName}` : 'มีผลตรวจ Lab แล้ว')
            : 'ยังไม่มีผลตรวจ Lab',
        noteTH: tested
            ? 'เอกสารนี้คือผลวิเคราะห์ที่แนบไว้กับรุ่นเก็บเกี่ยว ล็อตนี้จึงอ้างอิงฉบับเดียวกัน'
            : 'ผู้รับซื้อขอเอกสารฉบับเต็มจากเกษตรกรได้โดยตรง',
    };
}
