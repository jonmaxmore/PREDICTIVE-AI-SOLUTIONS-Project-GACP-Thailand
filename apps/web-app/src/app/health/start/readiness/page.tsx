import ClientView from './client-view';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'เช็คความพร้อม | GACP',
  description: 'เช็คความพร้อมก่อนยื่นคำขอรับรอง GACP',
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
