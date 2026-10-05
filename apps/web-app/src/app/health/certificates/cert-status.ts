/**
 * Certificate status summary helpers — extracted from client-view.tsx so the
 * counting logic is unit-testable (role-walkthrough 2026-07-10 found the
 * counters showing 0/0/0 while an active cert card rendered below them).
 */

export interface CertLike {
  status: string;
  expiryDate: string;
}

export function getDaysRemaining(expiryDate: string): number {
  const expiry = new Date(expiryDate).getTime();
  return Math.ceil((expiry - Date.now()) / (1000 * 60 * 60 * 24));
}

/**
 * Backend stores/returns Certificate.status LOWERCASE ('active' — schema
 * default; the route also ships a lowercased canonicalStatus). Strict
 * comparison against 'ACTIVE' made every real cert vanish from all three
 * buckets (0/0/0 above a rendered active card). Normalize before comparing,
 * and bucket so every cert lands in exactly one of active/expiring/expired
 * (revoked/unknown statuses count under expired = "ใช้งานไม่ได้").
 */
export function getCertCounters(certs: CertLike[]): {
  activeCount: number;
  expiringCount: number;
  expiredCount: number;
} {
  let activeCount = 0;
  let expiringCount = 0;
  let expiredCount = 0;
  for (const c of certs) {
    const status = String(c.status || '').toUpperCase();
    const d = getDaysRemaining(c.expiryDate);
    if (status === 'ACTIVE' && d >= 90) {
      activeCount += 1;
    } else if (status === 'ACTIVE' && d > 0) {
      expiringCount += 1;
    } else {
      expiredCount += 1;
    }
  }
  return { activeCount, expiringCount, expiredCount };
}

/**
 * Badge kind for a single cert card — MUST agree with getCertCounters so the
 * card badge and the summary tiles never contradict. Only an ACTIVE cert with
 * time left is 'active'/'expiring'; EXPIRED, REVOKED, or any other status is
 * 'expired' (neutral/invalid — never the green "ใช้งานได้"). Walkthrough
 * 2026-07-10 follow-up: a REVOKED cert keeps a future expiryDate, so the old
 * "days-left → active" fallthrough painted it green.
 */
export function getCertBadgeKind(status: string, daysLeft: number): 'active' | 'expiring' | 'expired' {
  const s = String(status || '').toUpperCase();
  if (s !== 'ACTIVE' || daysLeft <= 0) return 'expired';
  if (daysLeft < 90) return 'expiring';
  return 'active';
}
