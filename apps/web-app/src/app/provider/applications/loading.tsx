/**
 * Loading fallback for /provider/applications — Wave E.2-H.
 * Provider's application queue is the most-used screen for staff;
 * the list skeleton matches its layout.
 */
import { PageSkeleton } from '@/components/ui/page-skeleton';

export default function ProviderApplicationsLoading() {
  return <PageSkeleton type="list" />;
}
