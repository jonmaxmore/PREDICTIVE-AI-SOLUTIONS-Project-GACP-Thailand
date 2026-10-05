import ClientView from './client-view';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'หน้าหลัก | GACP',
  description: 'ศูนย์กลางการดำเนินการของคุณ',
};

/**
 * Server Component wrapper — exports route metadata at build-time
 * and renders the Client island below. app/health/layout.tsx already
 * wraps every /health/* route in DashboardLayout, so auth/nav chrome
 * comes for free here (same pattern as /health/certificates).
 */
export default function Page() {
  return (
    <main className="h-full min-h-screen w-full">
      <ClientView />
    </main>
  );
}
