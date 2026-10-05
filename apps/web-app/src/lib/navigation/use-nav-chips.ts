/**
 * useNavChips — tile-home notification chip counts + planting-lock state.
 *
 * Chips are sourced from the SAME endpoint the existing dashboard already
 * calls (`/api/applications/my`, see app/health/dashboard/client-view.tsx)
 * — no new backend endpoint. Buckets the applicant's own applications by
 * status:
 *
 *   pendingActions — statuses that need the applicant to act:
 *     REVISION_REQUESTED, PENDING_DOC_FEE, PENDING_AUDIT_FEE, CAR_PENDING
 *   unpaid         — statuses with an outstanding fee:
 *     PENDING_DOC_FEE, PENDING_AUDIT_FEE
 *
 * A zero count renders as null (chip hidden) — never "0 รายการ".
 *
 * hasActiveCert/certsLoaded (task 5, tile-home-redesign N3) — extends this
 * SAME hook (rather than forking a new fetch) with the certificate-lock
 * state originally computed inline in app/health/home/client-view.tsx's
 * isTileLocked, so the mobile bottom nav's การปลูก lock can reuse the exact
 * same /api/certificates/my fetch + getCertBadgeKind gate the tile-home
 * grid already uses, instead of drifting with its own copy. 'usable' means
 * getCertBadgeKind(...) !== 'expired' — see cert-status.ts for why a bare
 * status compare is wrong (natural expiry doesn't flip Certificate.status).
 *
 * Options gate each fetch INDEPENDENTLY (fix round 1, reviewer finding) —
 * a caller that only reads one half must not pay for both:
 *   - `chips`    (default true) — /api/applications/my, for pendingActions/unpaid.
 *   - `certLock` (default true) — /api/certificates/my, for hasActiveCert/certsLoaded.
 * DashboardLayout only reads hasActiveCert/certsLoaded (bottom-nav lock) —
 * it must pass `{ chips: false }` so it never fires the unused
 * /api/applications/my GET on every health page. client-view.tsx (task 2's
 * tile-home grid) consumes BOTH halves, so it keeps the default (both
 * true) — this is also why client-view.tsx no longer runs its OWN separate
 * /api/certificates/my fetch (consolidated here, see round-1-fix note in
 * client-view.tsx).
 *
 * ERROR is a THIRD state (final-review F-2 fix), distinct from "loaded, no
 * cert" (certsLoaded:true, hasActiveCert:false) and "still loading"
 * (certsLoaded:false, certError:false). Both the `success === false`
 * envelope branch and the network `.catch` used to set `certsLoaded: true`
 * while leaving `hasActiveCert: false` — indistinguishable from a real
 * "you have no certificate" answer, which locked บันทึกการปลูก and told a
 * CERTIFIED farmer whose request 500s that they hold no certificate. On
 * error, `certsLoaded` now stays false and `certError` flips true; both
 * consumers already treat `certsLoaded === false` as unlocked-looking (the
 * "unknown, not yet known" case), so an error now fails OPEN, not locked.
 * This is deliberately safe to fail open: the real security gate is
 * server-side, in `plantingService.createCycle` (apps/backend/services/
 * planting-service.js) — it independently re-validates an active,
 * non-expired certificate before a planting cycle can be created, so a
 * stale/wrong client-side "unlocked" tile can never bypass enforcement.
 *
 * NavCertLockContext (final-review F-7 fix, "/health/home fires
 * /api/certificates/my twice") — DashboardLayout (app/health/layout.tsx
 * wraps every /health/* route in it) and client-view.tsx (rendered as its
 * `children` on /health/home) each called useNavChips() with certLock
 * enabled, so the cert-lock half fetched TWICE per page load: once in the
 * layout, once in the page. Neither call site's hook invocation changes —
 * DashboardLayout now also PROVIDES the cert-lock half of its own result
 * through this context; a useNavChips() call nested under that provider
 * detects it and skips its own fetch, merging in the shared value instead.
 * A caller with no ancestor provider (e.g. this hook's own isolated tests)
 * is unaffected — it fetches independently exactly as before.
 */
'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { apiClient as api } from '@/lib/api/api-client';
import { getCertBadgeKind, getDaysRemaining } from '@/app/health/certificates/cert-status';

interface ApplicationRecord {
  status?: string;
}

interface CertificateRecord {
  status?: string;
  expiryDate?: string;
}

const PENDING_ACTION_STATUSES = new Set<string>([
  'REVISION_REQUESTED',
  'PENDING_DOC_FEE',
  'PENDING_AUDIT_FEE',
  'CAR_PENDING',
]);

const UNPAID_STATUSES = new Set<string>(['PENDING_DOC_FEE', 'PENDING_AUDIT_FEE']);

