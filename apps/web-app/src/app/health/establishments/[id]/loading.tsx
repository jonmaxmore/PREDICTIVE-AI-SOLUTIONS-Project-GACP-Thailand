/**
 * Loading fallback for /health/establishments/[id] — Wave E.2-H.
 * Detail-shaped skeleton overrides the list skeleton from the
 * parent /health/establishments segment.
 */
import { PageSkeleton } from '@/components/ui/page-skeleton';

export default function HealthEstablishmentDetailLoading() {
  return <PageSkeleton type="detail" />;
}
