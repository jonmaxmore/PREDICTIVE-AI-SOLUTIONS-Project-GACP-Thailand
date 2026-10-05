import ClientView from './client-view';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'รายงาน | GACP',
  description: 'รายงานรายเดือน (ภ.ท.27 / ภ.ท.28 / ภ.ท.29-32) สำหรับผู้ได้รับใบรับรอง',
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
