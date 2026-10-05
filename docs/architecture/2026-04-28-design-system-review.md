# Design System + UX Audit — GACP Platform

- **Reviewer:** Plan agent (read-only)
- **Date:** 2026-04-28
- **Mode:** Read-only research
- **Reference standards:** WCAG 2.1 AA, UK Government Design System (gov.uk), USWDS, Thai DGA design guidelines, Mantine/shadcn primitives

## Executive Summary

The platform is materially further along than the "design drift" caricature. There is a real design-token spine (`apps/web-app/src/styles/globals.css` HSL CSS variables, Tailwind theme reading from those variables, semantic colors `--success/--warning/--info/--destructive`, dark-mode parity, `prefers-reduced-motion` respect, focus-visible enhancement, skeleton shimmer, status badge canonicalised via `workflow-states.ts`, 8-stage applicant model, skip-link at `app/layout.tsx`, ActionIcon a11y lint via `scripts/ci/check-ui-a11y-baseline.js`). Mobile responsiveness is solved. Thai-first locale and Prompt font are correctly chosen.

What is NOT solved is **systematisation**. There are at least three competing design sources of truth: `tailwind.config.cjs` (brand `#2c9057`), `src/styles/design-system.ts` (an unused parallel palette using emerald `#10B981`), and ad-hoc Tailwind palette tokens (`emerald-*`, `slate-*`, `amber-*`, `sky-*`, `rose-*`, `violet-*`) sprinkled across 170+ occurrences. There are two bottom navs with different label sets. There are roughly 522 raw Thai-script literals in `components/` and 2,199+ in `app/` despite a working `useLanguage()` dictionary covering both `th` and `en` line-for-line.

**Top 3 strengths:**
1. HSL token system with semantic tier (success/warning/info/destructive) plus dark mode is solid.
2. Skip-link, focus-visible ring, reduced-motion respect, ActionIcon a11y lint show genuine accessibility intent.
3. The 8-stage applicant model in `health-dashboard-stage.ts` (label + description + next-action + badge style per stage) is exactly the pattern UK gov.uk uses for "Where you are in this service".

**Top 5 gaps:**
1. Two design-token sources (`design-system.ts` is a phantom parallel palette nobody imports — verify, then delete or adopt).
2. ~522 hardcoded Thai literals in `components/` undermining the otherwise-complete bilingual dictionary.
3. No persistent footer with ministry attribution / contact / accessibility statement / privacy link — required for a Thai government service.
4. Hardcoded Tailwind palette colors (`emerald-50/700`, `amber-50/700`, etc.) leak the green/gold token system in `StatusCard`, `STAGE_BADGE_STYLE`, splash, form-input focus ring, loading-skeleton, glass surfaces.
5. Wizard step labels and bottom-nav labels are hardcoded Thai (`wizard-progress-stepper.tsx`, `mobile-bottom-nav.tsx`, `app-shell.tsx`) — language switch will not translate the wizard.

**Single biggest "doesn't feel like a government service" cue:** the absence of a persistent footer. Every UK gov.uk and DGA Thai government surface ends with a Crown/ministry block (logo, full ministry name, address, contact, privacy/terms/accessibility-statement links, content-licence notice). The GACP app stops at the bottom nav — that is a SaaS pattern, not a government pattern. Combined with the splash-screen "glass orb" gradient mesh aesthetic, the first impression reads as flashy fintech, not formal government.

## 1. Component Library + Design Tokens

**What exists:**
- `apps/web-app/src/components/ui/primitives/` — shadcn-style primitives.
- `apps/web-app/src/components/ui/` — application-level wrappers.
- `tailwind.config.cjs` references HSL CSS variables; brand `#eef8f2 → #153c29`.
- `apps/web-app/src/styles/globals.css` defines `--primary 153 100% 20%` (Forest Green) + `--secondary 43 45% 55%` (Gold), full semantic tier, dark-mode mirror, glass-system, status-badge classes, print stylesheet.

