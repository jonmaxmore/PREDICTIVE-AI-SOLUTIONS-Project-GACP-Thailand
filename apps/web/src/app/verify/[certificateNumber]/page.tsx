import { messages } from '@/messages/th.ts';

type VerifyPageProps = {
  readonly params: Promise<{ readonly certificateNumber: string }>;
};

// หน้าสาธารณะตรวจสอบใบรับรอง: ใน M0 ยังไม่มีใบรับรองในระบบ จึงตอบตรง ๆ ว่ายังไม่มี
export default async function VerifyCertificatePage({ params }: VerifyPageProps) {
  const { certificateNumber } = await params;
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-3 px-6 py-12">
      <p className="inline-flex w-fit rounded-full bg-leaf-tint px-3 py-1 text-sm font-bold text-leaf">
        {messages.appName}
      </p>
      <h1 className="text-2xl font-bold text-forest-green">{messages.verify.title}</h1>
      <p className="font-mono text-sm text-muted">{certificateNumber}</p>
      <section className="rounded-xl border border-border bg-surface p-5 shadow-card">
        <h2 className="font-bold text-ink">{messages.verify.notIssuedYet}</h2>
        <p className="mt-1 text-sm text-muted">{messages.verify.notIssuedDescription}</p>
      </section>
    </main>
  );
}
