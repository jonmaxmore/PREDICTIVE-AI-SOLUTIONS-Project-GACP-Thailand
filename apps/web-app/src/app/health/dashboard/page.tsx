import { redirect } from 'next/navigation';

/**
 * Task 3 (tile-home-redesign, N2) — /health/dashboard is retired as a
 * landing route: it now redirects straight to /health/home, the new
 * tile-home entry point. `./client-view.tsx` is intentionally NOT deleted
 * — it still renders the dashboard content used directly by
 * `__tests__/dashboard-fetch-error.test.tsx`, and Task 6/7 finish the
 * story (deciding ClientView's new home, then sweeping every other
 * "/health/dashboard" post-login redirect target that still points here).
 */
export default function Page() {
  redirect('/health/home');
}
