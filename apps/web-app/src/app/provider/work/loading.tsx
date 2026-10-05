/**
 * Loading fallback for /provider/work (the canonical work-queue
 * inbox under ADR-016 Phase 1A) — Wave E.2-H.
 */
import { PageSkeleton } from '@/components/ui/page-skeleton';

export default function ProviderWorkLoading() {
  return <PageSkeleton type="list" />;
}
