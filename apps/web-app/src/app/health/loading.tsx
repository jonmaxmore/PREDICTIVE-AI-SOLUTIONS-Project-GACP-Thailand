/**
 * Loading fallback for (Applicant) route group
 * Automatically used by Next.js as Suspense fallback
 */
import { PageSkeleton } from "@/components/ui/page-skeleton";

export default function ApplicantLoading() {
    return <PageSkeleton type="dashboard" />;
}
