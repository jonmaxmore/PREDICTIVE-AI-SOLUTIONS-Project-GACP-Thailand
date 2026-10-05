/**
 * Loading fallback for /admin/* routes — Wave E.2-H.
 * Audit found /admin had no segment-level loading.tsx, so transitions
 * showed nothing until the page rendered. PageSkeleton type=dashboard
 * matches the typical admin landing pattern.
 */
import { PageSkeleton } from '@/components/ui/page-skeleton';

export default function AdminLoading() {
  return <PageSkeleton type="dashboard" />;
}
