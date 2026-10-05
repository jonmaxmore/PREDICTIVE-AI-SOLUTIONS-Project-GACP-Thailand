import ClientView from './client-view';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'เริ่มต้น | GACP',
  description: 'เริ่มต้นคำขอรับรอง GACP',
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
