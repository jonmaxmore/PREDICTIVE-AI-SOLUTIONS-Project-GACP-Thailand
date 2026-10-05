import ClientView from './client-view';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'ฐานข้อมูลสมุนไพร | GACP',
  description: 'ฐานข้อมูลองค์ความรู้สมุนไพรไทย 6 ชนิด (THRSP)',
};

/** สัญญา C05F680149 ต้นแบบที่ 5 — ฐานข้อมูลสมุนไพรไทย (มุมมองเกษตรกร). */
export default function Page() {
  return (
    <main className="h-full min-h-screen w-full">
      <ClientView />
    </main>
  );
}
