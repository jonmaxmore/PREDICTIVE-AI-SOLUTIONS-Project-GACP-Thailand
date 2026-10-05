/**
 * Loading fallback for /health/documents — Wave E.2-H.
 */
import { PageSkeleton } from '@/components/ui/page-skeleton';

export default function HealthDocumentsLoading() {
  return <PageSkeleton type="list" />;
}
