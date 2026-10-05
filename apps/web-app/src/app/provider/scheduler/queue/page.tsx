import { SERVICE_NAME } from '@/lib/pricing/fee-services';
import type { Metadata } from 'next';
import SchedulerQueueClient from './client-view';

/**
 * /provider/scheduler/queue — Iter 25 step 2.
 *
 * Government staff (DTAM scheduler role) opens this page to see all
 * applications that have paid the audit fee and are awaiting
 * auditor assignment. The client view does the heavy lifting; this
 * server wrapper just contributes route metadata so Next can
 * pre-render the head.
 */

export const metadata: Metadata = {
    title: 'คิวจัดตารางตรวจฟาร์ม | GACP Platform',
    description:
        `รายการคำขอที่ชำระงวดที่ 2 หรือ${SERVICE_NAME.RENEWAL}แล้ว และรอจัดตารางผู้ตรวจประเมินภาคสนาม`,
};

export default function SchedulerQueuePage() {
    return (
        <main className="min-h-screen bg-slate-50">
            <div className="mx-auto w-full max-w-7xl space-y-4 px-4 py-6 md:px-6 lg:px-8">
                <SchedulerQueueClient />
            </div>
        </main>
    );
}
