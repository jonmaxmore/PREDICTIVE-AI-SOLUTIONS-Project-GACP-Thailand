/**
 * Loading fallback for /health/establishments — Wave E.2-H.
 */
import { PageSkeleton } from '@/components/ui/page-skeleton';

export default function HealthEstablishmentsLoading() {
  return <PageSkeleton type="list" />;
}