**Strengths:**
- Token system genuinely tokenised — Tailwind `bg-primary`, `text-foreground`, `border-border`, `hsl(var(--success))` work as intended.
- shadcn primitives mounted under `primitives/`, parent `ui/` wraps with form-level concerns.
- `globals.css` ban on hardcoded `dark:zinc-*` is enforced (0 matches).

**Gaps:**
- Two parallel palettes: `tailwind.config.cjs` brand (`#2c9057` Forest) versus `src/styles/design-system.ts` (`#10B981` Emerald, "Google Sans / Kanit" font). `design-system.ts` is not imported anywhere except its own export file — phantom.
- Hardcoded Tailwind palettes leak in: `health-dashboard-stage.ts STAGE_BADGE_STYLE`, `dashboard/client-view.tsx StatusCard`, `loading-skeleton.tsx`, `form-input.tsx Select`, `splash-view.tsx`, `trust-verifier-portal.tsx`.
- `radius` defined in two places: `tailwind.config.cjs` and `globals.css` global override `!important` block — reflects past prototype churn.
- No exported `<Tokens>` reference document.

**Concrete fix:**
- Delete `apps/web-app/src/styles/design-system.ts` OR rewrite as re-export of canonical Tailwind/CSS-var tokens.
- `apps/web-app/src/lib/health-dashboard-stage.ts:73-80`: replace `bg-slate-100/text-slate-600` etc. with `bg-muted/text-muted-foreground`, `bg-warning/10`, `bg-info/10`, etc.
- `apps/web-app/src/components/ui/loading-skeleton.tsx`: replace `bg-slate-200/80` with `bg-muted`.
- `apps/web-app/src/components/ui/form-input.tsx:65`: replace `focus:border-emerald-500 focus:ring-emerald-100` with `focus:border-primary focus:ring-ring/40`.
- Add `docs/design-system/tokens.md`.

## 2. Typography

**Strengths:** `Prompt` is the standard Thai Google font equivalent to `Noto Sans Thai`. Optimized rendering set. `font-prompt` body class consistent.

**Gaps:**
- Two font systems claimed: layout uses Prompt + Google Sans; `design-system.ts` declares `'Google Sans', 'Kanit'`. Pick Prompt, document.
- No declared type scale — pages mix `text-xs / text-sm / ... / text-5xl` ad-hoc.
- Thai-script line-height not adjusted globally. `Prompt` glyphs need ~1.6 line-height for vowel/tone-mark legibility.
- No `min-font-size` policy. `text-[10px]` and `text-[11px]` used in `app-shell.tsx:64` and `mobile-bottom-nav.tsx:135`. Hard for older users.

**Concrete fix:**
- Add `body { line-height: 1.6; }` for Thai script readability.
- Define type scale (`text-display-lg / text-display / text-h1 / ... / text-overline`) in `tailwind.config.cjs`.
- Ban `text-[10px]` and `text-[11px]` outside print stylesheets.

## 3. Color System

**Strengths:**
- Brand-appropriate: forest green + gold reads as Thai government / agriculture.
- Dark-mode coverage of every variable.
- `gov-gradient` and `gold-gradient` utilities for hero surfaces.

**Gaps:**
- Contrast: `--secondary 43 45% 55%` against white text gives ~3.6:1 — fails WCAG AA. Same for `--accent`. Every `<Button variant="default|secondary|light">` rendering text on the gold accent fails AA.
- No documented contrast budget per variant.
- Status colors inconsistent: `STAGE_BADGE_STYLE` uses raw Tailwind hues, `STATUS_CONFIG` uses Mantine-style names ("orange/teal/yellow/green/red/gray"), `globals.css` defines `.status-draft/.status-submitted/.status-reviewing/.status-approved/.status-rejected/.status-expired`. Three taxonomies for the same domain.

**Concrete fix:**
- Re-tune `--secondary` to lightness 35-40% (`43 45% 38%`) so white text passes AA, OR change `--secondary-foreground` to `0 0% 10%` near-black.
- Consolidate status palette to one canonical 6-color set.
- Add `pnpm exec @axe-core/cli` or `pa11y` invocation in CI.

## 4. Form Patterns

