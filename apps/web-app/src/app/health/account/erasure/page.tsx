import type { Metadata } from 'next';
import ClientView from './client-view';

/**
 * /health/account/erasure — R4-D 2-step PDPA ม.32 erasure UI.
 *
 * Thin Server Component shell that exports route metadata and hands
 * off to the Client island below. Mirrors the page-pattern used by
 * /admin/certificates/page.tsx and the rest of the R3 wave.
 *
 * The legacy single-step delete UI at /health/profile/privacy stays
 * in service this iter — R4 scope decision (see iter-R4 RFC) — and
 * the privacy page now links here as the recommended path.
 */
export const metadata: Metadata = {
    title: 'ลบบัญชี (PDPA ม.32) | GACP Health',
    description:
        'จัดการคำขอลบบัญชีของท่านตามพระราชบัญญัติคุ้มครองข้อมูลส่วนบุคคล (PDPA ม.32) ผ่านขั้นตอนยืนยันด้วยลิงก์ในการแจ้งเตือนของระบบ',
};

export default function Page() {
    // B1 (audit 2026-06-10): DashboardLayout already provides the page <main>, so
    // this inner <main> was invalid landmark nesting. Swap to <div>; the max-w-2xl
    // width is INTENTIONALLY kept — a focused PDPA ม.32 erasure flow reads best as a
    // narrow single column (per the container-width standard's prose/focused rule).
    return (
        <div className="w-full space-y-6 p-4 pb-20 md:p-6 md:pb-6">
            <ClientView />
        </div>
    );
}
