'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import {
  Bell,
  ChevronDown,
  Lock,
  Moon,
  Sun,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/primitives/button';
import { AuthService, AuthUser } from '@/lib/services/auth-service';
import { HEALTH_LOGIN_ROUTE, PROVIDER_LOGIN_ROUTE } from '@/lib/constants/auth-routes';
import { Footer } from '@/components/layout/Footer';
import { EntitySwitcher } from '@/components/layout/entity-switcher';
import { LanguageToggle } from '@/components/feature/LanguageToggle';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/primitives/dropdown-menu';
import { apiClient as api } from '@/lib/api';
import { getNavForRole, findNavLabelForPath } from '@/lib/navigation/nav-config';
import { NavCertLockContext, useNavChips } from '@/lib/navigation/use-nav-chips';
import { BackHomeCrumb } from '@/components/navigation/back-home-crumb';

/**
 * X1-FIX-D / H-1 — unread-notification poll for the header bell.
 *
 * Why a 30-second interval (not realtime push):
 *   - Notifications API is REST; no WebSocket / SSE wired yet.
 *   - 30 s is a sane compromise between staleness and request volume —
 *     a HEALTH user typically reviews the dashboard for several minutes,
 *     during which the badge will refresh ~6 times.
 *   - The fetch is hard-capped: on error we render NO dot (do NOT crash,
 *     do NOT show a stale dot). The bell remains clickable so users can
 *     still navigate to the notifications page even if the count fails.
 *
 * It calls GET /notifications/unread-count, which is a single COUNT. It used to
 * fetch the notification LIST and filter it here, mirroring
 * app/health/notifications/client-view.tsx — but that list is capped at the 50
 * newest rows server-side, so anyone with more than 50 unread saw "50" forever,
 * and the bell pulled 50 full rows every 30 s to produce one integer.
 */
const UNREAD_POLL_MS = 30_000;

/** Shape of GET /notifications/unread-count once the client unwraps the envelope. */
interface UnreadCountBody {
  count?: number;
}

interface NavItem {
  href: string;
  label: string;
  Icon: React.ComponentType<{ className?: string | undefined }>;
}

interface DashboardLayoutProps {
  children: React.ReactNode;
  navItems: NavItem[];
  role: 'health' | 'provider';
  brandName: string;
  brandIcon: React.ComponentType<{ className?: string | undefined }>;
  /**
   * Canonical role for nav-config lookups on the provider portal, where
   * many canonical roles (auditor, document_reviewer, scheduler, account*,
   * admin, platform_admin) all share `role="provider"` (task 3, W10).
   * ProviderLayout (app/provider/components/provider-layout.tsx) already
   * resolves this via `/auth/provider/me` for its own purposes and passes
   * it down here — same "share, don't refetch" pattern as
   * NavCertLockContext (F-7). Ignored when `role === 'health'` (always
   * FARMER_NAV there). `undefined`/`null` while still resolving renders an
   * empty bottom nav, never a crash.
   */
  canonicalRole?: string | null;
  /**
   * Suppress the shell-level BackHomeCrumb (task 1, D1/D2, W10) for a page
   * that already renders its own equivalent back control in the same slot
   * — e.g. /health/more's "ย้อนกลับ" button. Default false. The role's own
   * home page never shows the crumb regardless of this prop (you can't be
   * "back home" from home).
   */
  hideBackHomeCrumb?: boolean;
}

/*
 * Mobile bottom tabs (task 5, tile-home-redesign N3; task 3, W10).
 *
 * Generated directly from nav-config.ts — items flagged `bottomNav: true`
 * for the caller's canonical role, in that role's array order, label =
 * item.shortTH ?? item.labelTH. ONE shared code path for both portals
 * (farmer AND every officer role) — see `bottomNavItems` below. This
 * replaced two separate implementations: HEALTH_MOBILE_KEYS href-matching
 * against the legacy `healthNavigation` list (health), and
 * PROVIDER_MOBILE_KEYS href-matching against the `navItems` prop
 * (provider) — nav-config is now the single source for every portal.
 */

