import type { Metadata } from 'next';
import InspectClient from './client-view';

/**
 * /provider/audits/[id]/inspect — Iter 25 step 4.
 *
 * Auditor field-app. Mobile-first. Five screens:
 *   1) Start (GPS check-in)
 *   2) Checklist (GACP criteria + photo upload)
 *   3) Photo capture modal (uses the native camera intent)
 *   4) Review (summary + map preview)
 *   5) Decision (PASS / FAIL / NEEDS_REVIEW)
 *
 * The wrapper is a thin server component; all interactivity lives in
 * the client island below.
 */

export const metadata: Metadata = {
    title: 'ตรวจประเมินภาคสนาม | GACP',
    description: 'แอปภาคสนามสำหรับผู้ตรวจประเมิน GACP',
};

interface PageProps {
    params: Promise<{ id: string }>;
}

export default async function Page({ params }: PageProps) {
    const { id } = await params;
    return (
        <main className="min-h-screen bg-slate-50">
            <InspectClient applicationId={id} />
        </main>
    );
}
