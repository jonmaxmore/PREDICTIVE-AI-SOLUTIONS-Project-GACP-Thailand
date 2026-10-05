import ClientView from './client-view';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'แฟ้มคำขอรอตัดสิน | GACP Platform',
  description: 'ดูหลักฐานทั้งหมดของคำขอ (อ่านอย่างเดียว) ก่อนตัดสินให้การรับรอง',
};

/**
 * แฟ้มคำขอของผู้อนุมัติใบรับรอง — เส้นทางอยู่ใต้ /provider/certification-decisions จึงใช้กฎเข้าถึงเดียวกับหน้ารายการ
 * (certificate_approver เท่านั้น · lib/provider-role-config.ts) ไม่ต้องเปิดประตู /provider/audits ที่ตั้งใจกันบทบาทนี้ไว้
 */
export default function Page() {
  return (
    <main className="h-full min-h-screen w-full">
      <ClientView />
    </main>
  );
}
