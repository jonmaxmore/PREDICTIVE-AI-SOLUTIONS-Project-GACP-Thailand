import { Metadata } from 'next';

import ClientView from './client-view';

export const metadata: Metadata = {
  title: 'ติดตามการปลูก | GACP Provider',
  description: 'รายการรอบการปลูกของฟาร์มทุกแห่งทั่วประเทศ สำหรับงานติดตามและตรวจสอบย้อนกลับ',
};

export default function Page() {
  return (
    <main className="h-full min-h-screen w-full">
      <ClientView />
    </main>
  );
}
