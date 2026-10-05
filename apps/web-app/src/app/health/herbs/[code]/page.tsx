import ClientView from './client-view';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'องค์ความรู้สมุนไพร | GACP',
  description: 'องค์ความรู้สมุนไพรไทยรายชนิด (THRSP)',
};

/** สัญญา C05F680149 ต้นแบบที่ 5 — องค์ความรู้รายชนิด (มุมมองเกษตรกร). */
export default function Page() {
  return (
    <main className="h-full min-h-screen w-full">
      <ClientView />
    </main>
  );
}
