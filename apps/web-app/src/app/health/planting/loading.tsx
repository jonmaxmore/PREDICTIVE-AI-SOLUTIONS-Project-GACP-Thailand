/**
 * Loading fallback for /health/planting — Wave E.2-H.
 */
import { PageSkeleton } from '@/components/ui/page-skeleton';

export default function HealthPlantingLoading() {
  return <PageSkeleton type="list" />;
}