**Strengths:**
- Inline validation pattern (label → input → hint → error stacked vertically with `gap-1.5`) is the gov.uk pattern.
- 6-step wizard progress stepper shows step number, label, completion state, animated progress bar, compact mobile variant. Genuinely good.
- Auto-save indicator + tip banner present (audit-ready behavior).
- `globals.css` forces `border-radius: 0.75rem !important` on inputs — rounded chrome consistency.

**Gaps:**
- Required-field marker: `form-input.tsx` uses `<span className="text-red-600">*</span>` — hardcoded color, not `text-destructive`.
- Error state: no error icon, no `role="alert"` / `aria-live="polite"`, no `aria-invalid` / `aria-describedby` link.
- Wizard step labels in `wizard-progress-stepper.tsx:14-20` are hardcoded Thai — language switch won't translate them.
- No banner summary at top of step for screen-reader users (gov.uk required pattern).
- `Select` falls back to native `<select>` (correct accessibility), but inconsistent with primitives' shadcn `Select` (Radix).

**Concrete fix:**
- `form-input.tsx`: replace `text-red-600` with `text-destructive`; add `aria-invalid`, `aria-describedby`, `role="alert"`.
- `wizard-progress-stepper.tsx`: source labels from `useLanguage().dict.wizard.steps`.
- Add error-summary banner at top of wizard step on validation fail.
- Document convention in `docs/design-system/forms.md`.

## 5. Government-Formality Cues

**Strengths:**
- Gov-gradient header (forest green) is appropriate.
- Print stylesheet hides nav and forces black-on-white at 12pt.
- Formal document layout component exists (`gacpthai-document-layout.tsx`).
- `terms/page.tsx` and `privacy/page.tsx` exist.

**Gaps:**
- **No `<footer>` rendered by `AppShell` or `DashboardLayout`.** Ministry attribution lives only in `<head>`. `<footer>` appears in only 7 files; none is the persistent footer.
- Header subtitle reads `"GACP Certification"` (English brand) over `"ระบบรับรองมาตรฐาน GACP"` (Thai descriptor). Should be Thai-primary.
- No "Beta" / "Phase" tag, no service-version banner. Gov.uk pattern: every page top-bar shows "BETA · This is a new service" with feedback link.
- Splash screen aesthetic — animated floating glass orbs with mesh gradient — reads as fintech splash, not government service.
- Glass system (`glass-card`, `glass-panel`, `glass-nav`) heavily used — backdrop-filter blur on official surfaces feels iOS-native, not government-formal.

**Concrete fix:**
- Add `<GovernmentFooter />` rendered by `AppShell` and `DashboardLayout`: ministry full name, address, hotline, accessibility statement, privacy/terms, content licence, last-updated date, ISO/IEC 17065 / GACP scheme reference.
- Add `BetaBanner` slot above main content.
- Replace splash orb gradient mesh with static logo + ministry block + simple bar progress.
- Header: switch primary line to Thai full name.

## 6. Accessibility

**Strengths:** Skip-link + focus-visible + reduced-motion combo covers easy WCAG quick wins. `<Toaster position="top-right" />` for toast notifications has built-in `aria-live`. Semantic landmarks `<header>` / `<main>` / `<nav>`.

**Gaps:**
- `check-ui-a11y-baseline.js` only verifies four specific things; doesn't run axe-core or pa11y.
- `mobile-bottom-nav.tsx`: `_isActive` state computed and unused; active page has no visual indication and no `aria-current="page"`.
- `app-shell.tsx` mobile menu toggle has `aria-label="Toggle menu"` but no `aria-expanded` / `aria-controls`.
- Focus-management on route change: nothing explicit moves focus to `<h1>` or `#app-root-content`.
- `trust-verifier-portal.tsx` uses color-only conveyance for trust status. Add text label or icon.
- Touch targets: bottom-nav buttons computed ~36-40px, below WCAG 2.5.5 AAA recommendation 44×44.
- `lang="th"` on `<html>` set, but English content not wrapped with `lang="en"` — screen readers will mis-pronounce.

