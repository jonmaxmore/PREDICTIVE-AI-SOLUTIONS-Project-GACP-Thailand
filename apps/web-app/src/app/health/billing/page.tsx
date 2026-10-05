import type { Metadata } from 'next';
import ClientView from './client-view';

export const metadata: Metadata = {
    title: 'สรุปยอดลูกค้า (Customer Statement) | GACP',
    description: 'สรุปยอดลูกหนี้และการชำระเงินตามคำขอ GACP ของฉัน',
};

/**
 * Customer Statement page (สรุปยอดลูกค้า) — B20-D, 2026-05-16.
 *
 * Server Component wrapper for metadata + the Client island.
 * The applicant lands here to see a consolidated view of every
 * application they own, every invoice + payment, totals per side
 * (DTAM state fee vs PLATFORM service fee), and document history.
 */
export default function BillingPage() {
    return (
        <main className="h-full min-h-screen w-full bg-slate-50">
            <ClientView />
        </main>
    );
}
