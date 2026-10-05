import ClientView from './client-view';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'บันทึกการอบรม | GACP',
  description: 'บันทึกการอบรม GACP ของผู้ปฏิบัติงาน ใช้ประกอบคำขอรับรอง',
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
