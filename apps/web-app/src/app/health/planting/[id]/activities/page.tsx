import ClientView from './client-view';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'กิจกรรมการปลูก | GACP',
  description: 'กิจกรรมในรอบการปลูก ปลูก ใส่ปุ๋ย เก็บเกี่ยว',
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
