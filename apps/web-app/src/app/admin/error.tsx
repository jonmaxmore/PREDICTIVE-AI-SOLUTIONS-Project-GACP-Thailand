'use client';

import { PortalErrorPage } from '@/components/feature/portal-error-page';

/**
 * Error Boundary สำหรับ Admin (/admin/*) routes — Wave E.2-H.
 * Delegates to the shared <PortalErrorPage>.
 */
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <PortalErrorPage
      eyebrow="ผู้ดูแลระบบ · เกิดข้อผิดพลาด"
      homeHref="/admin/dashboard"
      homeLabel="กลับหน้าหลัก"
      error={error}
      reset={reset}
    />
  );
}
