import type { Metadata } from 'next';

import ClientView from './client-view';

export const metadata: Metadata = {
  title: 'ป้ายรหัสแปลง | GACP',
  description: 'พิมพ์ป้ายรหัสแปลงพร้อม QR สำหรับติดที่แปลงปลูก',
};

/**
 * Server wrapper for the printable plot signs. The sheet is its own route rather than a
 * section of the cycle page because the browser prints the whole document: tabs, modals and
 * the dashboard shell would all land on the paper, and a sign needs one plot per page with
 * nothing else on it.
 */
export default function Page() {
  return (
    <main className="h-full min-h-screen w-full">
      <ClientView />
    </main>
  );
}
