# CSS Architecture Audit — 2026-05-04

- Status: Audit snapshot + remediation tracking
- Scope: `apps/web-app` styling layer only (Tailwind + custom CSS)
- Branch where remediation lands: a feature branch

## TL;DR

The web-app uses **Tailwind CSS as the primary styling system**, with token-driven theming (Shadcn-style HSL CSS variables). No Mantine or other UI library is wired in — but **40+ legacy `var(--ui-color-*)` references remain** from a previous Mantine integration. These render with browser fallback values (mostly invisible borders, missing colors), so visuals are degraded rather than broken outright.

**No selector or variable conflicts exist across files.** The remaining issues are dead code, undefined-but-used variables, and Mantine-leftover color references.

## CSS file inventory

| File | Lines | Role | Loaded by |
|---|---:|---|---|
| `src/app/globals.css` | 3 | Entry — re-exports the 3 styles files | Next.js root layout |
| `src/styles/globals.css` | 887 | Tailwind directives + design tokens (`:root`, `.dark`) + base layer + utilities + premium components | imported by entry |
| `src/styles/globals-components-auth.css` | 414 | `.gov-auth-*` classes for login/register/auth pages | imported by entry |
| `src/styles/globals-components-layout.css` | 337 | `.surface-*`, `.field-*`, `.shell-*`, `.prose-gov`, `.gov-bottom-nav-*` classes | imported by entry |
| `src/styles/provider-styles.css` | 118 | provider print + `auth/clear-session` page styles | lazy-imported by 2 specific pages |
| `src/components/document/gacpthai-document-styles.css` | 306 | certificate/document templates | lazy-imported by `gacpthai-document-layout.tsx` |
| **Total** | **2,065** | | |

## Tailwind verification

- `@tailwind base; @tailwind components; @tailwind utilities;` present at the top of `src/styles/globals.css`
- `tailwind.config.js` `content` globs cover `src/{app,components,lib,contexts,hooks}/**/*.{js,ts,jsx,tsx,mdx}`
- Theme uses Shadcn-style design tokens — colors are HSL channel triplets stored in CSS variables, then composed via `hsl(var(--token))` in Tailwind utilities
- No Mantine: `@mantine/*` is absent from `apps/web-app/package.json` and has no remaining imports in source code
- No SCSS/Sass, no CSS-in-JS runtime, no styled-components

## Conflict check

| Check | Result |
|---|---|
| Cross-file selector overlap (`globals.css` ∩ `auth.css`, etc.) | ∅ — no conflicts |
| Duplicate base-selector blocks within a single file | ∅ |
| Duplicate CSS variable definitions (excluding `:root` + `.dark` pairs) | ∅ |

The only "duplicates" detected by naive grep were pseudo-selector / state variants (`:hover`, `::before`, `:nth-child`, etc.), which are normal CSS.

## Issues found

### Issue 1 — Mantine `--ui-color-*` leftover references (high impact, distributed)

When Mantine was removed, runtime variables it auto-injected (`--ui-color-{palette}-{0..9}`, `--ui-color-body`, `--ui-color-white`, `--ui-radius-md`) were never re-defined. Inline `style={{ ... }}` and `className="bg-[var(--ui-color-X)]"` references remain in:

- 15 TSX files under `src/components/ui/*` and `src/app/*`
- `src/styles/provider-styles.css` (10+ references)

Browser behavior when `var(--ui-color-X)` is undefined:
- `color`, `border-color`, `background` properties revert to their initial value
- Initial for `border-color` is `currentColor` → borders render in text color
- Initial for `background-color` is `transparent` → no background fill
- Initial for `color` is the inherited foreground

**Net effect**: visible color drift on file-upload borders, "required" asterisks, criteria status cards, trace QR splash, onboarding step pills, etc. Currently ships and "works" because content is still readable, but the design intent is silently lost.

### Issue 2 — Project-defined variables used but never declared

| Variable | Used in | Visible effect |
|---|---|---|
| `--field-surface` | `globals-components-layout.css:86,90` | `.field-surface` and `.field-surface-strong` classes have no background — relies on parent |
| `--field-muted-surface` | `globals-components-layout.css:42,98` + `feature/filter-bar.tsx` (2x) | `.contrast-panel`, `.form-block`, filter-bar have no background |
| `--shadow-sm` | `globals-components-layout.css:8` | `.surface-panel` has no shadow |
| `--shadow-md` | `globals-components-layout.css:3` | `.surface-card` has no shadow |
| `--font-display` | `globals-components-layout.css:203` | `.prose-gov h1/h2/h3` inherit body font (Prompt) instead of a display variant |
| `--ui-radius-md` | `provider-styles.css` (3x) | provider print + clear-session pages have unrounded corners |

### Issue 3 — Tailwind config dead entries

```js
// tailwind.config.js
borderRadius: {
  lg: 'var(--radius)',         // OK — --radius = 0.75rem
  xl: 'var(--radius-lg)',      // ❌ --radius-lg never declared
  '2xl': 'var(--radius-xl)',   // ❌ --radius-xl never declared
}
```