**Concrete fix:**
- Extend `check-ui-a11y-baseline.js`: lint for `aria-current` in nav, require `aria-expanded`/`aria-controls`, ban `text-[10px]/[11px]`, run `axe-core` on built pages.
- `mobile-bottom-nav.tsx`: render active state, add `aria-current="page"`, set `min-h-[44px] min-w-[44px]`, switch to Link.
- Wrap English-rendered subtree with `<span lang="en">` OR set `<html lang>` dynamically.

## 7. Mobile + Responsive

**Strengths:** Mobile breakpoints work; wizard's mobile compact stepper well-designed; responsive grids in dashboard.

**Gaps:**
- **Two bottom-nav implementations.** `AppShell.tsx` lines 124-145 + `mobile-bottom-nav.tsx` standalone. Different items, different active styles, different a11y. One is unused or both are competing.
- `mobile-bottom-nav.tsx` is dead-leaning: `_isActive` computed but unused, buttons don't navigate, labels hardcoded Thai.
- Touch target sizes too small (~28-32px effective tap area).
- Header sticky `top-0 z-50` correct, but bottom-nav `z-40` matches floating mobile menu — z-stack may collide.

**Concrete fix:**
- Pick one bottom-nav implementation. Recommend keep `app-shell.tsx` inline + delete `mobile-bottom-nav.tsx`.
- Set `min-h-[48px]` for bottom-nav items.
- Active state: bold weight + colored top-border + `aria-current="page"`.

## 8. Workflow Visibility

**Strengths:** This is the single best-designed piece of the platform. The 8-stage model + Thai descriptions + "what to do next" is exactly the gov.uk "Where you are in this service" pattern. The mapping from 18 backend states to 8 user-facing stages is the right abstraction.

**Gaps:**
- The 8-stage timeline shown on dashboard, but not on every page. Inside wizard, payment, cert detail, the user does not see "you are at stage X of 8" persistently.
- `activity-timeline.tsx` — actor field shown as `"ผู้ดำเนินการ: {item.actor}"` hardcoded Thai; works as audit log but no filter, no "since" timestamp tooltip, no link to source record.
- No global "audit trail viewer" page — user can see comments but cannot see "who from the ministry has touched my record and when".

**Concrete fix:**
- Render `<StageRibbon currentStage={stage} />` in `app/health/layout.tsx` so it persists across all applicant pages.
- Extend `activity-timeline.tsx` with permalinks.
- Add `/health/applications/[id]/audit-trail` page mirroring the immutable `audit_log` for the applicant's own record.

## 9. Loading + Error States

**Strengths:** Comprehensive coverage. Skeleton uses shimmer keyframe. EmptyState includes title + hint + action slot.

**Gaps:**
- `loading-skeleton.tsx:24` uses `bg-slate-200/80` and `border-slate-100` — hardcoded; doesn't darken in dark mode.
- Mixed convention: some pages use `<Spinner />`, some `<LoadingSkeleton />`, some segment fallback. No documented rule.
- Network-failure feedback is via toast (Sonner) — single-line ephemeral. Government services typically render persistent error banners with "try again" + reference number.

**Concrete fix:**
- `loading-skeleton.tsx`: `bg-muted` not `bg-slate-200/80`.
- Document in `docs/design-system/loading.md`: skeleton for >300ms layout, spinner for ≤300ms inline action.
- Add `<NetworkErrorBanner reference={errorId} retry={fn} />` for post-form-submit failures.

## 10. Internationalization

**Strengths:** Dictionary infrastructure excellent — `th` and `en` line-for-line parallel. localStorage-backed, Thai default. Storage event listener for cross-tab sync.

**Gaps:**
- ~522 raw Thai literals in `components/` and ~2,199 in `app/`. Dictionary built; not used by most components.
  - `mobile-bottom-nav.tsx:14-19` — nav labels
  - `app-shell.tsx:11-24` — bottom-nav labels
  - `wizard-progress-stepper.tsx:14-20` — step labels
  - `activity-timeline.tsx:21-22` — actor prefix
  - `splash-view.tsx:10-18` — loading status messages
  - `trust-verifier-portal.tsx:87, 94, 103` — error messages
  - `status-badge.tsx:30-38` — payment/cert status labels
- `getLocalizedText(language, th, en)` pattern only used in 3 files. Inconsistent.
- `<html lang="th">` hardcoded; never updates when user switches to English.

