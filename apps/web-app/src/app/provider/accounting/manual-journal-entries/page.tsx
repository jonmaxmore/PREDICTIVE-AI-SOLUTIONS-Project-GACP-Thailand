import { Metadata } from 'next';
import ClientView from './client-view';

/**
 * Manual Journal Entry page — R1-C, 2026-05-17.
 *
 * Hosts the draft → approval → post workflow for entries that are NOT
 * driven by an automatic settlement (bank charges, FX gain/loss, accrual
 * reversals, manual corrections after appropriate approval). The
 * canonical state machine + segregation-of-duties rules are enforced
 * server-side by manual-journal-entry-service.js; this page only
 * surfaces the wire actions and propagates Thai error messages.
 *
 * ACCOUNT_DTAM is intentionally NOT in scope — DTAM books live in the
 * กรมบัญชีกลาง system. The client view shows a Thai "ไม่มีสิทธิ์เข้าถึง"
 * message for DTAM users that hit this URL.
 */
export const metadata: Metadata = {
    title: 'ใบสำคัญทั่วไป (Manual Journal Entry) | GACP Provider',
    description:
        'บันทึกรายการบัญชีที่ไม่ผ่านการชำระอัตโนมัติ ค่าธรรมเนียมธนาคาร, FX gain/loss, การแก้ไขปรับปรุง พร้อม workflow draft → approve → post ตามมาตรฐาน TFRS for NPAEs ch.2',
};

export default function Page() {
    return (
        <main className="h-full min-h-screen w-full">
            <ClientView />
        </main>
    );
}
