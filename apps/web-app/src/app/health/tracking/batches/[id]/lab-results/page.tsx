import ClientView from './client-view';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'ผลวิเคราะห์ของรุ่นเก็บเกี่ยว | GACP',
  description: 'แนบใบรายงานผลวิเคราะห์ (COA) ของรุ่นเก็บเกี่ยว',
};

/**
 * Server Component wrapper — route metadata at build time, the client island below.
 */
export default function Page() {
  return (
    <main className="h-full min-h-screen w-full">
      <ClientView />
    </main>
  );
}
