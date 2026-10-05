import ClientView from './client-view';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'สร้าง SOP | GACP',
  description: 'กรอกฟอร์ม SOP รายแปลง บันทึกเป็น PDF เพื่อแนบใบสมัคร',
};

/**
 * Server Component wrapper — exports route metadata at build-time
 * and renders the Client island below.
 */
export default function Page() {
  return (
    <main className="h-full min-h-screen w-full">
      <ClientView />
    </main>
  );
}
