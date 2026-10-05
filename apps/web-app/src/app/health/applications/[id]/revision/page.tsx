import type { Metadata } from 'next';

import ClientView from './client-view';

export const metadata: Metadata = {
    title: 'แก้ไขเอกสารตามที่เจ้าหน้าที่ขอ | GACP Platform',
    description: 'อัปโหลดเฉพาะเอกสารที่เจ้าหน้าที่ขอเพิ่ม แล้วส่งคำขอกลับให้ตรวจ',
};

export default function Page() {
    return (
        <main className="h-full min-h-screen w-full bg-mint-bg">
            <ClientView />
        </main>
    );
}
