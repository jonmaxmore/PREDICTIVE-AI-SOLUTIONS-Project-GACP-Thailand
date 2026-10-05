import ClientView from './client-view';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'ตัดสินให้การรับรอง | GACP Platform',
  description: 'คำขอที่ผ่านการตรวจประเมินแล้ว รอการตัดสินให้การรับรอง',
};

/**
 * หน้าของผู้อนุมัติใบรับรอง (ISO/IEC 17065 §7.6 · F-CERT-SOD 2026-09-10)
 *
 * ทำไมต้องมีหน้าของตัวเอง แทนที่จะยืมหน้า /provider/audits ที่มีแท็บ "อนุมัติ" อยู่แล้ว:
 * หน้านั้นโหลด /api/provider/auditor/dashboard ซึ่งบังคับสิทธิ์ APPLICATION_AUDIT_RECORD —
 * สิทธิ์ที่ผู้อนุมัติ **ตั้งใจ** ไม่มี (ถ้ามี การถือสองบทบาทจะแปลว่าทำงานตัวเองครบวงจร)
 * ⇒ ผู้อนุมัติที่เข้าหน้านั้นจะเจอ error ทันทีทั้งที่ทุกอย่างทำงานถูกต้อง
 */
export default function Page() {
  return (
    <main className="h-full min-h-screen w-full">
      <ClientView />
    </main>
  );
}
