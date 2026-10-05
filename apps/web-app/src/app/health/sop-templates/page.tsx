import ClientView from './client-view';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'แม่แบบ SOP | GACP',
  description: 'แม่แบบ SOP มาตรฐานสำหรับการปลูก เก็บเกี่ยว และตรวจสอบคุณภาพ',
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
