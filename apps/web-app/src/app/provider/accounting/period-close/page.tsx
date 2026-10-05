import type { Metadata } from 'next';
import ClientView from './client-view';

/**
 * Period Close — รายการปิดงวดบัญชีรายเดือน (Iter R1, 2026-05-17).
 *
 * PLATFORM-side finance staff close each calendar month after it has
 * fully elapsed, sealing the trial-balance + ภ.พ.30 for that period.
 * ADMIN can reopen a CLOSED period (separation-of-duties: the
 * reopener MUST differ from the original closer — enforced server
 * side). DTAM staff see the amber "ไม่มีสิทธิ์เข้าถึง" callout because
 * the DTAM books live in กรมบัญชีกลาง's own system.
 *
 * Compliance:
 *   - TFRS for NPAEs ch.5 — period close
 *   - TFRS for NPAEs ch.2 — segregation of duties (close vs reopen)
 *   - ป.รัษฎากร ม.86/4   — VAT period closure aligns with ภ.พ.30
 */
export const metadata: Metadata = {
    title: 'ปิดงวดบัญชีรายเดือน | GACP Provider',
    description:
        'ปิด/เปิดงวดบัญชีรายเดือนสำหรับเจ้าหน้าที่การเงินฝั่งแพลตฟอร์ม รองรับการแยกหน้าที่ (ผู้ปิดงวด ≠ ผู้เปิดงวด) ตาม TFRS for NPAEs ch.2',
};

export default function Page() {
    return (
        <main className="h-full min-h-screen w-full">
            <ClientView />
        </main>
    );
}