export interface NavChips {
  pendingActions: string | null;
  unpaid: string | null;
  /** True once at least one non-expired (getCertBadgeKind !== 'expired') certificate is on file. */
  hasActiveCert: boolean;
  /** False until the certificates fetch resolves successfully (or `certLock` is false) — before that, lock state is unknown. Stays false on error too (see `certError`). */
  certsLoaded: boolean;
  /**
   * True when the certificates fetch failed (network/throw, or a
   * `success: false` envelope) — lock state is UNKNOWN, a third state
   * distinct from "loaded, no cert" (certsLoaded:true) and "still loading"
   * (certsLoaded:false, certError:false). Consumers must render this the
   * same as "still loading" (unlocked-looking), never as a confirmed lock
   * (final-review F-2).
   */
  certError: boolean;
}

const EMPTY_CHIPS: NavChips = {
  pendingActions: null,
  unpaid: null,
  hasActiveCert: false,
  certsLoaded: false,
  certError: false,
};

/**
 * Cert-lock half of NavChips, shared from an ancestor DashboardLayout to a
 * nested useNavChips() call so the /api/certificates/my fetch happens once
 * per page load, not once per hook instance (final-review F-7 fix). `null`
 * means "no ancestor provider" — the hook falls back to its own fetch.
 */
export const NavCertLockContext = createContext<Pick<
  NavChips,
  'hasActiveCert' | 'certsLoaded' | 'certError'
> | null>(null);

export interface UseNavChipsOptions {
  /** Fetch /api/applications/my for pendingActions/unpaid. Default true. */
  chips?: boolean;
  /** Fetch /api/certificates/my for hasActiveCert/certsLoaded. Default true. */
  certLock?: boolean;
}

export function useNavChips(options: UseNavChipsOptions = {}): NavChips {
  const { chips: chipsEnabled = true, certLock: certLockEnabled = true } = options;
  const sharedCertLock = useContext(NavCertLockContext);
  const [chips, setChips] = useState<NavChips>(EMPTY_CHIPS);

  useEffect(() => {
    if (!chipsEnabled) {
      setChips((prev) => ({ ...prev, pendingActions: null, unpaid: null }));
      return;
    }
    let cancelled = false;
    api
      .get<ApplicationRecord[]>('/api/applications/my')
      .then((res) => {
        if (cancelled) return;
        if (res.success === false) return;
        const apps = Array.isArray(res.data) ? res.data : [];
        let pendingCount = 0;
        let unpaidCount = 0;
        for (const app of apps) {
          const status = app.status;
          if (!status) continue;
          if (PENDING_ACTION_STATUSES.has(status)) pendingCount += 1;
          if (UNPAID_STATUSES.has(status)) unpaidCount += 1;
        }
        setChips((prev) => ({
          ...prev,
          pendingActions: pendingCount > 0 ? `${pendingCount} รายการรอคุณดำเนินการ` : null,
          unpaid: unpaidCount > 0 ? `มียอดค้างชำระ ${unpaidCount} รายการ` : null,
        }));
      })
      .catch(() => {
        // Chips are presentational only — a fetch failure just leaves them
        // hidden (null), it must never crash the tile-home page.
        if (!cancelled) setChips((prev) => ({ ...prev, pendingActions: null, unpaid: null }));
      });
    return () => {
      cancelled = true;
    };
  }, [chipsEnabled]);

  useEffect(() => {
    // An ancestor DashboardLayout already fetched this (NavCertLockContext,
    // F-7 fix) — reuse its value instead of firing a second GET.
    if (sharedCertLock) return;
    if (!certLockEnabled) {
      setChips((prev) => ({ ...prev, hasActiveCert: false, certsLoaded: false, certError: false }));
      return;
    }
    let cancelled = false;
    api
      .get<CertificateRecord[]>('/api/certificates/my')
      .then((res) => {
        if (cancelled) return;
        if (res.success === false) {
          // F-2 fix: a `success: false` envelope is an ERROR, not "loaded,
          // no cert" — certsLoaded must stay false (see module doc).
          setChips((prev) => ({ ...prev, certsLoaded: false, certError: true }));
          return;
        }
        const certs = Array.isArray(res.data) ? res.data : [];
        // Reuse certificates/cert-status.ts's getCertBadgeKind — see the
        // module doc comment above for why a bare status compare is wrong.
        const active = certs.some((c) => {
          if (!c.status || !c.expiryDate) return false;
          const daysLeft = getDaysRemaining(c.expiryDate);
          return getCertBadgeKind(c.status, daysLeft) !== 'expired';
        });
        setChips((prev) => ({ ...prev, hasActiveCert: active, certsLoaded: true, certError: false }));
      })
      .catch(() => {
        // F-2 fix: a network failure/throw is an ERROR, not "loaded, no
        // cert" — see the module doc's ERROR-is-a-third-state note.
        if (!cancelled) setChips((prev) => ({ ...prev, certsLoaded: false, certError: true }));
      });
    return () => {
      cancelled = true;
    };
  }, [certLockEnabled, sharedCertLock]);

  if (sharedCertLock) {
    return { ...chips, ...sharedCertLock };
  }
  return chips;
}

export default useNavChips;
