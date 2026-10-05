import ClientView from './client-view';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'ผู้ตรวจเอกสาร | GACP Platform',
  description: 'ผู้ตรวจเอกสาร คิวงานตรวจเอกสารและการกำกับ SLA GACP',
};

/**
 * Server Component wrapper — exports route metadata at build-time and
 * renders the DOCUMENT_REVIEWER launchpad Client island below (B5: the
 * reviewer gets its own dedicated landing route, separate from the shared
 * /provider/dashboard).
 */
export default function Page() {
  return (
    <main className="h-full min-h-screen w-full">
      <ClientView />
    </main>
  );
}
