/**
 * Loading fallback for /health/applications and below — Wave E.2-H.
 * Overrides the parent /health/loading.tsx (dashboard skeleton) with
 * a list-shaped one that matches the applications-list layout.
 */
import { PageSkeleton } from '@/components/ui/page-skeleton';

export default function HealthApplicationsLoading() {
  return <PageSkeleton type="list" />;
}
