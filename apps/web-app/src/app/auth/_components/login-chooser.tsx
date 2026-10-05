'use client';

/**
 * UI-01 — GACP login/landing chooser ("two doors").
 *
 * Public entry point at `/auth`. Presents an equal-weight choice between the
 * citizen/farmer login and the officer login, replacing the old pattern where
 * every generic "เข้าสู่ระบบ" link (marketing header, hero, bottom CTA — see
 * `components/marketing/marketing-header.tsx` and `(marketing)/page.tsx`)
 * went straight to `/auth/health/login`, burying the officer entrance behind
 * a small "สำหรับเจ้าหน้าที่" text link on the health login form
 * (`auth/_components/health-login-page.tsx`).
 *
 * NO PROVIDER STATUS IS WRITTEN IN THIS FILE. Every IdP button's state comes
 * from `GET /api/auth/idp/providers`, which serves the backend registry's
 * fail-closed resolver (`apps/backend/config/auth-providers.js`) as
 * `{key, state, enabled}` rows and nothing else. This replaced a boolean constant
 * that froze ThaID's badge on, whose whole problem was that no credential an
 * operator delivered could clear a badge without a code change and a deploy —
 * the opposite of what a status badge is for. When the seven `AUTH_THAID_*`
 * values land in the environment, the registry flips to `enabled`, this page
 * stops badging the button, and no commit happens. The test file pins that
 * the old constant's name never comes back.
 *
 * Fail-closed in the same direction as the backend: while the states are
 * loading the IdP buttons are disabled and unbadged (a badge would be a
 * guess); if the feed errors or answers a shape we do not recognise, every
 * IdP button is badged "ตรวจสถานะไม่ได้" and starts no OAuth call, while the
 * temporary local-password doors stay open so the page is never a dead end.
 *
 * Not built at the literal `/` route in this file, on purpose: the root's
 * own page owns that decision — and since E1 Task 4, `(marketing)/page.tsx`
 * exercises it by redirecting `/` here, making this page the front door by
 * the operator's decision (ThaID/MorPromt are the ministry-mandated entry
 * paths). The separation stands: this file renders the chooser wherever it is
 * mounted; the root's page decides what the root is.
 *
 * T6 (operator directive, 2026-08-19 — recorded in
 * design notes Ruling 4):
 * "ไม่ใช่แค่ป๊อปอัพออก แต่ต้องกดปุ่ม ThaiD กับ หมอพร้อม เข้าไปได้จริง" — the
 * `thaid` and `healthid` cards ONLY are now ALWAYS pressable regardless of
 * the registry state (the coming_soon/unknown badge still renders — it is
 * informational, not a click gate). Their click always fires the SAME
 * authorize-url POST an enabled provider fires; the backend is the sole
 * arbiter of "ready or not" and a not-ready answer renders an honest
 * message IN-FLOW on the card, not the "รอการเชื่อมต่อ" dialog below — that
 * dialog stays reserved for `providerid`, untouched by this directive.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Check, Info, Moon, ShieldCheck, Sprout, Sun } from 'lucide-react';
import { Button, type ButtonProps } from '@/components/ui/primitives/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/primitives/dialog';
import { useAppTheme } from '@/components/theme';
import { HEALTH_LOGIN_ROUTE, PROVIDER_LOGIN_ROUTE } from '@/lib/constants/auth-routes';
import { idpFetch } from '@/lib/api/idp-client';
import { resolveErrorCode } from '@/lib/i18n/error-code-map';
import { cn } from '@/lib/utils';

/** Registry keys, verbatim from `auth-providers.js` PROVIDER_KEYS. */
type ProviderKey = 'healthid' | 'providerid' | 'thaid';

type IdpOption = {
  id: string;
  /** Which registry row decides this button. `thaid-citizen` and
   *  `thaid-officer` are two cards driven by the single `thaid` row. */
  providerKey: ProviderKey;
  label: string;
  sub: string;
  primary?: boolean;
};

