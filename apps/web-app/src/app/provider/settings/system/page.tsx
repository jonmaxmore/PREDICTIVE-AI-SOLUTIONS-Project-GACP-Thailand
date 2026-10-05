import ClientView from './client-view';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'ตั้งค่าระบบ | GACP Platform',
  description: 'ตั้งค่าระบบ GACP feature flags และค่าตั้งค่าระดับระบบ',
};

/**
 * Server Component wrapper — exports route metadata at build-time
 * and renders the Client island below.
 */
export default function Page() {
  // <div>, not <main> — DashboardLayout already renders the single <main>
  // landmark; nesting another is invalid landmark nesting (same fix as
  // account/erasure + profile/notifications).
  return (
    <div className="h-full w-full">
      <ClientView />
    </div>
  );
}
