import type { Metadata } from 'next';

import ClientView from './client-view';

export const metadata: Metadata = {
    title: 'ตรวจเอกสารตาม กทล.1 | GACP Platform',
    description: 'เจ้าหน้าที่ตรวจเอกสารประกอบคำขอทีละรายการตามแบบ กทล.1 ส่วนสำหรับเจ้าหน้าที่',
};

/**
 * Server Component wrapper — route metadata at build time, the officer's
 * checklist below as a Client island (the same shape every /provider page uses).
 */
export default function Page() {
    return (
        <main className="h-full min-h-screen w-full bg-mint-bg">
            <ClientView />
        </main>
    );
}
