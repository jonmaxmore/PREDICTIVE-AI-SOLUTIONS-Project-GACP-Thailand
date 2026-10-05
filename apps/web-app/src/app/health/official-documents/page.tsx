import ClientView from './client-view';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'เอกสารทางการ | GACP',
  description: 'เอกสารทางการที่เกี่ยวข้องกับการรับรอง GACP',
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
