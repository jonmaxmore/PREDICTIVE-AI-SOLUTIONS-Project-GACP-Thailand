import type { Metadata } from 'next';

import ClientView from './client-view';

export const metadata: Metadata = {
    title: 'บันทึกของผู้ตรวจเกี่ยวกับคำขอของคุณ | GACP Platform',
    description: 'สิทธิเข้าถึงข้อมูลส่วนบุคคลของตนตาม พ.ร.บ.คุ้มครองข้อมูลส่วนบุคคล มาตรา 30',
};

export default function Page() {
    return (
        <main className="h-full min-h-screen w-full bg-mint-bg">
            <ClientView />
        </main>
    );
}
