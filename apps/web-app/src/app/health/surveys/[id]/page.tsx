import ClientView from './client-view';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'ตอบแบบสำรวจ | GACP',
  description: 'ตอบแบบสำรวจความต้องการเกษตรกร (ระบบสำรวจความต้องการ THRSP)',
};

/** Server Component wrapper — ฟอร์มตอบแบบสำรวจ (ต้นแบบที่ 2). */
export default function Page() {
  return (
    <main className="h-full min-h-screen w-full">
      <ClientView />
    </main>
  );
}