**Concrete fix:**
- Add lint rule: scan for Thai-script regex `/[฀-๿]/`, fail on JSX-text occurrences outside `dictionaries/`.
- Convert top 20 offending files first.
- Update `language-context.tsx` to mutate `document.documentElement.lang`.
- Settle on ONE pattern: `useLanguage().t('key.path')` everywhere. Retire `getLocalizedText`.

## Prioritized Roadmap

### Phase A — must-do for "trustworthy government feel" (1-2 sprints)
1. Render persistent `<GovernmentFooter />` in `AppShell` + `DashboardLayout`. **Single biggest cue change.**
2. Tone down splash: replace orb mesh + gradient text with static logo + ministry block.
3. Switch header primary line to Thai full name; English subtitle.
4. Fix WCAG AA contrast on `--secondary` (gold accent).
5. Delete `apps/web-app/src/styles/design-system.ts` (phantom palette).

### Phase B — should-do for accessibility / consistency (2-3 sprints)
6. Consolidate the two bottom-navs into one source.
7. Replace hardcoded Tailwind palette colors with token classes.
8. Wire wizard step labels, bottom-nav labels, splash status text, activity timeline labels through `useLanguage().t()`.
9. Add `aria-current="page"` + `aria-expanded`/`aria-controls` to navigation; bump touch targets to 44×44.
10. Add `role="alert"` + `aria-invalid` + `aria-describedby` on form errors; add error-summary banner.
11. Extend `check-ui-a11y-baseline.js` lint rules.

### Phase C — polish (ongoing)
12. Document type scale + spacing scale + token table.
13. Render `<StageRibbon />` persistently across applicant routes.
14. Add `/health/applications/[id]/audit-trail` page for applicants.
15. Tune Thai line-height to 1.6 globally.
16. Ship "BETA · feedback" banner.
17. Run `axe-core` over top 12 pages in CI.

## Explicit Non-Recommendations
- Do not switch to a third UI library.
- Do not rewrite the design tokens system.
- Do not redesign the wizard.
- Do not redesign the 8-stage model.
- Do not adopt dark mode as the default.
- Do not introduce per-screen iconography sets.
- Do not restyle the print stylesheet.

## Reference standard recommendation

**gov.uk Design System is the more applicable reference**, with Thai DGA as a secondary check for cultural/visual cues. Reasons: (a) gov.uk has the most mature documented patterns for "Where you are in this service" (matches 8-stage model already implemented); (b) gov.uk's error-summary + inline-error pattern is directly portable; (c) gov.uk's "BETA · feedback" banner solves the "is this real?" trust question; (d) Crown footer pattern translates directly to a Ministry/Department footer. Use Thai DGA only for: Thai-script line-height, Thai font choice, and Thai government color/iconography conventions.

## Total LOC / Files Touched Estimate

| Phase | Files | LOC | Notes |
|---|---|---|---|
| A1 GovernmentFooter | 3 new + 2 modified | ~200 | New component + 2 import lines per shell |
| A2 Splash redesign | 1 (`splash-view.tsx`) | ~150 changed | Strip orbs + gradient text |
| A3 Header Thai-first | 1 (`app-shell.tsx`) | ~10 | Reorder + dictionary lookup |
| A4 Contrast fix | 2 | ~20 | Token tweak + verify |
| A5 Phantom palette delete | 1 | -245 | Net deletion |
| B6 Bottom-nav consolidation | 2 | ~80 net | -55 + 30 |
| B7 Color token migration | ~10 | ~250 modified | Class swaps |
| B8 i18n migration top 20 | ~20 | ~400 modified | Replace literals with `t()` |
| B9 ARIA correctness | ~5 | ~60 | Attribute additions |
| B10 Form a11y + error-summary | 2 | ~120 | New 80-line component + 40 in form-input |
| B11 CI lint extension | 1 | ~100 | New rules |
| C12-17 polish | ~15 | ~600 | Distributed |

**Total: ~50 files touched, ~1,800 LOC modified, ~1,000 LOC added, ~300 LOC deleted.**