type DoorAccent = 'leaf' | 'officer';

type DoorConfig = {
  id: 'citizen' | 'officer';
  accent: DoorAccent;
  icon: typeof Sprout;
  title: string;
  who: string;
  checklistLabel: string;
  checklist: string[];
  idpOptions: IdpOption[];
  localLabel: string;
  localHref: string;
};

const DOORS: readonly DoorConfig[] = [
  {
    id: 'citizen',
    accent: 'leaf',
    icon: Sprout,
    title: 'สำหรับประชาชน · เกษตรกร',
    who: 'ผู้ขอรับรอง / เจ้าของแปลง / วิสาหกิจชุมชน',
    checklistLabel: 'เลือกด้านนี้ถ้าคุณต้องการ',
    checklist: [
      'ยื่นคำขอรับรองแปลง/ผลิตภัณฑ์สมุนไพร GACP',
      'ติดตามสถานะคำขอ และชำระค่าบริการ',
      'ดาวน์โหลดใบรับรองและ QR ของตนเอง',
    ],
    idpOptions: [
      {
        id: 'health-id',
        providerKey: 'healthid',
        label: 'Health ID',
        sub: 'ยืนยันตัวตนด้วยหมอพร้อม (Health ID ของ สธ.)',
        primary: true,
      },
      {
        id: 'thaid-citizen',
        providerKey: 'thaid',
        label: 'ThaID',
        sub: 'บัตรประชาชนดิจิทัล (กรมการปกครอง)',
      },
    ],
    localLabel: 'เข้าด้วยเลขบัตรประชาชน + รหัสผ่าน (ชั่วคราว)',
    localHref: HEALTH_LOGIN_ROUTE,
  },
  {
    id: 'officer',
    accent: 'officer',
    icon: ShieldCheck,
    title: 'สำหรับเจ้าหน้าที่',
    who: 'ผู้ปฏิบัติงานของกรมฯ และผู้ให้บริการตรวจประเมิน',
    checklistLabel: 'เลือกด้านนี้ถ้าคุณเป็น',
    checklist: [
      'ผู้ตรวจเอกสาร หรือ ผู้ตรวจประเมิน',
      'ผู้จัดตารางตรวจ หรือ เจ้าหน้าที่การเงิน',
      'ผู้ดูแลระบบของกรม',
    ],
    idpOptions: [
      {
        id: 'provider-id',
        providerKey: 'providerid',
        label: 'Provider ID',
        sub: 'บัญชีเจ้าหน้าที่ (สำนักสุขภาพดิจิทัล)',
        primary: true,
      },
      {
        id: 'thaid-officer',
        providerKey: 'thaid',
        label: 'ThaID',
        sub: 'บัตรประชาชนดิจิทัล (กรมการปกครอง)',
      },
    ],
    localLabel: 'เข้าด้วยเลขบัตร + รหัสผ่าน (ชั่วคราว)',
    localHref: PROVIDER_LOGIN_ROUTE,
  },
] as const;

// Per-accent classes. `leaf` reuses the shared Button `primary` variant
// as-is (it already IS bg-leaf-700/hover:bg-leaf-800/shadow-leaf-btn — a
// perfect match, zero overrides). `officer` opts OUT of the variant
// (`variant={null}`) and supplies every color/shadow class itself, so there
// is no risk of a leaf-colored class silently surviving a twMerge conflict
// that tailwind-merge doesn't know how to arbitrate for the custom
// `leaf-btn`/`officer-btn` shadow keys.
const ACCENT: Record<DoorAccent, {
  bar: string;
  iconWrap: string;
  tint: string;
  label: string;
  check: string;
  /** Ink for the status chip, whose ground is bg-white in BOTH themes. */
  chip: string;
  outlineHover: string;
  primaryVariant: Exclude<ButtonProps['variant'], undefined>;
  primaryClassName: string;
}> = {
  leaf: {
    bar: 'bg-leaf-700',
    iconWrap: 'bg-leaf-soft text-leaf-onSoft',
    tint: 'bg-leaf-soft',
    label: 'text-leaf-onSoft',
    check: 'text-leaf-onSoft',
    // The status chip's ground is bg-white in BOTH themes, so it keeps the dark
    // ink. Using the on-soft green there measured 1.71:1 on staging — the same
    // mistake as the surfaces, one layer in.
    chip: 'text-leaf-700',
    outlineHover: 'hover:border-leaf-300',
    primaryVariant: 'primary',
    primaryClassName: '',
  },
  officer: {
    bar: 'bg-officer-700',
    iconWrap: 'bg-officer-soft text-officer-onSoft',
    tint: 'bg-officer-soft',
    label: 'text-officer-onSoft',
    check: 'text-officer-onSoft',
    chip: 'text-officer-700',
    outlineHover: 'hover:border-officer-700/40',
    primaryVariant: null,
    primaryClassName: 'bg-officer-700 text-white shadow-officer-btn hover:bg-officer-800',
  },
};

