'use client';

/**
 * HelpBackHomeCrumb — B-NAV item 2, W10.
 *
 * /help sits outside both the health and provider portal shells (no
 * app/help/layout.tsx — DashboardLayout never wraps it), had no back
 * affordance at all, and is reachable by every role (it's in
 * carpet-pages.spec.ts's PUBLIC_ROUTES, visited both signed-out and
 * signed-in). A hardcoded destination would send an officer to
 * /health/home (wrong portal) or a farmer to /provider/home (dead end,
 * 403). Instead this derives the caller's own role home the same way
 * DashboardLayout's slim-bar logo does: farmer -> /health/home, any
 * officer role -> /provider/home, no session -> '/' (public landing —
 * there is no "home" to send an anonymous visitor to).
 *
 * /help/page.tsx is a server component (reads the Thai copy dictionary at
 * build/request time with no client-side data), so the session lookup
 * lives in this small client component instead.
 */

import { useEffect, useState } from 'react';
import { BackHomeCrumb } from '@/components/navigation/back-home-crumb';
import { AuthService } from '@/lib/services/auth-service';
import { normalizeRole } from '@/lib/constants/canonical-roles';

function resolveHomePath(rawRole: string | null | undefined): string {
  if (!rawRole) return '/';
  const canonical = normalizeRole(rawRole);
  if (!canonical) return '/';
  return canonical === 'health' ? '/health/home' : '/provider/home';
}

export function HelpBackHomeCrumb() {
  // Default '/' until the client-only AuthService resolves (matches
  // DashboardLayout's own useEffect-based user lookup) — never a flash of
  // a wrong-portal link before the session is known.
  const [homePath, setHomePath] = useState('/');

  useEffect(() => {
    const user = AuthService.getUser();
    setHomePath(resolveHomePath(user?.role));
  }, []);

  return <BackHomeCrumb current="ช่วยเหลือ" homePath={homePath} />;
}

export default HelpBackHomeCrumb;
