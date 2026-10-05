/**
 * Loading fallback for /health/certificates — Wave E.2-H.
 */
import { PageSkeleton } from '@/components/ui/page-skeleton';

export default function HealthCertificatesLoading() {
  return <PageSkeleton type="list" />;
}
