import ClientView from './client-view';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'ล็อตบรรจุภัณฑ์ | GACP',
  description: 'ล็อตบรรจุภัณฑ์และ QR Code สำหรับติดตามผลิตภัณฑ์',
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
