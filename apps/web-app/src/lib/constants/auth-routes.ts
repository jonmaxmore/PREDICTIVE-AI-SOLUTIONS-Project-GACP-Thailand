export const HEALTH_LOGIN_ROUTE = '/auth/health/login';
export const PROVIDER_LOGIN_ROUTE = '/auth/provider/login';
export const LEGACY_HEALTH_LOGIN_ROUTE = '/login';
export const LEGACY_PROVIDER_LOGIN_ROUTE = '/provider/login';
export const REGISTER_ROUTE = '/register';
/**
 * Where a HEALTH user lands after login.
 *
 * Was '/health/dashboard' until 2026-09-07. That route is a redirect-only shim —
 * `redirect('/health/home')`, and its own comment says Task 7 should sweep the
 * post-login targets still pointing at it. Measured on the live demo: a login walked
 * /login → /auth/health/login → /health/dashboard → /health/home and took ~6s, with
 * the user seeing the dashboard flash by
 * (evidence/apple-qa-audit-2026-09-07). The name is kept so the three call sites and
 * the A4 test still read coherently; only the destination loses the dead hop.
 *
 * The PROVIDER constant below is deliberately NOT changed: /provider/dashboard branches
 * per role (scheduler → /provider/coordinator, auditor → /provider/audits) before
 * falling through to /provider/home, so it is a router, not a shim.
 */
export const HEALTH_DASHBOARD_ROUTE = '/health/home';
export const PROVIDER_DASHBOARD_ROUTE = '/provider/dashboard';

export const HEALTH_LOGIN_ALIASES = [
  HEALTH_LOGIN_ROUTE,
  LEGACY_HEALTH_LOGIN_ROUTE,
] as const;

export const PROVIDER_LOGIN_ALIASES = [
  PROVIDER_LOGIN_ROUTE,
  LEGACY_PROVIDER_LOGIN_ROUTE,
] as const;

function matchesRoute(pathname: string, route: string): boolean {
  return pathname === route || pathname.startsWith(`${route}/`);
}

export function isLoginRoute(pathname = ''): boolean {
  return [...HEALTH_LOGIN_ALIASES, ...PROVIDER_LOGIN_ALIASES].some((route) =>
    matchesRoute(pathname, route),
  );
}

export function isProviderLoginRoute(pathname = ''): boolean {
  return PROVIDER_LOGIN_ALIASES.some((route) => matchesRoute(pathname, route));
}

export function resolveLoginRouteForPath(pathname = ''): string {
  return pathname.startsWith('/provider') || pathname.startsWith('/admin')
    ? PROVIDER_LOGIN_ROUTE
    : HEALTH_LOGIN_ROUTE;
}
