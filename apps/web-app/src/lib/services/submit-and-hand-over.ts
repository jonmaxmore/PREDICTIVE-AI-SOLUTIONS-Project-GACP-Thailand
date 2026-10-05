/**
 * ยื่นคำขอ แล้วส่งต่อไปยังหน้าที่ถือใบเสนอราคาและประตูจ่ายเงิน — มีที่เดียว
 *
 * ก่อนหน้านี้ตรรกะชุดนี้อยู่ในหน้า `/health/applications/preview` ที่เดียว และแผน Task 11
 * ให้หน้ารีวิวขั้นที่ 6 ทำสิ่งเดียวกัน · แผนเขียนไว้ตรง ๆ ว่า "the wiring moves, the behavior
 * must not" — การคัดลอกไปไว้อีกหน้าหนึ่งจะกลายเป็นสองสำเนาที่แยกจากกันในวันแรกที่สายจ่ายเงิน
 * เปลี่ยน จึงย้ายมาที่นี่และให้ทั้งสองหน้าจอเรียกตัวเดียวกัน
 *
 * **โมดูลนี้ไม่ตัดสินใจเรื่องเงินเลย** ใต้ราง checkout มันไม่สร้างเอกสารการเงินอะไรทั้งสิ้น
 * (F-G4-64 วางด่านใบเสนอราคาไว้หน้า /payments/create และคำสั่งซื้อ checkout ถูกสร้างโดย
 * /health/payments หลังผู้ยื่นติ๊กยอมรับ) · ส่วนรางเดิมยังคงพฤติกรรมเดิมทุกตัวอักษร
 * เพราะการปิดมันเป็นการตัดสินใจของ operator ไม่ใช่ของการ refactor
 *
 * คืน "สิ่งที่เกิดขึ้น" ให้ผู้เรียกไปตัดสินใจเรื่อง route กับ error เอง — โมดูลนี้ไม่รู้จัก
 * router และไม่รู้จัก useState จึงทดสอบได้โดยไม่ต้อง mount อะไรเลย
 */
import { apiClient } from '@/lib/api/api-client';
import { isCheckoutUiEnabled } from '@/lib/config/checkout-mode';
import { phase1PaymentRefusalTh, quotationGateRefusalTh } from '@/lib/services/payment-service';
import { submitGateRefusalTh } from '@/lib/services/application-requirements';
import {
    ensureLatestDraftSaved,
    forgetFiledApplication,
    saveCurrentDraftNow,
    submitClockFor,
} from '@/app/health/applications/new/_steps/hooks/use-auto-save';

/**
 * Round 3 — said when the applicant's latest edit could not be saved, so the filing is
 * held back rather than filed with older data. Names what happened and what to do.
 */
export const DRAFT_NOT_SAVED_TH = 'ยังบันทึกการแก้ไขล่าสุดไม่สำเร็จ กรุณาลองอีกครั้ง';

/**
 * Round 5 — said when the server refused the application id itself (already filed, or not
 * found for this user). "Try again" would fail the same way forever; the answers are kept
 * and saved as a draft without that id. It does not say "new": an id-less save lands on the
 * applicant's latest open DRAFT when one exists (the backlog). True for both causes.
 */
/**
 * autosave-lost-reply fix round 2 (3): the server refused twice because another page keeps
 * saving this application. Cause and next action (thai-ui-copy).
 */
export const DRAFT_NOT_LATEST_TH = 'คำขอนี้ถูกบันทึกจากหน้าต่างอื่นด้วย ปิดหน้าต่างอื่นของคำขอนี้ แล้วกดยื่นคำขออีกครั้ง';

const DRAFT_NOT_LATEST = 'DRAFT_NOT_LATEST';

export const DRAFT_DETACHED_TH = 'คำขอนี้แก้ไขต่อไม่ได้แล้ว ระบบจะบันทึกคำตอบของคุณเป็นร่างคำขอ';

