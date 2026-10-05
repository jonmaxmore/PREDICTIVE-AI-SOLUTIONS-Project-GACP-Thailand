# Tailwind Design Research and Adaptation (2026-02-16)

## Source Set Reviewed
- Figma community libraries from product owner input:
  - https://www.figma.com/design/MQ5hwxL5FTk5U8AlkEYs8P/TailwindCSS-variables--Community-
  - https://www.figma.com/design/BqjqbUhuWQqDiHnIh6kUuG/Syncfusion-Web-UI-Kit---Tailwind-Theme--Community-
  - https://www.figma.com/design/OLBqzgkNCVIqZaeOj3kWvg/33--Free-Tailwind-Stepper-in-Figma--Community-
  - https://www.figma.com/design/x7YQrdaa5mIgFbec2YTKhz/197--Free-Tailwind-Icons-in-Figma--Community-
  - https://www.figma.com/design/N56L2g5leR1UXQTbrrCcNC/Tailwind-Wireframe-for-Kadence-Theme--Community-
  - https://figma.com/design/QId9F4VtySkz0EXJ0RfeUm/Tailwind-CSS-Styles--Community-
  - https://www.figma.com/design/WaU01XyNc9ijtLbWPWWqNJ/Official-Tailwind-CSS-Styles--Community-
  - https://www.figma.com/design/Rwgp4rRhEFGLD6vo8KlOMb/44--Free-Tailwind-Tables-in-Figma--Community-
  - https://www.figma.com/design/Gv8uttvQwpJsmVMDgGSWYm/59--Free-Tailwind-Pagination-in-Figma--Community-
  - https://www.figma.com/design/GWKAQycUvSWnMExfZADDx6/Tailwind-Blocks--Preview-
- Tailwind Plus stacked application shells: https://tailwindcss.com/plus/ui-blocks/application-ui/application-shells/stacked
- shadcn/ui theming guidance: https://ui.shadcn.com/docs/theming
- Tailwind token/customization guidance: https://tailwindcss.com/docs/customizing-spacing/
- Behance references for dashboard/list/card hierarchy and compact data density:
  - https://www.behance.net/gallery/151557645/Adobe-Xd-TailwindCSS-Color-Palette-Library
  - https://www.behance.net/gallery/201947821/Tailwind-Dashboard
  - https://www.behance.net/gallery/192825067/Random-Tailwind-Components-Design
  - https://www.behance.net/gallery/226457081/CryptoTrakX-Tailwind-Crypto-Dashboard-Free-Download
  - https://www.behance.net/gallery/187178899/Tailwind-Redesign-Pixel-4-Pixel-(Dev-Design)
  - https://www.behance.net/gallery/195638381/Learning-App-with-Tailwind-CSS-Dashboard-Templates
  - https://www.behance.net/gallery/177463077/Create-Website-Figma-HTML-TAILWIND-CSS

## Reference-to-Implementation Mapping
### Figma token/style kits
- TailwindCSS variables + official Tailwind styles kits were used as base for role tokens:
  - `--background`, `--foreground`, `--card`, `--primary`, `--muted`, `--ring`
  - implemented in `apps/web-app/src/styles/globals.css`
- Result:
  - role themes are switched by `data-role="health"` and `data-role="provider"`
  - typography, spacing rhythm, radius, and shadow stay consistent across pages

### Figma stepper / table / pagination kits
- Stepper principles (compact step chip + clear current stage) mapped into:
  - `apps/web-app/src/components/feature/planting-stepper.tsx`
- Dense-data fallback rule (line usage only in dense tables) documented and enforced:
  - `docs/ui-structure-principles.md`
  - list/queue flows now use spacing and contrast first

### Behance dashboard references
- High-value dashboard patterns adopted:
  - compact KPI cells
  - action-first tiles
  - timeline/list-first operational sections
- Implemented classes/components:
  - `.metric-cell`, `.action-tile`, `.activity-row` in `apps/web-app/src/styles/globals.css`
  - `summary-header`, `quick-actions`, `application-list`, `activity-timeline`

## Access Notes
- Most Figma community links are interactive documents and cannot be fetched directly in CLI crawlers (status-blocked).
- Implementation used source-compatible Tailwind + shadcn design principles and existing screenshot direction approved by product owner.

## Extracted Rules Applied to This Project

### 1) Layout and Information Architecture
- Stacked application shell as baseline pattern.
- Single primary CTA per page section.
- List-first density for operational pages (dashboard queues, applications, trace events).

### 2) Visual System
- CSS variable token system (background/foreground/card/primary/muted/ring).
- Role-driven theme override via `data-role="health"` and `data-role="provider"`.
- Large radii (`2xl/3xl`) + soft shadows.
- Gradient restricted to hero/header only.

### 3) Structure First, Decoration Second
- Grouping by proximity (`flow-stack-*`, `cluster-list`, `group-item`).
- Alignment first for column/row rhythm.
- Contrast panels for emphasis.
- Divider lines are fallback only (subtle, non-structural).
- New compact block classes for operational pages:
  - `.metric-cell` (KPI blocks)
  - `.action-tile` (quick actions)
  - `.activity-row` (timeline/list rows)

### 4) Core Component Consistency
- Unified CTA behavior and shape in button primitives.
- Unified input/select/textarea shell with focus/ring behavior.
- Stepper and queue/list rows normalized for readability on desktop/mobile.

## Code Adaptation Completed in This Iteration
- `apps/web-app/src/lib/ui-kit/core.tsx`
  - softened border usage, updated paper/card/input/button/select/stepper/pagination defaults.
- `apps/web-app/src/components/feature/summary-header.tsx`
- `apps/web-app/src/components/feature/quick-actions.tsx`
- `apps/web-app/src/components/feature/filter-bar.tsx`
- `apps/web-app/src/components/feature/application-list.tsx`
- `apps/web-app/src/components/feature/application-row.tsx`
- `apps/web-app/src/components/feature/activity-timeline.tsx`
- `apps/web-app/src/components/feature/planting-stepper.tsx`
- `apps/web-app/src/components/feature/work-queue-list.tsx`
- `apps/web-app/src/app/health/dashboard/page.tsx`
- `apps/web-app/src/app/health/applications/page.tsx`
- `apps/web-app/src/app/health/planting/page.tsx`
- `apps/web-app/src/app/provider/dashboard/page.tsx`
- `apps/web-app/src/app/trace/plot-cycle/[qr-code]/page.tsx`

## Build/Quality Status
- `pnpm -C apps/web-app build` -> PASS
- `pnpm -C apps/web-app lint` -> PASS with pre-existing warnings in legacy areas.

## Next UI Migration Batches (Recommended)
1. Health application wizard pages (`/health/applications/new/...`) to the same structure primitives.
2. Provider operations pages (`/provider/applications`, `/provider/audits`, `/provider/calendar`).
3. Public trace pages (`/trace/plant`, `/trace/lot`, `/trace/batch`) for visual parity.
4. Remove remaining `@/lib/ui-kit` dependency per page and converge to shadcn primitives.