The `xl` and `2xl` entries reference undefined variables. Effectively dead because `globals.css:198-213` overrides `.rounded-xl` and `.rounded-2xl` with `!important` at higher specificity.

### Issue 4 — Duplicate input border-radius rule

`globals.css:109-113` (inside `@layer base`) declares the same rule as `globals.css:215-225` (outside any layer, broader selector). The outside-layer rule wins because it (a) has higher specificity (more selectors via union) and (b) is not inside a Tailwind `@layer` (whose rules can be flattened/superseded). The in-layer rule is dead code.

## Remediation plan (this branch)

| Stage | Change | Risk | Visual change? |
|---|---|---|---|
| 1 | Remove duplicate input-radius rule (Issue 4) + remove dead Tailwind config entries (Issue 3) | Low | None — values match what `!important` overrides already produce |
| 2 | Declare missing design tokens (Issue 2) with values matching design intent (white-ish form surfaces, Tailwind shadow-sm/md, Prompt for display, 0.5rem ui-radius-md) | Low–Medium | **Restorative** — surfaces gain intended bg/shadow that were silently missing |
| 3 | Add Mantine compatibility shim — declare `--ui-color-*` palette in `:root` + `.dark` using Mantine v7 default values, with `// LEGACY — do not add new references` comment block (Issue 1) | Low–Medium | **Restorative** — borders/badges/colors that currently fall back to `currentColor` / `transparent` regain their intended Mantine palette values |

Stages are committed separately so each can be reverted independently if a visual regression is reported.

## Wave roll-up (status as of branch tip)

| Wave | Scope | Status | Commit |
|---|---|---|---|
| 0 | Audit doc itself | ✅ done | `f331b3e` |
| 1 | Remove duplicate input-radius + dead Tailwind config | ✅ done | `f331b3e` |
| 2 | Declare missing design tokens (`--field-surface`, `--shadow-*`, `--font-display`, `--ui-radius-md`) | ✅ done | `2bc86e2` |
| 3 | Mantine compat shim (temporary `--ui-color-*` declarations) | ✅ done — then **removed** | `2bc86e2` → `f5d8a0e` |
| A | Remove orphan glass utilities + dedupe design token files + fix husky deprecation | ✅ done | `9de3d05` |
| B | Eradicate Mantine `--ui-color-*` everywhere; add `colors.mantine.*` Tailwind namespace + `MANTINE.*` JS constants for the residual inline-style cases | ✅ done | `f5d8a0e` |
| C | Extract Premium Design Utilities cluster into `globals-premium.css` | ✅ done | `4406fa6` |
| D | Flip Frontend Lint from advisory to required gate | ✅ done | `20e2d24` |
| E | N+1 fix on `/api/analytics/geography/farms` (1000 cert lookups → 1 batch query) + Postgres-side `groupBy` aggregation in provider performance handler | ✅ done | `57102cf` |
| F (partial) | Make `<ThemeIcon>` / `<ActionIcon>` honor `size` prop (was silently ignored). Adds Mantine-style preset mapping (xs/sm/md/lg/xl) and removes the permissive `[key:string]:unknown` index signature so accidental prop typos surface at compile time. | ✅ done | `025a96e` |
| F (residual) | Strip `color` + `variant` props from the two components and the ~33 call sites that pass them; map each caller's intended color to a Tailwind utility class | ⏸ deferred — needs per-call-site design decision |

## Out of scope (future work)

- **Wave E** — Backend analytics endpoints (`apps/backend/routes/api/system/analytics.js`, `apps/backend/routes/api/provider/handlers/analytics.js`) lack pagination and aggregate all-records-then-in-memory; cache layer has no invalidation hook on application/certificate mutations. Real fix requires a backend tenancy + query-shape review.
- **Wave F** — `<ThemeIcon>`, `<ActionIcon>`, `<CloseButton>` accept `color` / `variant` / `size` props (Mantine API surface) that are silently destructured into `_c` / `_v` / `_s` and discarded. 33 call sites across 24 files pass these dead props. Cleaning this up properly means either making the props *do something* (a design-system decision) or removing them and dropping caller usage in one sweep. Both options are larger than the audit's "no-risk" remit.
- Refactoring `provider-styles.css` to use design tokens instead of Mantine palette references (the file uses `colors.mantine.*` Tailwind tokens transitively via the `@apply` chain; it can stay as-is until Wave F lands).
- Choosing whether `.prose-gov` headings should use a distinct display font (currently `--font-display` is set to the body family Prompt; designers can override the var without touching every heading rule).
- Reviewing the 529-line `globals.css` for further `@layer` consolidation. The file is now structured as: `@layer base { :root, .dark, *, body }` → `@layer utilities { animations }` → plain CSS (overrides + decorative classes). Splitting further requires careful cascade preservation.
