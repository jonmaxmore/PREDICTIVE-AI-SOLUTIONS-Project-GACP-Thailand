import type { Metadata } from 'next';
import ClientView from './client-view';

/**
 * /admin/certificates — Cross-tenant certificate roster for ADMIN
 * staff. R3-C deliverable: surfaces the existing
 * `GET /api/certificates/?take=100` route (apps/backend/routes/api/
 * certificates/certificates.js:41-66) as a filterable + CSV-exportable
 * table inside the admin shell.
 *
 * The page itself is a thin Server Component that exports route
 * metadata and renders the Client island below — same shape as every
 * other R1 / R2 admin page (e.g. /provider/accounting/wht/page.tsx).
 */
export const metadata: Metadata = {
    title: 'Certificates | GACP Admin',
    description:
        'รายการใบรับรอง GACP ทั้งระบบสำหรับผู้ดูแลระบบ กรองตามสถานะ (ACTIVE / EXPIRED / REVOKED) และดาวน์โหลด CSV',
};

export default function Page() {
    return (
        <main className="h-full min-h-screen w-full">
            <ClientView />
        </main>
    );
}
