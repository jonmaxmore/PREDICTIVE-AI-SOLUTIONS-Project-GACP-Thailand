/**
 * Loading fallback for /health/payments — Wave E.2-H.
 */
import { PageSkeleton } from '@/components/ui/page-skeleton';

export default function HealthPaymentsLoading() {
  return <PageSkeleton type="list" />;
}
