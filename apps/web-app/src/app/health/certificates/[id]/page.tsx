import { Metadata } from 'next';
import ClientView from './client-view';

export const metadata: Metadata = {
    title: 'รายละเอียดใบรับรอง | GACP',
    description:
        'รายละเอียดใบรับรอง GACP ดาวน์โหลด PDF, แชร์ลิงก์ตรวจสอบ และ QR สำหรับสาธารณะ',
};

/**
 * Server Component shell for /health/certificates/[id]. The actual
 * fetching + interactivity lives in the Client island below so we
 * don't ship the full QR + clipboard JS to crawlers / static metadata.
 */
export default async function CertificateDetailPage({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    const { id } = await params;
    return (
        <main className="h-full min-h-screen w-full">
            <ClientView id={id} />
        </main>
    );
}
