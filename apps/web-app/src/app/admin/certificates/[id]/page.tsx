import type { Metadata } from 'next';
import DetailView from './detail-view';

/**
 * /admin/certificates/[id] — Cross-tenant certificate detail page for
 * ADMIN staff. R7-A deliverable: surfaces
 * `GET /api/certificates/:id` (apps/backend/routes/api/certificates/
 * certificates.js — the provider-role branch) so the list page at
 * /admin/certificates can drill into individual rows.
 *
 * Closes the R3 Phase F gap where the list page's "ดูรายละเอียด"
 * affordance was disabled to avoid a 404; R7-A reinstates it as a
 * functional Link in client-view.tsx.
 *
 * The page itself is a thin Server Component that exports route
 * metadata and renders the Client island below — same shape as
 * /admin/certificates/page.tsx and the rest of the admin shell.
 */
export const metadata: Metadata = {
    title: 'Certificate Detail | GACP Admin',
    description:
        'รายละเอียดใบรับรอง GACP สำหรับผู้ดูแลระบบ เลขที่ใบรับรอง สถานะ วันที่ออก/หมดอายุ และข้อมูลฟาร์ม',
};

export default function Page() {
    return (
        <main className="h-full min-h-screen w-full">
            <DetailView />
        </main>
    );
}
