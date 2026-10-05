import ClientView from './client-view';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'หน้าหลัก | GACP Provider',
  description: 'เลือกเมนูที่คุณต้องการใช้งาน',
};

/**
 * Server Component wrapper — exports route metadata at build-time and
 * renders the Client island below. Same pattern as /health/home/page.tsx;
 * unlike /health/*, /provider/* has no route-level layout.tsx supplying
 * chrome, so ClientView itself wraps its content in ProviderLayout.
 */
export default function Page() {
  return (
    <main className="h-full min-h-screen w-full">
      <ClientView />
    </main>
  );
}
