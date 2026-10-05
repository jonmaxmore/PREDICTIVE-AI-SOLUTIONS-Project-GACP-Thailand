import { Metadata } from 'next';
import ClientView from './client-view';

/**
 * Finance Dashboard — accounting reports for PLATFORM-side
 * finance staff (and ADMIN/AUDITOR for visibility). The page
 * exposes the five standard reports a Thai SME under TFRS for
 * NPAEs needs:
 *
 *   1. งบทดลอง — Trial Balance
 *   2. งบกำไรขาดทุน — Profit & Loss
 *   3. งบดุล — Balance Sheet
 *   4. สมุดบัญชีแยกประเภท — General Ledger
 *   5. รายงานภาษีขาย — Output VAT (ภ.พ.30)
 *
 * ACCOUNT_DTAM is intentionally NOT in scope — DTAM books live
 * in กรมบัญชีกลาง's own system. DTAM users hitting this URL
 * are shown a Thai "ไม่มีสิทธิ์เข้าถึง" message inside the
 * client view.
 */
export const metadata: Metadata = {
    title: 'รายงานบัญชี | GACP Provider',
    description:
        'รายงานบัญชีมาตรฐานสำหรับเจ้าหน้าที่การเงินฝั่งแพลตฟอร์ม งบทดลอง, งบกำไรขาดทุน, งบดุล, สมุดบัญชีแยกประเภท, รายงานภาษีขาย (ภ.พ.30)',
};

export default function Page() {
    return (
        <main className="h-full min-h-screen w-full">
            <ClientView />
        </main>
    );
}
