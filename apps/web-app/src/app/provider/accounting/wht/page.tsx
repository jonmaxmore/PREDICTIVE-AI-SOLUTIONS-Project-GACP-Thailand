import type { Metadata } from 'next';
import ClientView from './client-view';

/**
 * WHT Certificate page — record ทบ.50 ทวิ from corporate buyers + probe
 * whether WHT is applicable for a given invoice.
 *
 * IMPORTANT — this UI is intentionally limited to RECORD + LIST + PROBE.
 * The backend wht-service is an intentional STUB; the platform does NOT
 * auto-withhold 3% at point of sale and does NOT emit ภ.ง.ด.53. See
 * apps/backend/services/wht-service.js lines 30-86 for the legal /
 * operational rationale (owner directive: "ถ้าหัก 3% แล้วเสี่ยงผิดกฎหมาย
 * หรือเราไม่ได้นำส่ง เอาออกก็ได้").
 *
 * Roles (READ_ROLES from the backend service):
 *   - ACCOUNT_PLATFORM, ADMIN  → full access (record + view)
 *   - ACCOUNT (legacy), AUDITOR → view only
 *   - ACCOUNT_DTAM             → amber "ไม่มีสิทธิ์เข้าถึง" callout
 *   - others                   → rose forbidden callout
 */
export const metadata: Metadata = {
    title: 'WHT (ทบ.50 ทวิ) | GACP Provider',
    description:
        'บันทึกและตรวจสอบหนังสือรับรองการหักภาษี ณ ที่จ่าย (ทบ.50 ทวิ) ที่ผู้ซื้อนิติบุคคลส่งกลับมาให้ฝ่ายการเงินของแพลตฟอร์ม ระบบไม่ได้หัก 3% อัตโนมัติและไม่ได้ออก ภ.ง.ด.53',
};

export default function Page() {
    return (
        <main className="h-full min-h-screen w-full">
            <ClientView />
        </main>
    );
}