/**
 * R-B: these three IdP calls (this feed + the authorize-url POST below) go
 * DIRECTLY to the backend origin via `idpFetch`, not through the universal
 * Next proxy — the path here stays a bare `/api/...` string, `idpFetch`
 * itself prepends `NEXT_PUBLIC_BACKEND_ORIGIN`. See idp-client.ts for why.
 */
const PROVIDERS_ENDPOINT = '/api/auth/idp/providers';
const authorizeUrlEndpoint = (providerKey: string) => `/api/auth/idp/${providerKey}/authorize-url`;

/** `null` = still asking · `'error'` = asked and could not be told. */
type ProviderStates = Record<string, { state: string; enabled: boolean }>;
type StatesFetch = ProviderStates | null | 'error';

/**
 * The four ways a button can be, derived from the registry's RESOLVED
 * `enabled` verdict — never decided in this file. The first build interpreted
 * the state string itself (`staging_only` → usable), but whether staging_only
 * is usable depends on isProduction() and the staging slot, which only the
 * backend knows; the E1 audit caught the guess. An unknown or missing key
 * falls to coming_soon, the fail-closed direction.
 */
type ButtonStatus = 'loading' | 'usable' | 'coming_soon' | 'unknown';

function statusOf(states: StatesFetch, key: string): ButtonStatus {
  if (states === null) return 'loading';
  if (states === 'error') return 'unknown';
  // `enabled` is the backend's RESOLVED verdict (isProviderEnabled), not a
  // guess from the state string. The first build mapped staging_only → usable
  // unconditionally; whether staging_only is usable depends on isProduction()
  // and the staging slot, which only the backend knows — on a real production
  // box that guess rendered a pressable button for a provider the backend
  // refuses. Caught by the E1 audit; the endpoint now ships the verdict.
  const row = states[key];
  if (!row) return 'coming_soon';
  return row.enabled ? 'usable' : 'coming_soon';
}

// Badge copy is short because the badge is 11px; the dialog carries the
// detail (spec §2.3). Three badges, three meanings, visually distinct.
const BADGE_TEXT: Record<'coming_soon' | 'unknown', string> = {
  coming_soon: 'รอการเชื่อมต่อ',
  unknown: 'ตรวจสถานะไม่ได้',
};

/**
 * Who is actually being waited on. "เร็ว ๆ นี้" tells a farmer nothing; the
 * name of the office tells them whether to keep checking or to use the
 * temporary door. Sourced from the operator decision of 2026-08-14.
 */
const BLOCKER: Record<ProviderKey, string> = {
  thaid: 'ระบบยังรอ credentials จากกรมการปกครอง',
  healthid: 'ระบบยังรอการอนุมัติเชื่อมต่อจากสำนักสุขภาพดิจิทัล สธ.',
  providerid: 'ระบบยังรอการอนุมัติเชื่อมต่อจากสำนักสุขภาพดิจิทัล สธ.',
};

type IdpNotice = { title: string; body: string };

