import type { Metadata } from 'next';
import OnboardingClient from './onboarding-client';

export const metadata: Metadata = {
    title: 'เริ่มต้นใช้งาน | GACP',
    description:
        'แนะนำการใช้งานระบบ GACP สำหรับผู้สมัครครั้งแรก 5 ขั้นสั้น ๆ ครอบคลุมตั้งแต่การสมัครจนถึงการต่ออายุใบรับรอง',
};

export default function OnboardingPage() {
    return (
        <main className="min-h-screen w-full bg-slate-50">
            <OnboardingClient />
        </main>
    );
}
