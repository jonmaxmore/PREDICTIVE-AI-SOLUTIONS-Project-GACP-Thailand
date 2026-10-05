/**
 * What the booking door says about whether the visit can lead to a certificate.
 *
 * POST /api/provider/scheduler/audits/schedules answers every booking with
 * `canLeadToCertificate` and `evidenceNote` (backend services/audit/arm-onsite-evidence.js):
 * a visit held online arms no evidence chain, so no certificate can come from it. No web code
 * read either key, so a dispatcher could book such a visit and never be told.
 */

export interface ScheduleAnswer {
    canLeadToCertificate?: boolean;
    evidenceNote?: string | null;
}

/** Shown while the online option is selected, before anything is saved. */
export const ONLINE_MEET_WARNING_TH =
    'การตรวจออนไลน์ไม่สร้างหลักฐานการลงพื้นที่ จึงออกใบรับรองจากการตรวจครั้งนี้ไม่ได้ หากต้องการให้ออกใบรับรอง ให้นัดตรวจที่ฟาร์ม';

/**
 * The sentence to keep on screen after a save, or null when the visit can lead to a
 * certificate. The backend's own note wins; the fixed sentence is only the fallback for an
 * answer that says "no" without saying why.
 */
export function evidenceWarningFrom(
    answer: ScheduleAnswer | null | undefined,
    applicationNumber: string,
): string | null {
    if (!answer || answer.canLeadToCertificate !== false) {
        return null;
    }
    const note = typeof answer.evidenceNote === 'string' ? answer.evidenceNote.trim() : '';
    return `คำขอ ${applicationNumber}: ${note || ONLINE_MEET_WARNING_TH}`;
}