export type SubmitOutcome =
    /** ยื่นไม่ผ่านด่าน — ยังไม่ได้ยื่น พูดเป็นภาษาไทย */
    | { kind: 'REFUSED'; message: string }
    /** ยื่นสำเร็จแล้ว แต่ขั้นถัดไปถูกปฏิเสธ — คำขอ *ถูกยื่นแล้ว* ต้องบอกและพาไปที่ที่แก้ได้ */
    | { kind: 'REFUSED_BUT_FILED'; message: string; href: string }
    /** แก้ไขแล้วส่งกลับ — ไม่มีขั้นจ่ายเงิน */
    | { kind: 'RESUBMITTED'; href: string }
    /** ยื่นแล้ว ส่งต่อไปหน้าชำระเงิน */
    | { kind: 'FILED'; href: string };

/** หน้าที่ผู้ยื่นถูกส่งไป ตั้งชื่อไว้ที่เดียว เพื่อให้คำปฏิเสธกับความสำเร็จไม่ชี้คนละที่ */
export function paymentsHrefFor(applicationId: string): string {
    return `/health/payments?app=${applicationId}&phase=1`;
}

export async function submitAndHandOver({
    applicationId,
    isInitialSubmit,
    isResubmit,
    declarationsAccepted,
}: {
    applicationId: string;
    isInitialSubmit: boolean;
    isResubmit: boolean;
    /** ส่งเฉพาะเมื่อผู้ยื่นเพิ่งติ๊กครบจริง — เซิร์ฟเวอร์เป็นคนประทับเวลาเอง */
    declarationsAccepted?: boolean;
}): Promise<SubmitOutcome> {
    const paymentsHref = paymentsHrefFor(applicationId);

    if (isInitialSubmit || isResubmit) {
        // Round 3: the submit carries only the id — the server files what it HOLDS. An edit
        // the wizard has not saved yet (or is holding while the draft loads) would be
        // filed stale, so it is saved first; if it cannot be, nothing is filed.
        const gate = await ensureLatestDraftSaved(applicationId);
        if (gate === 'DETACHED') {
            return { kind: 'REFUSED', message: DRAFT_DETACHED_TH };
        }
        if (gate !== 'SAVED') {
            return { kind: 'REFUSED', message: DRAFT_NOT_SAVED_TH };
        }

        // Fix round 2 (3): name the last save this page made, so the server files only what
        // this page saved. If another tab saved since (409 DRAFT_NOT_LATEST), save this
        // page's answers once and submit once more. Never more than once.
        const submitOnce = () => {
            const body: Record<string, unknown> = { applicationId, ...(submitClockFor(applicationId) ?? {}) };
            // อ้างการยอมรับที่ไม่มีใครให้ไว้ไม่ได้: ส่งคีย์นี้ก็ต่อเมื่อมีคนติ๊กจริงเท่านั้น
            if (declarationsAccepted === true) { body.declarationsAccepted = true; }
            return apiClient.post<{ status?: string }>('/applications/submit', body);
        };
        const notLatest = (r: { errorCode?: string | undefined; code?: string | undefined }) =>
            r.errorCode === DRAFT_NOT_LATEST || r.code === DRAFT_NOT_LATEST;

        let submitResponse = await submitOnce();
        if (!submitResponse.success && notLatest(submitResponse)) {
            const resaved = await saveCurrentDraftNow(applicationId);
            if (resaved === 'DETACHED') { return { kind: 'REFUSED', message: DRAFT_DETACHED_TH }; }
            if (resaved !== 'SAVED') { return { kind: 'REFUSED', message: DRAFT_NOT_SAVED_TH }; }
            submitResponse = await submitOnce();
            if (!submitResponse.success && notLatest(submitResponse)) {
                return { kind: 'REFUSED', message: DRAFT_NOT_LATEST_TH };
            }
        }

        if (!submitResponse.success) {
            // api-client ให้ความสำคัญกับ `.error` ก่อน `.message` โดยตั้งใจ (use-auto-save
            // พึ่ง `.error` ให้เป็นรหัสดิบ) ⇒ ข้อความไทยของ backend ถูกทิ้งไปกับ envelope
            // เหลือรอดแค่ `.meta.messageTh` · ถามคำปฏิเสธด้วย KIND ไม่ใช่ไล่เทียบรหัสทีละตัว
            // เพื่อไม่ให้คำปฏิเสธชนิดที่สามไปโผล่เป็น enum ดิบต่อหน้าเกษตรกรอีก
            const gateCopy = submitGateRefusalTh(
                submitResponse.code || submitResponse.error,
                submitResponse.meta,
            );
            return { kind: 'REFUSED', message: gateCopy || submitResponse.error || 'ไม่สามารถยื่นข้อมูลได้' };
        }

        // Round 5 (a): filed. The wizard lets go of this application (store + IndexedDB),
        // so "ยื่นคำขอใหม่" starts empty instead of saving under a filed id (409 forever).
        // Whatever happens next (payment hand-over, a quotation-gate refusal), it IS filed.
        await forgetFiledApplication(applicationId);

        // เส้นทางแก้ไขจบตรงนี้ — ไม่มีขั้นจ่ายเงิน เพราะงวดที่ 1 จ่ายไปแล้วในรอบเดิม
        if (isResubmit) {
            return { kind: 'RESUBMITTED', href: `/health/applications/${applicationId}` };
        }
    }

    // ใต้ราง checkout หน้านี้ไม่สร้างเอกสารการเงินใด ๆ — ส่งต่อให้หน้าที่ถือใบเสนอราคา
    // ปุ่มยอมรับ และประตูจ่ายเงิน
    if (isCheckoutUiEnabled()) {
        return { kind: 'FILED', href: paymentsHref };
    }

    // รางเดิม (ปิดธง): แถวใบแจ้งหนี้งวดที่ 1 ยังถูกสร้างที่นี่ตามเดิม
    const paymentResponse = await apiClient.post('/payments/create', { applicationId, phase: '1' });
    if (!paymentResponse.success) {
        // สองกรณี ไม่ใช่กรณีเดียว — และความต่างมีเหตุผล:
        //
        //   ด่านใบเสนอราคาปฏิเสธ → คำขอ *ถูกยื่นแล้ว* สิ่งที่ค้างคือปุ่มติ๊กยอมรับ ซึ่งอยู่อีกหน้าหนึ่ง
        //                            จึงบอกเป็นภาษาไทยแล้วพาไปที่นั่น
        //   ล้มด้วยเหตุอื่น        → ไม่รู้ว่าอีกหน้าจะช่วยอะไรได้ การผลักไปที่นั่นคือการพาผู้ใช้
        //                            ออกจากหน้าที่มีข้อความอธิบาย ไปยังหน้าที่ไม่มี · อยู่ที่เดิม
        //
        // (การยุบสองอันนี้เข้าด้วยกันตอนย้ายโค้ดทำให้เทสของหน้า preview แดงทันที ซึ่งเป็นเหตุผล
        //  ที่เทสนั้นมีอยู่)
        const gateCopy = quotationGateRefusalTh(paymentResponse.code || paymentResponse.error);
        if (gateCopy) {
            return { kind: 'REFUSED_BUT_FILED', message: gateCopy, href: paymentsHref };
        }
        return {
            kind: 'REFUSED',
            // A fail-closed refusal (QUOTATION_GATE_UNAVAILABLE) names its cause and
            // asks for a retry here; everything else keeps the message it had.
            message: phase1PaymentRefusalTh(paymentResponse.code)
                || paymentResponse.error
                || 'ไม่สามารถสร้างรายการชำระเงินได้ กรุณาลองใหม่อีกครั้ง',
        };
    }

    return { kind: 'FILED', href: paymentsHref };
}
