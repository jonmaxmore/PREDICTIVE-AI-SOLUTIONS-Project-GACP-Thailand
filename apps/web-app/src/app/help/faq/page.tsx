import type { Metadata } from 'next';
import { th } from '@/lib/i18n/dictionaries/th';
import FaqClient from './faq-client';

// Metadata is resolved on the server, where the visitor's language
// preference (held in localStorage) is not yet known, so it stays Thai.
// Sourcing the title from the dictionary keeps it from drifting away
// from the heading the client renders.
export const metadata: Metadata = {
    title: th.health.help.faq.metaTitle,
    description:
        'คำถามที่พบบ่อย จัดหมวดตามหัวข้อ: การสมัคร การชำระเงิน การตรวจฟาร์ม ใบรับรอง การคืนเงิน และ PDPA',
};

export default function FaqPage() {
    return (
        <main className="min-h-screen w-full bg-slate-50 px-4 py-8 md:px-8 md:py-10">
            <div className="mx-auto max-w-4xl space-y-6">
                <FaqClient />
            </div>
        </main>
    );
}
