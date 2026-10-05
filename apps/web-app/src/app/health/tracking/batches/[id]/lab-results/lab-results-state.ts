/**
 * ผลวิเคราะห์ (COA) ของรุ่นเก็บเกี่ยว — กติกาของหน้าจอ T10
 *
 * แยกออกมาจาก client-view เพราะกติกาที่ตัดสินว่า "กดส่งได้ไหม" และ "หน้าจอพูดว่าอะไร"
 * ต้องทดสอบได้โดยไม่ต้องเรนเดอร์อะไรเลย — แบบเดียวกับ document-check-state.ts
 * และ revision-state.ts
 *
 * ออกแบบ: docs/design/2026-09-05-tnt-loop-and-farmer-updates.md §4.5
 */

/** ชื่อห้องปฏิบัติการสั้นกว่านี้ไม่พอให้ใครตามกลับไปหาต้นทางได้ */
export const MIN_LAB_NAME_LENGTH = 2;

export type LabReport = {
    id: string;
    fileUrl: string;
    fileName?: string | null;
    labName: string;
    reportNumber?: string | null;
    reportedAt?: string | null;
    verificationCode?: string | null;
    verificationStatus: 'FARMER_UPLOADED' | 'OFFICER_VERIFIED';
    uploadedAt: string;
};

export type UploadForm = {
    file: File | null;
    labName: string;
    reportNumber: string;
    reportedAt: string;
    verificationCode: string;
};

export type SubmitState =
    | { canSubmit: false; reason: 'NO_FILE' | 'NO_LAB_NAME' | 'IN_FLIGHT' }
    | { canSubmit: true; reason: null };

/**
 * กดส่งได้เมื่อไร
 *
 * เหตุผลถูกส่งกลับเป็นรหัส ไม่ใช่ข้อความ เพื่อให้หน้าจอเลือกประโยคเอง และให้เทสยืนยัน
 * *สาเหตุ* ไม่ใช่คำแปล — ประโยคเปลี่ยนได้ สาเหตุเปลี่ยนไม่ได้
 */
export function submitState(form: UploadForm, inFlight: boolean): SubmitState {
    if (inFlight) { return { canSubmit: false, reason: 'IN_FLIGHT' }; }
    if (!form.file) { return { canSubmit: false, reason: 'NO_FILE' }; }
    if (form.labName.trim().length < MIN_LAB_NAME_LENGTH) {
        return { canSubmit: false, reason: 'NO_LAB_NAME' };
    }
    return { canSubmit: true, reason: null };
}

/**
 * ป้ายที่ติดกับรายงานแต่ละฉบับ
 *
 * `FARMER_UPLOADED` ต้องบอกตรง ๆ ว่ายังไม่ผ่านการตรวจสอบ — คนอ่านควรรู้ว่ากำลังดู
 * เอกสารที่ใครเป็นคนใส่เข้ามา ไม่ใช่ให้เดาเอง (แบบเดียวกับป้ายบนหน้า verify)
 */
export function reportBadge(report: Pick<LabReport, 'verificationStatus'>): {
    tone: 'neutral' | 'verified';
    labelTH: string;
} {
    return report.verificationStatus === 'OFFICER_VERIFIED'
        ? { tone: 'verified', labelTH: 'เจ้าหน้าที่ตรวจสอบแล้ว' }
        : { tone: 'neutral', labelTH: 'อัปโหลดโดยเกษตรกร — ยังไม่ผ่านการตรวจสอบ' };
}

/** ใหม่สุดก่อน · ฉบับแก้ไขอยู่ข้างฉบับเดิม ไม่ได้แทนที่มัน (มติ 2026-09-05) */
export function orderReports(reports: LabReport[]): LabReport[] {
    return [...(reports || [])].sort(
        (a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime(),
    );
}

/**
 * สามสถานะที่หน้าจอต้องบอกให้ชัด — "อ่านไม่ได้" ต้องไม่หน้าตาเหมือน "ยังไม่มี"
 * (หลักข้อ 4 ของ tnt-data-scope.md)
 */
export type ListState =
    | { kind: 'loading' }
    | { kind: 'unreadable' }
    | { kind: 'empty' }
    | { kind: 'ready'; reports: LabReport[] };

export function listState(args: {
    loading: boolean; error: boolean; reports: LabReport[] | null;
}): ListState {
    if (args.loading) { return { kind: 'loading' }; }
    if (args.error || args.reports === null) { return { kind: 'unreadable' }; }
    if (args.reports.length === 0) { return { kind: 'empty' }; }
    return { kind: 'ready', reports: orderReports(args.reports) };
}