const comingSoonNotice = (providerKey: ProviderKey, label: string): IdpNotice => ({
  title: 'รอการเชื่อมต่อ',
  body: `ขณะนี้ยังเข้าสู่ระบบด้วย ${label} ไม่ได้ ${BLOCKER[providerKey]} เมื่อเชื่อมต่อเรียบร้อย ปุ่มนี้จะใช้งานได้ทันทีโดยไม่ต้องอัปเดตแอป ระหว่างนี้ใช้ช่องทางเลขบัตรและรหัสผ่านชั่วคราวด้านล่างได้ก่อน`,
});

const unknownNotice = (label: string): IdpNotice => ({
  title: 'ตรวจสถานะไม่ได้',
  body: `ขณะนี้ระบบตรวจสถานะช่องทางยืนยันตัวตนไม่ได้ จึงยังไม่เปิดปุ่ม ${label} เพื่อไม่ให้พาไปสู่หน้าที่ใช้งานไม่ได้ กรุณาลองใหม่อีกครั้ง หรือเข้าสู่ระบบด้วยเลขบัตรและรหัสผ่านชั่วคราวด้านล่าง`,
});

const handoffFailedNotice = (label: string): IdpNotice => ({
  title: 'เชื่อมต่อไม่สำเร็จ',
  body: `เริ่มการเข้าสู่ระบบด้วย ${label} ไม่สำเร็จในขณะนี้ กรุณาลองใหม่อีกครั้ง หรือเข้าสู่ระบบด้วยเลขบัตรและรหัสผ่านชั่วคราวด้านล่าง`,
});

/**
 * T6: the two provider keys that bypass the coming_soon/unknown dialog
 * gate entirely — the click always attempts the real backend call.
 * `providerid` (and `local`, which is not a button at all) are unaffected.
 */
const ALWAYS_ENTERABLE_PROVIDERS: ReadonlySet<ProviderKey> = new Set(['thaid', 'healthid']);

/**
 * Honest in-flow copy for the ONE not-ready code these two providers can
 * actually return today: `AUTH_PROVIDER_DISABLED`. The authorize-url
 * route's OWN early `isProviderEnabled()` check (apps/backend/routes/api/
 * auth/auth-idp.js:456-458) answers before `getIdpAdapter`'s finer-grained
 * `assertProviderReady` codes (`AUTH_PROVIDER_NOT_CONFIGURED`,
 * config/auth-providers.js:205-215) can ever fire from this call — a
 * `coming_soon` state and an "enabled but config incomplete" request both
 * collapse to the same `isProviderEnabled() === false` verdict
 * (`getEffectiveState`, config/auth-providers.js:126-134) before the route
 * ever reaches `getIdpAdapter`. `AUTH_PROVIDER_NO_ADAPTER`
 * (services/auth/idp/idp-adapter.js:41-44) is real but reachable only if
 * healthid's env were ever completed before an adapter exists — no adapter
 * is written for T6 (ห้ามเดา stands per Ruling 4(b)). Every code not listed
 * here — including that one — falls through `resolveErrorCode`'s own
 * `messageTh` preference: the catalog (apps/backend/shared/error-codes.js)
 * already ships honest, specific Thai copy per code.
 */
const NOT_READY_ERROR_MAP: Partial<Record<ProviderKey, Readonly<Record<string, string>>>> = {
  healthid: {
    AUTH_PROVIDER_DISABLED:
      'หมอพร้อมยังไม่เปิดให้เชื่อมต่อ อยู่ระหว่างดำเนินการขอสิทธิ์เชื่อมต่อกับกระทรวงสาธารณสุข ระหว่างนี้เข้าสู่ระบบด้วยเลขบัตรประชาชนและรหัสผ่านชั่วคราวด้านล่างได้ก่อน',
  },
  thaid: {
    AUTH_PROVIDER_DISABLED:
      'ThaID ยังไม่เปิดให้เชื่อมต่อ ระบบยังไม่ได้รับการตั้งค่าเชื่อมต่อกับกรมการปกครอง ระหว่างนี้เข้าสู่ระบบด้วยเลขบัตรประชาชนและรหัสผ่านชั่วคราวด้านล่างได้ก่อน',
  },
};

