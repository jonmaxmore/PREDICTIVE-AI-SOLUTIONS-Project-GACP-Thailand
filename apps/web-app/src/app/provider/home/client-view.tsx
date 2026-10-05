'use client';

/**
 * /provider/home — provider-side staff tile launcher (task-4,
 * tile-home-redesign N5/N7). Hub-and-spoke landing for auditor /
 * document_reviewer / scheduler / account(_dtam/_platform) / admin,
 * mirroring the structure of /health/home but on the officer (teal)
 * theme: a heading ("หน้าหลัก" / "เลือกเมนูที่คุณต้องการใช้งาน") over a
 * 2-column grid of that role's primary-tier NavTiles from getNavForRole,
 * plus a "เมนูเพิ่มเติม" row for any secondary-tier items.
 *
 * Chips are SKIPPED this task — chipText is null for every tile. Officer
 * chips (e.g. "3 งานรอคุณตรวจ" in the design mock) are Plan 5 (KPI) scope
 * and would require inventing endpoints this task has no mandate for.
 * None of AUDITOR_NAV/REVIEWER_NAV/SCHEDULER_NAV/ACCOUNT_NAV/ADMIN_NAV
 * currently declare a `lock`, so `locked` is always false here too.
 *
 * Two named exports:
 *   - `ProviderHome({ role })` — pure presentational component, the piece
 *     under test (provider-home.test.tsx renders it directly with a role
 *     string, same as the task brief's own test code).
 *   - default `ProviderHomeClientView()` — resolves the session role via
 *     `/auth/provider/me`, the same endpoint + `canonicalRole || role`
 *     precedence every other /provider/* page already uses (see
 *     provider/dashboard/page.tsx, provider/reviewer/client-view.tsx,
 *     provider/components/provider-layout.tsx), then renders `ProviderHome`
 *     wrapped in the shared `ProviderLayout` chrome (sidebar/topbar) that
 *     every other /provider/* page opts into explicitly — unlike
 *     /health/*, there is no route-level layout.tsx supplying it for free.
 *
 * Final-review F-3 fix — a THROWN `/auth/provider/me` used to set
 * `resolved: true` without ever setting `role`, so `getNavForRole(null)`
 * returned `[]` and the officer saw the heading over a silently empty grid:
 * no error, no retry, no redirect. The `!res.success` branch already
 * correctly bounces to `/auth/provider/login`; only the throw path degraded
 * silently. Fixed by distinguishing "resolved with no role" from "failed to
 * resolve": a dedicated `meError` state renders the SAME rose error Card +
 * retry pattern as provider/dashboard/page.tsx (X2-FIX-C/H-6) and
 * health/notifications (X1-FIX-C) — `dict.common.fetchError` copy, a retry
 * button that re-runs the fetch — instead of inventing new copy.
 */

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/primitives/button';
import { Card, CardContent } from '@/components/ui/primitives/card';
import { NavTile } from '@/components/navigation/nav-tile';
import { getNavForRole } from '@/lib/navigation/nav-config';
import { apiClient as api } from '@/lib/api/api-client';
import { useLanguage } from '@/lib/i18n/language-context';
import ProviderLayout from '../components/provider-layout';

export interface ProviderHomeProps {
  /** Resolved session role (raw string — getNavForRole normalizes aliases). */
  role: string | null | undefined;
}

export function ProviderHome({ role }: ProviderHomeProps) {
  const navItems = getNavForRole(role).filter((item) => item.tier !== 'system');
  const primaryItems = navItems.filter((item) => item.tier === 'primary');
  const secondaryItems = navItems.filter((item) => item.tier === 'secondary');

  return (
    <div className="w-full space-y-[22px]">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold text-foreground">หน้าหลัก</h1>
        <p className="text-sm text-muted-foreground">เลือกเมนูที่คุณต้องการใช้งาน</p>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        {primaryItems.map((item) => (
          <NavTile key={item.key} item={item} chipText={null} locked={false} theme="officer" />
        ))}
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

interface ProviderMe {
  role?: string;
  canonicalRole?: string | null;
}

export default function ProviderHomeClientView() {
  const router = useRouter();
  const { dict } = useLanguage();
  const [role, setRole] = useState<string | null>(null);
  const [resolved, setResolved] = useState(false);
  // F-3 fix — distinct from "resolved with no role": true only when the
  // /auth/provider/me request itself failed (network/throw), never when it
  // succeeded with an unrecognized role.
  const [meError, setMeError] = useState(false);

  const loadMe = useCallback(() => {
    let cancelled = false;
    setMeError(false);
    api
      .get<ProviderMe>('/auth/provider/me')
      .then((res) => {
        if (cancelled) return;
        if (!res.success || !res.data) {
          router.replace('/auth/provider/login');
          return;
        }
        setRole(res.data.canonicalRole || res.data.role || null);
        setResolved(true);
      })
      .catch(() => {
        if (cancelled) return;
        // F-3 fix — a throw must surface as an honest error state with a
        // retry action, not silently resolve into an empty tile grid.
        setResolved(true);
        setMeError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  useEffect(() => loadMe(), [loadMe]);

  return (
    <ProviderLayout>
      {meError ? (
        <Card
          data-testid="provider-home-fetch-error"
          className="rounded-xl border border-destructive/30 bg-card p-4"
          role="alert"
          aria-live="polite"
        >
          <CardContent className="flex items-start gap-3 p-0">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden="true" focusable="false" />
            <div className="min-w-0 space-y-1">
              <h3 className="text-sm font-semibold text-destructive">
                {dict.common?.fetchError?.title || 'Unable to load data'}
              </h3>
              <p className="text-sm text-muted-foreground">
                {dict.common?.fetchError?.hint || 'Unable to load your account data at this time'}
              </p>
              <Button type="button" variant="outline" size="sm" className="mt-2" onClick={loadMe}>
                {dict.common?.fetchError?.retry || 'Try again'}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : resolved ? (
        <ProviderHome role={role} />
      ) : null}
    </ProviderLayout>
  );
}
