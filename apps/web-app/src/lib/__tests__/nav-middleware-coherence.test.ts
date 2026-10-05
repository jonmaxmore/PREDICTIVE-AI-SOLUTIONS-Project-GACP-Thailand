/**
 * PROV-NAV-1 — nav/middleware coherence guard (kills the recurring drift class).
 *
 * The provider sidebar visibility (NAV_ROLE_RULES, constants.ts) and the route
 * access gate (PROVIDER_ROUTE_ROLE_RULES, middleware-helpers.ts) are two tables.
 * Whenever they drift, a role sees a nav link that the middleware then bounces to
 * /provider/dashboard — a dead-end click. This was hand-patched per-route at least
 * three times (X2-FIX-D, X3-D, X4-FIX-A) because nothing cross-checked the tables.
 *
 * The invariant (the ERP "menu = access" principle — Odoo/Oracle/SAP all derive
 * the menu from the same RBAC layer that authorizes the action): EVERY nav item a
 * role can SEE must resolve to `allow` under the route middleware for that role.
 * If this fails, either widen the middleware or narrow NAV_ROLE_RULES — never ship
 * a link that bounces.
 */
import { visibleProviderNavItems } from '../constants';
import { CANONICAL_ROLES } from '../constants/canonical-roles';
import {
  PROVIDER_ROUTE_ROLE_RULES,
  decideProviderRouteAccess,
} from '../middleware-helpers';

const PROVIDER_ROLES: string[] = [
  CANONICAL_ROLES.SYSTEM_ADMIN_DTAM,
  CANONICAL_ROLES.DISPATCHER,
  CANONICAL_ROLES.DOCUMENT_REVIEWER,
  CANONICAL_ROLES.FIELD_INSPECTOR,
  CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM,
  CANONICAL_ROLES.FINANCE_OFFICER_DTAM,
  CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM,
];

describe('PROV-NAV-1 — every visible provider nav link must NOT bounce (menu = access)', () => {
  for (const role of PROVIDER_ROLES) {
    it(`role "${role}": no nav item it can see is blocked by route middleware`, () => {
      const offenders = visibleProviderNavItems(role)
        .map((item) => ({
          key: item.key,
          href: item.href,
          decision: decideProviderRouteAccess(item.href, role, PROVIDER_ROUTE_ROLE_RULES).decision,
        }))
        .filter((r) => r.decision !== 'allow');
      // Any offender = a sidebar link that renders for this role then redirects.
      expect(offenders).toEqual([]);
    });
  }
});
