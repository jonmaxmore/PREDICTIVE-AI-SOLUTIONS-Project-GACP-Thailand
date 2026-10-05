/**
 * Loading fallback for provider route group
 * Automatically used by Next.js as Suspense fallback
 */
import { PageSkeleton } from "@/components/ui/page-skeleton";

export default function ProviderLoading() {
    return <PageSkeleton type="dashboard" />;
}

