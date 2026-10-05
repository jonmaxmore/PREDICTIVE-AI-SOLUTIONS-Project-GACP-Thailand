'use client';

import { PortalErrorPage } from '@/components/feature/portal-error-page';

/**
 * Error Boundary สำหรับ Provider (/provider/*) routes — Wave E.2-H.
 * Delegates to the shared <PortalErrorPage>. Note that the underlying
 * /provider/layout.tsx is just a `data-role` setter — pages each
 * wrap themselves in <ProviderLayout> for the role-aware sidebar.
 * The error boundary follows the parent layout convention; if a
 * page throws before mounting <ProviderLayout>, the error UI lives
 * outside the sidebar (matching prior behaviour).
 */
export default function ProviderError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <PortalErrorPage
      eyebrow="ผู้ให้บริการ · เกิดข้อผิดพลาด"
      homeHref="/provider/home"
      homeLabel="กลับหน้าหลัก"
      error={error}
      reset={reset}
    />
  );
}
