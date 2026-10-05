import { redirect } from 'next/navigation';

/**
 * Entry point for the new-application wizard.
 *
 * The wizard itself lives at /new/step/[id]. This thin redirect exists
 * because there are 14+ callers across the codebase that link to the
 * bare /new path — bottom nav, dashboard cards, help center, certificate
 * empty states, the [id]/edit flow that re-enters with ?edit=<id>, etc.
 * Removing this page would 404 every one of them.
 *
 * (Previously deleted in commit a2ea8450 with the rationale "only callers
 * were stale bookmarks" — that turned out to be wrong; restored here.)
 *
 * Search params are forwarded so query-driven flows like
 * /new?edit=<applicationId> still reach step 1 with their state intact.
 */
type SearchParams = Record<string, string | string[] | undefined>;

export default async function NewApplicationPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const v of value) qs.append(key, v);
    } else {
      qs.set(key, value);
    }
  }
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  redirect(`/health/applications/new/step/1${suffix}`);
}
