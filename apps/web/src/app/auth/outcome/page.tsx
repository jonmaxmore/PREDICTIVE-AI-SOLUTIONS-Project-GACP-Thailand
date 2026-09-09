import Link from 'next/link';
import { PLATFORM_OPERATOR_LOGIN_PATH, PUBLIC_LOGIN_PATH } from '@/lib/roles.ts';
import { messages } from '@/messages/th.ts';

const OUTCOME_CODES = [
  'NOT_PROVIDER',
  'AGENCY_NOT_AUTHORIZED',
  'NOT_MEMBER',
  'NO_ROLE_YET',
  'STATE_MISMATCH',
  'PROVIDER_ERROR',
] as const;
type OutcomeCode = (typeof OUTCOME_CODES)[number];

function isOutcomeCode(value: string | undefined): value is OutcomeCode {
  return OUTCOME_CODES.includes(value as OutcomeCode);
}

type OutcomePageProps = {
  readonly searchParams: Promise<{ readonly code?: string }>;
};

// หน้าผลลัพธ์เมื่อยืนยันตัวตนสำเร็จแต่เข้าฝั่งที่ตั้งใจไม่ได้ (หรือการล็อกอินไม่สมบูรณ์): บอกสาเหตุ + ขั้นต่อไป
export default async function SignInOutcomePage({ searchParams }: OutcomePageProps) {
  const { code } = await searchParams;
  const outcome: OutcomeCode = isOutcomeCode(code) ? code : 'STATE_MISMATCH';
  const copy = messages.signInOutcome[outcome];
  const loginPath = outcome === 'NOT_MEMBER' ? PLATFORM_OPERATOR_LOGIN_PATH : PUBLIC_LOGIN_PATH;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-6 py-12">
      <p className="inline-flex self-start rounded-full bg-leaf-tint px-3 py-1 text-sm font-bold text-leaf">
        {messages.appName}
      </p>
      <section className="rounded-xl border border-border bg-surface p-6 shadow-card">
        <h1 className="text-xl font-bold text-ink">{copy.title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">{copy.body}</p>
        <Link
          href={loginPath}
          className="mt-6 inline-flex h-11 items-center justify-center rounded-md border border-border px-5 font-semibold text-ink hover:bg-paper"
        >
          {messages.signInOutcome.backToLogin}
        </Link>
      </section>
    </main>
  );
}
