'use client';

import { PortalErrorPage } from '@/components/feature/portal-error-page';

/**
 * Error Boundary สำหรับ Applicant (/health/*) routes — Wave E.2-H.
 * Delegates to the shared <PortalErrorPage> so /health, /admin, and
 * /provider all render identical SummaryHeader-based error chrome.
 */
export default function HealthError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <PortalErrorPage
      eyebrow="ผู้ขอรับรอง · เกิดข้อผิดพลาด"
      homeHref="/health/home"
      homeLabel="กลับหน้าหลัก"
      error={error}
      reset={reset}
    />
  );
}
