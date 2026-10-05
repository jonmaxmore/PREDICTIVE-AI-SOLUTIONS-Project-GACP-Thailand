import ClientView from './client-view';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'แบบสำรวจ | GACP',
  description: 'แบบสำรวจความต้องการเกษตรกรผู้ปลูกสมุนไพร (ระบบสำรวจความต้องการ THRSP)',
};

/**
 * Server Component wrapper — สัญญา C05F680149 ต้นแบบที่ 2
 * "ต้นแบบระบบสำรวจความต้องการ" (แบบสอบถามดิจิทัล 4 ภาค)
 */
export default function Page() {
  return (
    <main className="h-full min-h-screen w-full">
      <ClientView />
    </main>
  );
}
