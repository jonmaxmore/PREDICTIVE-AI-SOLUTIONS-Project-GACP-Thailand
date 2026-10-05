'use client';

/**
 * /health/home — farmer tile launcher (N1, N5-N7).
 *
 * Hub-and-spoke replacement for the old menu-row dashboard: a heading
 * ("คุณต้องการทำอะไรวันนี้") over a 2-column grid of primary-tier NavTiles,
 * plus a small "เมนูเพิ่มเติม" row for secondary-tier items. The 'home'
 * item itself (tier: 'system') is filtered out — it must never render as
 * a tile pointing at itself.
 *
 * One data source (useNavChips(), both halves enabled — this is the
 * default caller, see its module doc): pendingActions/unpaid chip text AND
 * hasActiveCert/certsLoaded for the planting-tile lock. Fix round 1
 * (reviewer finding): this file used to run its OWN separate
 * /api/certificates/my fetch alongside useNavChips()'s (which, once task 5
 * extended that hook with the same cert data, made this a duplicate fetch
 * on every /health/home load). Consolidated onto the one hook — same
 * getCertBadgeKind gate, now computed in exactly one place.
 *
 * The planting lock here is PRESENTATION ONLY. The real security gate
 * lives on /health/planting itself; this tile just previews that state so
 * an applicant isn't surprised by a dead end.
 */

import Link from 'next/link';
import { Button } from '@/components/ui/primitives/button';
import { NavTile } from '@/components/navigation/nav-tile';
import { getNavForRole, type NavItem } from '@/lib/navigation/nav-config';
import { useNavChips } from '@/lib/navigation/use-nav-chips';

function isTileLocked(item: NavItem, hasActiveCert: boolean, certsLoaded: boolean): boolean {
  if (!item.lock) return false;
  if (item.lock.condition === 'ACTIVE_CERT_REQUIRED') {
    // Before the fetch resolves we don't yet know — render unlocked-looking
    // rather than guess locked. Only flip once we KNOW there's no active cert.
    return certsLoaded && !hasActiveCert;
  }
  return false;
}

export default function HealthHomeClientView() {
  const chips = useNavChips();

  const navItems = getNavForRole('health').filter((item) => item.tier !== 'system');
  const primaryItems = navItems.filter((item) => item.tier === 'primary');
  const secondaryItems = navItems.filter((item) => item.tier === 'secondary');

  return (
    <div className="w-full space-y-[22px]">
      <h1 className="text-2xl font-bold text-foreground">คุณต้องการทำอะไรวันนี้</h1>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        {primaryItems.map((item) => {
          const chipSource = item.chipSource;
          const chipText = chipSource ? chips[chipSource] : null;
          return (
            <NavTile
              key={item.key}
              item={item}
              chipText={chipText}
              locked={isTileLocked(item, chips.hasActiveCert, chips.certsLoaded)}
            />
          );
        })}
      </div>

      {secondaryItems.length > 0 && (
        <div className="flex flex-col gap-2.5">
          <span className="text-[13px] font-semibold text-muted-foreground">เมนูเพิ่มเติม</span>
          <div className="flex flex-wrap gap-3">
            {secondaryItems.map((item) => {
              const Icon = item.icon;
              return (
                <Button key={item.key} asChild variant="outline" size="md">
                  <Link href={item.path}>
                    <Icon className="mr-1.5 h-[17px] w-[17px]" aria-hidden="true" focusable="false" />
                    {item.labelTH}
                  </Link>
                </Button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
