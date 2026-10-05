import ClientView from './client-view';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'แก้ไขรอบปลูก | GACP',
  description: 'แก้ไขข้อมูลรอบปลูก — แก้ได้จนถึงวันเก็บเกี่ยว',
};

export default function Page() {
  return (
    <main className="h-full min-h-screen w-full">
      <ClientView />
    </main>
  );
}
