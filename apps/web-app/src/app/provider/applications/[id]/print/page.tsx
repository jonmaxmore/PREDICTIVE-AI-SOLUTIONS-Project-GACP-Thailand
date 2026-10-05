import ClientView from './client-view';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'พิมพ์คำขอ | GACP Platform',
  description: 'พิมพ์เอกสารคำขอ GACP สำหรับเจ้าหน้าที่',
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
