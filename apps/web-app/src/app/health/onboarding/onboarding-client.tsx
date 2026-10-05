'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { OnboardingModal, buildOnboardingSteps } from '@/components/onboarding/OnboardingModal';
import { usePricing } from '@/hooks/use-pricing';

/**
 * OnboardingClient — first-run welcome flow.
 *
 * Renders a context background with summary + a modal that walks new
 * applicants through 5 onboarding steps. On Skip we keep them on this
 * page (in case they want to read the summary first). On Complete we
 * route to the dashboard so the user starts the real work.
 */
export default function OnboardingClient() {
    const router = useRouter();
    const [modalOpen, setModalOpen] = React.useState(true);
    // One pricing request for the page: the summary and the modal share the
    // tour built from the served fees.
    const { state } = usePricing();
    const steps = React.useMemo(() => buildOnboardingSteps(state), [state]);

    const handleComplete = React.useCallback(() => {
        setModalOpen(false);
        try {
            router.push('/health/home');
        } catch {
            // router unavailable in test mode — no-op
        }
    }, [router]);

    const handleSkip = React.useCallback(() => {
        setModalOpen(false);
    }, []);

    return (
        <div className="w-full space-y-6 px-4 py-8 md:px-8">
            <header>
                <p className="text-xs font-bold text-leaf-700">
                    เริ่มต้นใช้งาน · GACP THAILAND
                </p>
                <h1 className="mt-2 text-2xl font-bold text-slate-900 md:text-3xl">
                    ยินดีต้อนรับสู่ระบบรับรองมาตรฐาน GACP
                </h1>
                <p className="mt-1 text-sm text-slate-600">
                    ก่อนเริ่มใช้งาน เราขอแนะนำขั้นตอนหลักให้คุณรู้จัก 5 หัวข้อ
                </p>
            </header>

            <section
                aria-labelledby="steps-overview-heading"
                className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm md:p-6"
            >
                <h2 id="steps-overview-heading" className="text-sm font-bold text-slate-700">
                    สรุปสิ่งที่จะเรียนรู้
                </h2>
                <ol className="mt-3 space-y-3 text-sm text-slate-700">
                    {steps.map((step, idx) => (
                        <li key={idx} className="flex gap-3">
                            <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-leaf-soft text-xs font-bold text-leaf-onSoft">
                                {idx + 1}
                            </span>
                            <div className="min-w-0 flex-1">
                                <p className="font-semibold text-slate-900">{step.title}</p>
                                <p className="mt-0.5 text-xs text-slate-500">{step.description}</p>
                            </div>
                        </li>
                    ))}
                </ol>

                <div className="mt-5 flex flex-wrap gap-2">
                    <button
                        type="button"
                        onClick={() => setModalOpen(true)}
                        className="inline-flex h-10 items-center justify-center rounded-lg bg-leaf-700 px-4 text-sm font-semibold text-white shadow-sm hover:bg-leaf-800"
                    >
                        เริ่มดูคำแนะนำ
                    </button>
                    <Link
                        href="/health/home"
                        className="inline-flex h-10 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                    >
                        ข้ามไปยังหน้าหลัก
                    </Link>
                    <Link
                        href="/help"
                        className="inline-flex h-10 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                    >
                        ศูนย์ช่วยเหลือ
                    </Link>
                </div>
            </section>

            {modalOpen ? (
                <OnboardingModal
                    open={modalOpen}
                    steps={steps}
                    onComplete={handleComplete}
                    onSkip={handleSkip}
                />
            ) : null}
        </div>
    );
}
