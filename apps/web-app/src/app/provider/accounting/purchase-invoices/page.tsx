import type { Metadata } from 'next';
import ClientView from './client-view';

/**
 * Purchase Invoices page — /provider/accounting/purchase-invoices.
 *
 * Backend: apps/backend/services/purchase-invoice-service.js (Iter 26).
 * Routes:  apps/backend/routes/api/finance/purchase-invoices.js
 *
 * Roles allowed:
 *   - ACCOUNT_PLATFORM (read + write)
 *   - ADMIN            (read + write)
 *   - AUDITOR          (read-only — backend enforces write block)
 * Role gating is rendered as Thai callouts inside ClientView.
 *
 * Not in scope: PDF rendering or attachment-upload UI (RFC §"Out of
 * scope"). The create form accepts a pasted attachmentId but does
 * not embed an uploader.
 */
export const metadata: Metadata = {
    title: 'ใบกำกับภาษีซื้อ | GACP Provider',
    description:
        'จัดการใบกำกับภาษีซื้อ (Input VAT) สำหรับรายงาน ภ.พ.30 ตามมาตรฐาน ป.รัษฎากร ม.82/3 + ม.86/4 บันทึก / อนุมัติ / ปฏิเสธ / บันทึกชำระเงิน',
};

export default function Page() {
    return (
        <main className="h-full min-h-screen w-full">
            <ClientView />
        </main>
    );
}
