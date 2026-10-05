/**
 * Loading fallback for /health/applications/[id] — Wave E.2-H.
 * Detail-shaped skeleton (header + sections) matches the application
 * detail page layout instead of inheriting the parent list skeleton.
 */
import { PageSkeleton } from '@/components/ui/page-skeleton';

export default function HealthApplicationDetailLoading() {
  return <PageSkeleton type="detail" />;
}
