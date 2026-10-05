/**
 * Loading fallback for /provider/audits — Wave E.2-H.
 */
import { PageSkeleton } from '@/components/ui/page-skeleton';

export default function ProviderAuditsLoading() {
  return <PageSkeleton type="list" />;
}
