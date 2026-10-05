import ClientView from './client-view';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'การแจ้งเตือน | GACP Provider',
  description: 'การแจ้งเตือนงานและการดำเนินการของเจ้าหน้าที่',
};

/**
 * P0-C — staff notifications page.
 *
 * The topbar bell (dashboard-layout.tsx) routes every provider role to
 * /provider/notifications; this route did not exist, so clicking the bell
 * (which shows a REAL unread badge from GET /notifications) 404'd for all
 * staff. Server Component wrapper + Client island, mirroring
 * health/notifications.
 */
export default function Page() {
  return (
    <main className="h-full min-h-screen w-full">
      <ClientView />
    </main>
  );
}
