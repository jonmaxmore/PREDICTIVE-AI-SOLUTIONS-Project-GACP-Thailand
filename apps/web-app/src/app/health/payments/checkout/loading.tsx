/**
 * Loading fallback for /health/payments/checkout — W2-03 D2.
 * Same PageSkeleton convention as `../loading.tsx` (/health/payments).
 */
import { PageSkeleton } from '@/components/ui/page-skeleton';

export default function HealthPaymentsCheckoutLoading() {
  return <PageSkeleton type="list" />;
}
