import ClientView from './client-view';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'ตั้งค่าบัญชี | GACP',
  description: 'ตั้งค่าบัญชีผู้ขอรับรอง GACP',
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
