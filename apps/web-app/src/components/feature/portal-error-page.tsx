'use client';

/**
 * PortalErrorPage — shared error-boundary UI for /health, /admin, and
 * /provider portals. Replaces three near-identical 50-LoC error.tsx
 * files that differed only in eyebrow text and home href.
 *
 * Wave E.2-H. Pairs with the per-portal not-found.tsx files (#218):
 * both use SummaryHeader chrome so the look is uniform across error
 * states across the app.
 *
 * Marked 'use client' — Next.js error boundaries are client-only
 * (they receive the reset() callback from React).
 */
import Link from 'next/link';
import { Button } from '@/components/ui/primitives/button';
import { SummaryHeader } from '@/components/feature/summary-header';
import { useReportRenderError } from '@/lib/sentry/report-render-error';

interface Props {
  /** SummaryHeader eyebrow — e.g. "ผู้ขอรับรอง · เกิดข้อผิดพลาด" */
  eyebrow: string;
  /** URL of the portal's home/dashboard page */
  homeHref: string;
  /** Optional label override for the home button (default "กลับหน้าหลัก") */
  homeLabel?: string;
  /** The Error caught by the boundary (digest is optional). */
  error: Error & { digest?: string };
  /** The reset callback from the Next.js error boundary. */
  reset: () => void;
}

export function PortalErrorPage({ eyebrow, homeHref, homeLabel = 'กลับหน้าหลัก', error, reset }: Props) {
  // Handed to Sentry when a DSN is baked in (PII-scrubbed); a no-op otherwise.
  useReportRenderError(error);
  return (
    <div className="space-y-6">
      <SummaryHeader
        eyebrow={eyebrow}
        title="เกิดข้อผิดพลาด"
        description="ไม่สามารถโหลดข้อมูลได้ กรุณาลองใหม่อีกครั้ง หากปัญหายังคงอยู่กรุณาติดต่อเจ้าหน้าที่"
      />

      <div className="rounded-2xl border border-rose-200 bg-rose-50/40 p-6 shadow-sm">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-rose-100 text-rose-600">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground">
              {error.message || 'ไม่สามารถดำเนินการได้'}
            </p>
            {error.digest ? (
              <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                Error reference: {error.digest}
              </p>
            ) : null}
            <div className="mt-4 flex flex-wrap gap-3">
              <Button onClick={reset}>
                ลองใหม่
              </Button>
              <Button asChild variant="outline">
                <Link href={homeHref}>{homeLabel}</Link>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