export function DashboardLayout({
  children,
  navItems: _navItems,
  role,
  brandName,
  canonicalRole,
  hideBackHomeCrumb = false,
}: DashboardLayoutProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isDark, setIsDark] = useState(false);
  /* X1-FIX-D / H-1 — unread notification count for the bell badge.
     `null` means "unknown / not yet loaded / error" — render NO dot. */
  const [unreadCount, setUnreadCount] = useState<number | null>(null);

  useEffect(() => {
    setUser(AuthService.getUser());
    setIsDark(localStorage.getItem('theme') === 'dark');
  }, []);

  /**
   * X1-FIX-D / H-1 — fetch unread notification count on mount and poll
   * every 30 s. Replaces the prior hardcoded red dot ("cry wolf" pattern)
   * that was always visible regardless of unread state.
   *
   * Failure mode: if the fetch fails (network, 401, 500), `unreadCount`
   * stays `null` and we render NO dot rather than a stale one. This MUST
   * NOT crash the layout — DashboardLayout is used by every HEALTH +
   * PROVIDER page, and a crash here would take down the entire portal.
   *
   * R3 cleanup pattern: the `cancelled` guard prevents setState on an
   * unmounted component, and the interval is cleared in the cleanup
   * function so we don't leak timers when the user navigates away or
   * logs out.
   */
  useEffect(() => {
    let cancelled = false;
    const fetchUnread = async () => {
      try {
        // Ask the COUNTER, not the list.
        //
        // This used to fetch /notifications and filter it in the browser. That list
        // is capped server-side at the 50 newest rows with no way to ask for more,
        // so a user with more than 50 unread was shown "50" forever — the number
        // stopped being true exactly when it mattered most. It also pulled 50 full
        // rows every 30 seconds to derive one integer.
        //
        // /notifications/unread-count runs a single COUNT with no cap and has
        // existed all along (system/notifications.js getUnreadCount).
        const result = await api.get<UnreadCountBody>('/notifications/unread-count');
        if (cancelled) return;
        if (result.success && result.data) {
          // That route answers `{ success, count }` with no `data` key, and the
          // client unwraps `body.data ?? body` (api-client.ts:503) — so the whole
          // body lands on `result.data` and the count sits directly on it.
          const raw = (result.data as UnreadCountBody)?.count;
          // A non-number means the shape changed; treat it as UNKNOWN and hide the
          // dot rather than rendering NaN or a confident zero.
          setUnreadCount(typeof raw === 'number' && Number.isFinite(raw) ? raw : null);
        } else {
          // Backend returned `{ success: false }` — treat as "unknown",
          // hide the dot rather than show a misleading one.
          setUnreadCount(null);
        }
      } catch {
        // Network failure or auth error — silent fail, hide dot.
        if (!cancelled) setUnreadCount(null);
      }
    };
    void fetchUnread();
    const intervalId = setInterval(() => {
      void fetchUnread();
    }, UNREAD_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, []);

  const toggleTheme = () => {
    const newDark = !isDark;
    setIsDark(newDark);
    localStorage.setItem('theme', newDark ? 'dark' : 'light');
    localStorage.setItem('theme:explicit', '1');
    document.documentElement.classList.toggle('dark', newDark);
    document.documentElement.setAttribute('data-color-scheme', newDark ? 'dark' : 'light');
    window.dispatchEvent(new Event('storage'));
  };

  const handleLogout = () => {
    AuthService.logout();
    router.replace(role === 'health' ? HEALTH_LOGIN_ROUTE : PROVIDER_LOGIN_ROUTE);
  };

  const displayName =
    [user?.firstName, user?.lastName].filter(Boolean).join(' ') || user?.email || 'ผู้ใช้งาน';

  /**
   * Task 5 (N3) — nav-config-driven bottom nav, health only. This layout
   * ONLY reads hasActiveCert/certsLoaded (การปลูก's lock state) — it never
   * reads pendingActions/unpaid, so `chips: false` keeps it from ever
   * firing the unused /api/applications/my GET (fix round 1, reviewer
   * finding: that GET was firing, unconsumed, on EVERY health page).
   * `certLock` stays off entirely for provider — DashboardLayout wraps
   * both portals, and provider has no cert-lock concept.
   */
  const chips = useNavChips({ chips: false, certLock: role === 'health' });

  /**
   * F-7 fix — DashboardLayout wraps every /health/* route (app/health/
   * layout.tsx), and /health/home's own client-view ALSO calls
   * useNavChips() for the same cert-lock half, which used to mean two
   * /api/certificates/my GETs per page load. Provide this layout's OWN
   * fetch result to descendants via NavCertLockContext — a nested
   * useNavChips() call detects the provider and reuses this value instead
   * of firing its own. `null` for provider (no cert-lock concept there;
   * a nested useNavChips() call falls back to its own independent fetch,
   * same as when there is no ancestor DashboardLayout at all).
   */
  const certLockContextValue = useMemo(
    () =>
      role === 'health'
        ? { hasActiveCert: chips.hasActiveCert, certsLoaded: chips.certsLoaded, certError: chips.certError }
        : null,
    [role, chips.hasActiveCert, chips.certsLoaded, chips.certError],
  );

  // Task 3 (W10): the health portal only ever holds FARMER_NAV (canonical
  // role is always 'health' there); the provider portal holds many
  // canonical roles behind the shared 'provider' domain flag, resolved by
  // the caller and passed in as `canonicalRole`.
  const bottomNavCanonicalRole = role === 'health' ? 'health' : canonicalRole;

  const bottomNavItems = useMemo(() => {
    return getNavForRole(bottomNavCanonicalRole)
      .filter((item) => item.bottomNav === true)
      .map((item) => ({
        key: item.key,
        path: item.path,
        label: item.shortTH ?? item.labelTH,
        Icon: item.icon,
        // Presentation-only, same gate as the tile-home grid (task 2) —
        // the destination page still enforces the real access rule. Stays
        // unlocked-looking until the certs fetch resolves (unknown != locked).
        // Officer nav items never declare `lock`, so this is always false
        // for them — same code path, no branch needed.
        locked: Boolean(
          item.lock?.condition === 'ACTIVE_CERT_REQUIRED' &&
            chips.certsLoaded &&
            !chips.hasActiveCert,
        ),
      }));
  }, [bottomNavCanonicalRole, chips.certsLoaded, chips.hasActiveCert]);

  const isActive = (href: string) => {
    const dashPaths = ['/health/dashboard', '/provider/dashboard'];
    if (dashPaths.includes(href)) return pathname === href;
    return pathname === href || pathname.startsWith(href);
  };

  // Slim bar keeps the logo as the only way back — role home, not the
  // retired /health/dashboard, /provider/dashboard landing (N2 design).
  const homeHref = role === 'health' ? '/health/home' : '/provider/home';

  // Task 1 (D1/D2, W10) — shell-level BackHomeCrumb. Never on the home
  // page itself (pathname === homeHref); `hideBackHomeCrumb` is the
  // caller's explicit opt-out for a page with its own back control.
  const showBackHomeCrumb = !hideBackHomeCrumb && pathname !== homeHref;
  const backHomeCrumbLabel = pathname ? findNavLabelForPath(pathname) : undefined;

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* ═══════════════════════════════════════════════════════
          TOP NAVBAR — slim bar (N2): logo + toggles + bell + avatar
          dropdown only, no menu links (desktop or mobile). Bottom tabs
          remain the primary mobile nav; inner pages carry BackHomeCrumb.
         ═══════════════════════════════════════════════════════ */}
      <header className="gov-topbar">
        {/* Slim bar (N2, tile-home-redesign) — logo only on the left;
            EntitySwitcher, toggles, bell, and the avatar dropdown on the
            right. The desktop menu-link row + "เพิ่มเติม" overflow menu are
            retired — every destination now lives inside the role's
            tile-home page, and inner pages render BackHomeCrumb in the
            menu row's place. */}
        <div className="flex h-full items-center justify-between gap-2 px-4 lg:px-8">
          {/* Brand — links back to the role's tile-home, not the retired
              /health/dashboard, /provider/dashboard landing. */}
          {/* The wordmark below is `hidden sm:flex`, and the seal carries alt="" as a
              decorative image, so at 390px this link had NO accessible name at all —
              axe `link-name`, serious, on 30 of 31 logged-in routes. A screen-reader
              user met an unlabelled link on every page. The label names the
              DESTINATION, which is what a link's name is for. */}
          <Link href={homeHref} aria-label={`${brandName} — หน้าหลัก`} className="flex shrink-0 items-center gap-2.5">
            {/* Official DTAM/MOPH seal, not a generic glyph — owner directive
                (Thai-100% + branding wave): government surfaces carry the
                department's mark. White tile so the seal reads on the green
                gradient. The brandIcon prop is retained in the interface for
                caller compatibility but no longer rendered here. */}
            <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-xl bg-white">
              <Image
                src="/images/dtam-seal.png"
                alt=""
                width={32}
                height={32}
                className="h-8 w-8 object-contain"
                priority
              />
            </div>
            <div className="hidden flex-col sm:flex">
              <span className="text-sm font-bold leading-tight tracking-tight text-white">
                {brandName}
              </span>
              <span className="text-[10px] leading-tight text-white/60">
                ระบบรับรองมาตรฐาน GACP
              </span>
            </div>
          </Link>

          {/* Right: Workspace switcher + Theme toggle + Language + Bell + Avatar */}
          <div className="flex shrink-0 items-center gap-1.5 lg:gap-3">
            {/* Wave C — workspace switcher (Google Ads / Stripe pattern).
                Health users only. Providers scope by Application instead. */}
            <EntitySwitcher hidden={role !== 'health'} />

            {/* Theme toggle — min 44x44 for touch */}
            <button
              type="button"
              onClick={toggleTheme}
              className="flex h-11 w-11 items-center justify-center rounded-full text-white/80 transition-colors hover:bg-white/10 hover:text-white"
              aria-label={isDark ? 'เปิดโหมดสว่าง' : 'เปิดโหมดมืด'}
            >
              {isDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
            </button>

            {/* Y1-FIX-A — Language toggle. Pre-Y1 both HEALTH and PROVIDER
                portals were locked to the session locale post-login (X2-A
                §6); users had to navigate to /health/settings to change
                language (HEALTH) or had no toggle at all (PROVIDER).
                Mounted here between Theme and Bell so it sits in the
                topbar's universal control cluster, matching the auth-page
                position pattern (`<Globe /> + EN/TH`). */}
            <LanguageToggle />

            {/* Notifications — X1-FIX-D / H-1: badge is now data-driven.
                - unreadCount === null  → unknown/error → NO dot (fail-safe)
                - unreadCount === 0     → no dot
                - unreadCount 1-9       → numeric badge
                - unreadCount > 9       → "9+" badge
                The aria-label is updated dynamically so screen-reader
                users hear the unread count instead of a generic "notify".
            */}
            <Button
              variant="ghost"
              size="icon"
              className="relative h-11 w-11 rounded-full text-white/80 hover:bg-white/10 hover:text-white"
              onClick={() => router.push(`/${role === 'health' ? 'health' : 'provider'}/notifications`)}
              aria-label={
                unreadCount && unreadCount > 0
                  ? `แจ้งเตือน (${unreadCount > 9 ? 'มากกว่า 9' : unreadCount} รายการที่ยังไม่อ่าน)`
                  : 'แจ้งเตือน'
              }
            >
              <Bell className="h-5 w-5" aria-hidden="true" />
              {unreadCount !== null && unreadCount > 0 ? (
                <span
                  data-testid="bell-unread-badge"
                  className="absolute right-1 top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white ring-2 ring-primary"
                  aria-hidden="true"
                >
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              ) : null}
            </Button>

            {/* Avatar dropdown (N2/N7) — replaces the old direct-to-profile
                click. Holds โปรไฟล์ + ออกจากระบบ, the only two destinations
                the retired menu row keeps in the slim bar; every other
                destination moved into the tile-home page. Built on the
                DropdownMenu primitive (Radix) — NOT a hand-rolled widget —
                so focus trap, roving tabindex, Escape/outside dismiss, and
                portal rendering come from the audited primitive, not a
                bespoke reimplementation of them. */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex h-11 items-center gap-2 rounded-full p-1 transition-colors hover:bg-white/10"
                  aria-label="บัญชีผู้ใช้"
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20 text-sm font-bold text-white">
                    {displayName.charAt(0).toUpperCase()}
                  </div>
                  <span className="hidden text-sm font-medium text-white md:block">
                    {displayName}
                  </span>
                  <ChevronDown className="hidden h-4 w-4 text-white/60 md:block" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem asChild>
                  <Link href={`/${role}/profile`}>โปรไฟล์</Link>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={handleLogout} className="text-foreground focus:text-destructive">
                  ออกจากระบบ
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      {/* ═══════════════════════════════════════════════════════
          PAGE CONTENT — with bottom padding for mobile tab bar.
          X1-FIX-D / H-8: `id="main-content"` is the canonical target
          of the global skip-link rendered by `src/app/layout.tsx:106`.
          Without this id the "ข้ามไปยังเนื้อหาหลัก" link is a no-op
          for keyboard / screen-reader users on every HEALTH + PROVIDER
          page (WCAG 2.4.1 Bypass Blocks AA).
          `tabIndex={-1}` makes `<main>` programmatically focusable
          when the user follows the skip-link, without inserting it
          into the natural tab order.
         ═══════════════════════════════════════════════════════ */}
      <main
        id="main-content"
        tabIndex={-1}
        className="animate-fade-in p-4 pb-24 outline-none lg:p-8 lg:pb-8"
      >
        {/* Single content width standard (2026-06-11): owner directive — EVERY in-shell
            page (health + provider; admin uses its own grid shell with the same cap)
            shares ONE container width so switching pages never makes the layout jump.
            max-w-7xl (1280px) centered. This supersedes the 2026-06-10 full-width pass:
            full-width made pages with their own caps look inconsistent. <main> supplies
            the gutter (p-4 / lg:p-8); pages render full-bleed inside this cap (no per-page
            max-w). Document/print/viewer pages keep their own narrower width as the only
            intentional exception. */}
        <div className="mx-auto w-full max-w-7xl">
          {/* Task 1 (D1/D2, W10) — shell-level BackHomeCrumb: every inner
              page gets a "← หน้าหลัก" affordance by default (see the
              DashboardLayoutProps doc comment for the two escape hatches).
              `current` is auto-filled from nav-config; renders link-only
              when nothing matches. */}
          {showBackHomeCrumb ? (
            <div className="mb-4">
              {/* exactOptionalPropertyTypes: BackHomeCrumbProps.current is
                  `string | undefined` in the optional-prop sense (omit the
                  key entirely), not "may be assigned undefined" — so the
                  key is only spread in when a label was actually found. */}
              <BackHomeCrumb
                homePath={homeHref}
                {...(backHomeCrumbLabel !== undefined ? { current: backHomeCrumbLabel } : {})}
              />
            </div>
          ) : null}
          {/* F-7 fix — share this layout's cert-lock fetch with any nested
              useNavChips() call (e.g. /health/home) instead of letting it
              fire a second /api/certificates/my GET. See NavCertLockContext
              in use-nav-chips.ts. */}
          <NavCertLockContext.Provider value={certLockContextValue}>
            {children}
          </NavCertLockContext.Provider>
        </div>
      </main>

      {/* ═══════════════════════════════════════════════════════
          MOBILE BOTTOM TAB BAR — primary nav on mobile, hidden on lg+
          Task 3 (W10): ONE shared render path for every role (farmer AND
          every officer role) — see `bottomNavItems` above. This replaces
          the prior role === 'health' ? ... : ... fork.
         ═══════════════════════════════════════════════════════ */}
      <nav className="gov-bottom-nav" aria-label="หน้าหลัก">
        {bottomNavItems.map((item) => {
          if (item.locked) {
            return (
              <span
                key={item.key}
                data-testid="bottom-nav-item"
                className="gov-bottom-nav-item cursor-not-allowed text-muted-foreground"
                aria-disabled="true"
              >
                <item.Icon className="h-5 w-5" aria-hidden="true" focusable="false" />
                <span className="inline-flex items-center gap-1">
                  {item.label}
                  <Lock className="h-3 w-3" aria-hidden="true" focusable="false" />
                </span>
              </span>
            );
          }
          const active = isActive(item.path);
          return (
            <Link
              key={item.key}
              href={item.path}
              data-testid="bottom-nav-item"
              className={cn(
                'gov-bottom-nav-item',
                active && 'gov-bottom-nav-item--active'
              )}
              aria-current={active ? 'page' : undefined}
            >
              <item.Icon className="h-5 w-5" aria-hidden="true" focusable="false" />
              <span>{item.label}</span>
            </Link>
          );
        })}

        {/* Task 7 (tile-home-nav, N3): the trailing "ออก" logout button here
            was a 6th item beyond N3's exact 5-item bottom-nav set. Removed —
            logout lives in the avatar dropdown (โปรไฟล์ + ออกจากระบบ, above),
            which renders on every viewport, not just desktop. */}
      </nav>

      {/* ═══════════════════════════════════════════════════════
          PERSISTENT FOOTER — Phase A5 §4.2.
          Hidden on mobile (gov-bottom-nav already provides ministry
          attribution implicitly via the Government banner up top), shown
          on lg+ where there's room without colliding with the bottom nav.
         ═══════════════════════════════════════════════════════ */}
      <div className="hidden lg:block">
        <Footer />
      </div>
    </div>
  );
}
