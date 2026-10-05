import ClientView from './client-view';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'กำลังเข้าสู่ระบบ | GACP Platform',
  description: 'ยืนยันตัวตนผ่านระบบยืนยันตัวตนกลาง',
};

/**
 * OAuth callback landing page — BORA redirects the browser here after the
 * ThaID consent screen (`AUTH_THAID_REDIRECT_URI=.../auth/callback/thaid`).
 * Before this file existed, that redirect landed on a bare 404 (audit
 * finding, design note 2026-08-19-thaid-sandbox-readiness-design
 * §"Also in scope"). Server Component wrapper — exports route metadata at
 * build-time and renders the Client island below, matching the house split
 * used by every other dynamic-segment page under app/auth and app/health
 * (e.g. health/documents/[id]/page.tsx).
 */
export default function Page() {
  return (
    <main className="h-full min-h-screen w-full">
      <ClientView />
    </main>
  );
}