const NOT_READY_FALLBACK_TH =
  'ยังเข้าสู่ระบบด้วยช่องทางนี้ไม่ได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง หรือเข้าสู่ระบบด้วยเลขบัตรประชาชนและรหัสผ่านชั่วคราวด้านล่าง';
const CONNECTION_FAILED_TH = 'ไม่สามารถเชื่อมต่อระบบได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง';

export default function LoginChooser() {
  const { colorScheme, toggleColorScheme } = useAppTheme();
  const [notice, setNotice] = useState<IdpNotice | null>(null);
  const [providerStates, setProviderStates] = useState<StatesFetch>(null);
  // T6: per-OPTION (not per-provider) in-flow notices — ThaID renders as two
  // separate cards (citizen door + officer door) that must carry
  // independent messages if both are clicked.
  const [inFlowNotice, setInFlowNotice] = useState<Record<string, string>>({});

  // States only, fetched once on mount and never cached by the endpoint —
  // that is what makes an env change on the box visible without a deploy.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await idpFetch(PROVIDERS_ENDPOINT);
        const json: unknown = await res.json();
        const list = (json as { data?: { providers?: unknown } } | null)?.data?.providers;
        if (!res.ok || !Array.isArray(list)) {
          throw new Error('provider states unavailable');
        }
        const next: ProviderStates = {};
        for (const entry of list) {
          const row = entry as { key?: unknown; state?: unknown; enabled?: unknown };
          if (typeof row?.key === 'string' && typeof row?.state === 'string' && typeof row?.enabled === 'boolean') {
            next[row.key] = { state: row.state, enabled: row.enabled };
          }
        }
        if (!cancelled) setProviderStates(next);
      } catch {
        // Fail closed: an unreadable feed is not permission to guess.
        if (!cancelled) setProviderStates('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Generalised from the old thaid-only handler: the provider key is now part
  // of the path, so one function drives every IdP on the page.
  // Fallback behaviour is unchanged — a backend hiccup opens the dialog
  // rather than leaving a dead button.
  const beginIdp = async (providerKey: string, label: string) => {
    try {
      const res = await idpFetch(authorizeUrlEndpoint(providerKey), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const json: unknown = await res.json().catch(() => null);
      const url = (json as { data?: { authorizeUrl?: unknown } } | null)?.data?.authorizeUrl;
      if (res.ok && typeof url === 'string' && url) {
        window.location.href = url;
        return;
      }
    } catch {
      // fall through to the notice dialog on any failure
    }
    setNotice(handoffFailedNotice(label));
  };

  /**
   * T6: the always-enterable path for thaid/healthid. Same call `beginIdp`
   * makes (same endpoint, same success branch — redirect flow is byte-
   * identical to an enabled provider), but a failure never opens the
   * dialog: it sets a per-OPTION in-flow message instead. Local map first
   * (operator-directed exact copy for the one code this call actually
   * returns today), then the backend's own `messageTh`, then a generic
   * fallback — `resolveErrorCode`'s existing idiom (client-view.tsx), reused
   * as-is rather than re-invented.
   */
  const beginAlwaysEnterableIdp = async (optionId: string, providerKey: ProviderKey) => {
    setInFlowNotice((prev) => {
      if (!(optionId in prev)) return prev;
      const next = { ...prev };
      delete next[optionId];
      return next;
    });
    try {
      const res = await idpFetch(authorizeUrlEndpoint(providerKey), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const json: unknown = await res.json().catch(() => null);
      const url = (json as { data?: { authorizeUrl?: unknown } } | null)?.data?.authorizeUrl;
      if (res.ok && typeof url === 'string' && url) {
        window.location.href = url;
        return;
      }
      const envelope = json as { code?: string; error?: string; message?: string; messageTh?: string } | null;
      const message = resolveErrorCode(envelope, NOT_READY_ERROR_MAP[providerKey] ?? {}, NOT_READY_FALLBACK_TH);
      setInFlowNotice((prev) => ({ ...prev, [optionId]: message }));
    } catch {
      // Network/timeout — indeterminate, not a proven "not ready" (mirrors
      // client-view.tsx's own catch-branch wording/reasoning).
      setInFlowNotice((prev) => ({ ...prev, [optionId]: CONNECTION_FAILED_TH }));
    }
  };

  const pressIdp = (
    status: ButtonStatus,
    providerKey: ProviderKey,
    label: string,
  ) => {
    if (status === 'usable') {
      void beginIdp(providerKey, label);
      return;
    }
    setNotice(status === 'unknown' ? unknownNotice(label) : comingSoonNotice(providerKey, label));
  };

  const isDark = colorScheme === 'dark';
  const statesLoading = providerStates === null;

  return (
    <main id="main-content" className="min-h-screen bg-background px-4 py-8 sm:px-6 lg:px-8">
      {/* a11y: while states load the IdP buttons are disabled with no visual
          change a screen reader can perceive — say it once, politely. */}
      <span role="status" aria-live="polite" className="sr-only">
        {statesLoading ? 'กำลังตรวจสถานะช่องทางเข้าสู่ระบบ' : ''}
      </span>
      <div className="mx-auto max-w-5xl">
        <header className="flex items-center justify-between gap-4 pb-6">
          <Link
            href="/"
            className="flex min-w-0 items-center gap-3 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {/* ตรากรมการแพทย์แผนไทยฯ ของจริง — operator ยืนยันสิทธิ์ใช้ตรา 2026-09-06
                ("ผ่านการได้รับอนุญาตแล้ว") แทน placeholder "รอตรา ครุฑ" ที่กันที่ไว้
                ระหว่างรออนุญาต · ไฟล์เดียวกับที่หน้า login ย่อยและ dashboard ใช้อยู่ */}
            <Image
              src="/images/dtam-seal.png"
              alt="ตรากรมการแพทย์แผนไทยและการแพทย์ทางเลือก"
              width={44}
              height={44}
              priority
              className="h-11 w-11 flex-none object-contain"
            />
            <span className="min-w-0 text-left leading-tight">
              <span className="block truncate text-base font-bold text-foreground">
                ระบบรับรอง GACP สมุนไพร
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                กรมการแพทย์แผนไทยและการแพทย์ทางเลือก (DTAM) · Good Agricultural &amp; Collection Practices
              </span>
            </span>
          </Link>

          <button
            type="button"
            onClick={toggleColorScheme}
            className="flex h-10 w-10 flex-none items-center justify-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            aria-label={isDark ? 'สลับเป็นโหมดสว่าง' : 'สลับเป็นโหมดมืด'}
          >
            {isDark ? (
              <Sun className="h-[18px] w-[18px]" aria-hidden="true" />
            ) : (
              <Moon className="h-[18px] w-[18px]" aria-hidden="true" />
            )}
          </button>
        </header>

        <section className="page-enter py-4 text-center sm:py-6">
          <h1 className="text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">เข้าสู่ระบบ</h1>
          {/* 2026-09-06: บรรทัดนี้เคยบรรยายบริการโทรเวชกรรม "ผ่านระบบนัดหมาย ปรึกษาแพทย์ และ
              ติดตามการรักษาออนไลน์" ซึ่งไม่ใช่สิ่งที่แพลตฟอร์มนี้ทำเลยสักอย่าง · เห็นตอน operator
              เปิดหน้านี้จากมือถือหลังเปิดม่าน demo — เป็นประโยคแรกที่เกษตรกรอ่านบนประตูหน้าสุด */}
          <p className="mx-auto mt-2 max-w-2xl text-base text-muted-foreground">
            ระบบรับรองมาตรฐาน GACP สำหรับแปลงปลูกและผลิตภัณฑ์สมุนไพร ยื่นคำขอ ติดตามสถานะ <span className="whitespace-nowrap">ชำระค่าบริการ</span> และรับใบรับรองพร้อม QR
          </p>
        </section>

        <div className="page-enter grid gap-5 md:grid-cols-2">
          {DOORS.map((door) => {
            const accent = ACCENT[door.accent];
            const Icon = door.icon;
            const headingId = `door-${door.id}-heading`;
            return (
              <section
                key={door.id}
                aria-labelledby={headingId}
                className="flex flex-col gap-4 overflow-hidden rounded-[1.375rem] border border-border bg-card p-5 shadow-leaf-card sm:p-6"
              >
                <span aria-hidden="true" className={cn('-mx-5 -mt-5 h-1 sm:-mx-6 sm:-mt-6', accent.bar)} />

                <div className="flex items-center gap-3">
                  <span
                    aria-hidden="true"
                    className={cn('flex h-12 w-12 flex-none items-center justify-center rounded-2xl', accent.iconWrap)}
                  >
                    <Icon className="h-6 w-6" aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <h2 id={headingId} className="text-lg font-bold leading-snug text-foreground">
                      {door.title}
                    </h2>
                    <p className="mt-0.5 text-sm text-muted-foreground">{door.who}</p>
                  </div>
                </div>

                <div className={cn('rounded-xl p-4', accent.tint)}>
                  <p className={cn('mb-2.5 text-xs font-bold', accent.label)}>{door.checklistLabel}</p>
                  <ul className="grid gap-2.5">
                    {door.checklist.map((item) => (
                      <li key={item} className="flex items-start gap-2.5 text-sm text-foreground/90">
                        <Check className={cn('mt-0.5 h-4 w-4 flex-none', accent.check)} aria-hidden="true" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="grid gap-2.5">
                  {door.idpOptions.map((option) => {
                    const status = statusOf(providerStates, option.providerKey);
                    const badge = status === 'coming_soon' || status === 'unknown'
                      ? BADGE_TEXT[status]
                      : null;
                    // T6: thaid/healthid ignore `status` for click-gating and
                    // disabling — the badge above still reflects it, but the
                    // button itself is always live. providerid keeps the
                    // original dialog-gated behaviour untouched.
                    const alwaysEnterable = ALWAYS_ENTERABLE_PROVIDERS.has(option.providerKey);
                    const inFlowMessage = alwaysEnterable ? inFlowNotice[option.id] : undefined;
                    return (
                      <div key={option.id} className="flex flex-col gap-2">
                        <Button
                          type="button"
                          // A door that is not connected yet must not be the loudest
                          // thing on the page. The biggest, greenest, most
                          // button-shaped elements here were the two IdP doors, both
                          // carrying a "รอการเชื่อมต่อ" chip, while the only working
                          // path was a small underlined link below a divider — the
                          // hierarchy read backwards and taught users that the
                          // handsome control is the dead one
                          // (evidence/apple-qa-audit-2026-09-07). Keyed on `badge`,
                          // not on one status value: the badge is already the
                          // page's own statement that this door is not ready
                          // (coming_soon OR unknown), so demoting exactly when it
                          // shows keeps the two from ever disagreeing. First cut
                          // checked `status !== 'coming_soon'` and left the officer
                          // door solid teal on staging, because its status reads
                          // `unknown`. When a provider goes live the badge
                          // disappears and the brand treatment returns by itself.
                          variant={option.primary && !badge ? accent.primaryVariant : 'outline'}
                          disabled={!alwaysEnterable && status === 'loading'}
                          className={cn(
                            'h-auto w-full justify-start gap-3 whitespace-normal rounded-xl px-4 py-3 text-left',
                            // Two independent colour paths: `primaryVariant` for the
                            // citizen door and `primaryClassName` for the officer one
                            // (officer sets primaryVariant: null and paints itself).
                            // Demoting only the variant left the officer door solid
                            // teal on staging with its own 'รอการเชื่อมต่อ' chip beside
                            // it. Both paths key on the same `badge`.
                            option.primary && !badge ? accent.primaryClassName : accent.outlineHover,
                          )}
                          onClick={() => {
                            if (alwaysEnterable) {
                              void beginAlwaysEnterableIdp(option.id, option.providerKey);
                              return;
                            }
                            pressIdp(status, option.providerKey, option.label);
                          }}
                        >
                          <span className="flex min-w-0 flex-1 flex-col">
                            <span className="text-sm font-semibold">เข้าด้วย {option.label}</span>
                            <span
                              className={cn(
                                'text-xs font-normal',
                                // Alpha cannot buy contrast: white/80 over leaf-700 composites
                                // to #d1e6d9 = 3.82:1. Full white on that ground is 5.00:1.
                                option.primary ? 'text-white' : 'text-muted-foreground',
                              )}
                            >
                              {option.sub}
                            </span>
                          </span>
                          {badge && (
                            <span
                              className={cn(
                                'flex-none rounded-full px-2 py-0.5 text-[11px] font-bold',
                                status === 'unknown' && 'border border-dashed',
                                // Solid chips: the old bg-white/20-on-leaf-700 measured below WCAG AA
                                // (E1 deep review). White chip + the accent's own dark text on
                                // primary; amber (waiting) / slate (unknown) on outline.
                                option.primary
                                  ? cn('bg-white', accent.chip)
                                  : status === 'unknown'
                                    ? 'bg-slate-200 text-slate-900'
                                    : 'bg-amber-100 text-amber-900',
                              )}
                            >
                              {badge}
                            </span>
                          )}
                        </Button>
                        {inFlowMessage && (
                          <div
                            role="alert"
                            className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"
                          >
                            <Info className="mt-0.5 h-3.5 w-3.5 flex-none" aria-hidden="true" />
                            <span>{inFlowMessage}</span>
                          </div>
                        )}
                      </div>
                    );
                  })}

                  <div className="flex items-center gap-3 py-1 text-xs text-muted-foreground" role="presentation">
                    <span className="h-px flex-1 bg-border" aria-hidden="true" />
                    หรือ
                    <span className="h-px flex-1 bg-border" aria-hidden="true" />
                  </div>

                  {/* The door that actually works gets the primary treatment. It stays
                      a Link (same href, same route), rendered through Button's asChild
                      so it inherits the h-11 hit area and the focus ring the IdP
                      buttons above already have. */}
                  <Button asChild variant={accent.primaryVariant ?? 'primary'} className="h-11 w-full">
                    <Link href={door.localHref} className="no-underline">
                      {door.localLabel}
                    </Link>
                  </Button>
                  {/* spec §3.5: the local door is TRANSITIONAL — the backend
                      already declares it so (auth-providers.js:11), and the
                      page must say the same out loud. */}
                  <p className="text-center text-xs text-muted-foreground">
                    ช่องทางชั่วคราวระหว่างรอการเชื่อมต่อระบบยืนยันตัวตนกลาง
                  </p>
                </div>
              </section>
            );
          })}
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          ระบบรับรองมาตรฐาน GACP สมุนไพร · กรมการแพทย์แผนไทยและการแพทย์ทางเลือก
        </p>
      </div>

      <Dialog
        open={notice !== null}
        onOpenChange={(open) => {
          if (!open) setNotice(null);
        }}
      >
        <DialogContent className="text-center">
          <span
            aria-hidden="true"
            className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-leaf-soft text-leaf-onSoft"
          >
            <Info className="h-7 w-7" aria-hidden="true" />
          </span>
          <DialogTitle className="text-center text-xl">{notice?.title ?? ''}</DialogTitle>
          <DialogDescription className="text-center">{notice?.body ?? ''}</DialogDescription>
          <Button type="button" variant="primary" className="mx-auto mt-2" onClick={() => setNotice(null)}>
            เข้าใจแล้ว
          </Button>
        </DialogContent>
      </Dialog>
    </main>
  );
}
