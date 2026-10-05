import ClientView from './client-view';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'การวิเคราะห์พื้นที่ | GACP',
  description: 'บันทึกผลการวิเคราะห์ดิน น้ำ และสภาพแวดล้อมของแปลงปลูก',
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
