# Tailwind UI Consistency Playbook (Mantine Parity)

Effective date: `2026-02-17`

## Goal

Recreate the "clean, calm, professional" feel of Mantine using Tailwind, while keeping full control in our monorepo.

## 1) Lock Theme Tokens

Source of truth:

- `apps/web-app/src/styles/globals.css`

Required token groups:

- semantic colors (`--primary`, `--accent`, `--muted`, `--border`, `--ring`)
- radius scale (`--radius-xs` to `--radius-2xl`)
- shadow scale (`--shadow-xs` to `--shadow-xl`)
- typography scale (`--font-size-*`)
- spacing scale (`--space-*`)

Rule:

- no per-page color/radius/shadow invention

## 2) Form Pattern (Mandatory)

Source of truth:

- `apps/web-app/src/components/ui/primitives/form-field.tsx`

Each field must support:

- label
- required marker
- description
- helper text
- error text
- disabled visual state

Rule:

- no raw ad-hoc field wrappers in page files

## 3) Core Component Set (Single Entry)

Source of truth:

- `apps/web-app/src/components/ui/system.ts`

Required set:

- Button
- Input
- Select
- Textarea
- Checkbox/Radio
- Card
- Table
- Badge
- Dialog
- Toast

Rule:

- import from `@/components/ui/system` for new UI work

## 4) Layout System

Source of truth:

- `apps/web-app/src/components/layout/page-system.tsx`

Use standardized:

- `PageContainer`
- `PageHeader`
- `SectionHeader`
- `Breadcrumbs`
- `ActionBar`
- `SectionGrid`

Rule:

- workflows must use shared page/section structure before custom layout hacks

## 5) Typography for Docs/Guides

Source of truth:

- `.prose-gov` in `apps/web-app/src/styles/globals.css`

Rule:

- long-form guidance, legal notes, and export instructions should render under `prose-gov`

## Migration Strategy

1. migrate wizard/document screens first
2. migrate dashboard cards and tables
3. migrate old `components/ui/*` wrappers to system components
4. remove unused ad-hoc styles after each migration batch

## Enforcement Gate

Lint policy now blocks new `@/lib/ui-kit` imports.

- config: `apps/web-app/eslint.config.mjs`
- legacy allowlist: `apps/web-app/.eslint-ui-kit-legacy-allowlist.txt`

If you migrate a file away from `ui-kit`, remove it from allowlist by regenerating:

```powershell
rg -l -e "from '@/lib/ui-kit'" -e 'from \"@/lib/ui-kit\"' apps/web-app/src | % { $_.Replace('apps/web-app/','').Replace('\','/') } | sort -Unique > apps/web-app/.eslint-ui-kit-legacy-allowlist.txt
```
