import ClientView from './client-view';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'การชำระเงิน | GACP',
  description: 'การชำระเงินและใบแจ้งหนี้สำหรับคำขอ GACP',
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
