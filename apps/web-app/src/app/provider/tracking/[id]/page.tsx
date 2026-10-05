import { Metadata } from 'next';

import ClientView from './client-view';

export const metadata: Metadata = {
  title: 'รายละเอียดรอบการปลูก | GACP Provider',
  description: 'รายละเอียดรอบการปลูก บันทึกกิจกรรม และ QR ประจำแปลง สำหรับงานติดตาม',
};

export default function Page() {
  return (
    <main className="h-full min-h-screen w-full">
      <ClientView />
    </main>
  );
}
