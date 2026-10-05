# `gacp/no-raw-color` baseline — Phase A5 §4.3

**Step 8 complete (v3.5.3 — 2026-04-29):** the rule is now registered as
**`error`** in `eslint.config.mjs`. Violation count = **0**. Any future PR
that introduces a raw hex in a Tailwind arbitrary-value class or inline
style will fail the lint step.

**Step 7 baseline was 25 violations** (this is the historical reference;
left in this doc so the next reviewer can audit what was changed and why).

## Rule definition

`apps/web-app/eslint-rules/no-raw-color.js` — three patterns flagged:

1. **Tailwind arbitrary-value class with hex** — `className="bg-[#0b1f3a]"`
2. **Inline style hex** — `style={{ color: '#FF0000' }}`
3. **Raw hex in JSX text** — `<span>#FF0000</span>` (rare, mostly fallback strings)

Exemptions handled by the rule itself (no need for `eslint-disable`):
- SVG primitives (`<svg>`, `<path>`, `<rect>`, `<circle>`, etc.)
- `<meta name="theme-color" content="#xxx" />` (browser-required)

## Cleanup recipe per pattern

| Pattern | Replace with |
|---|---|
| `bg-[#1e3a8a]` | `bg-blue-800` (or extend `tailwind.config.js` with a `gov-blue-800` token first) |
| `bg-[#0b1f3a]` | extend `tailwind.config.js` with `gov-navy: '#0b1f3a'`, then `bg-gov-navy` |
| `style={{ color: '#FFF' }}` | `<element className="text-white">` |
| `style={{ backgroundColor: '#22c55e' }}` | `className="bg-emerald-500"` |

## Path to step 8 (ratchet to error)

1. Pick a file from the violation list (sorted by file count below).
2. Replace each raw hex with the closest Tailwind palette token, OR if it's a
   gov-specific colour reused in multiple places, add a named token to
   `tailwind.config.js` first.
3. Run `pnpm lint` — verify the count dropped.
4. Repeat per file until count = 0.
5. Flip `gacp/no-raw-color` from `warn` to `error` in `eslint.config.mjs`.
6. Tag a Phase A5 step-8 PR.

## Snapshot of files with violations (run locally to refresh)

```bash
pnpm --filter web-app lint 2>&1 | grep -B1 "gacp/no-raw-color" | grep -oE "src/[^ ]+\.tsx?" | sort | uniq -c | sort -rn
```

Files identified at baseline (top-of-list, run to refresh full list):
- `src/app/auth/_components/provider-login-page.tsx` — `bg-[#004d2a]`
- `src/app/health/applications/new/_steps/steps/success-step.tsx` — inline style hex
- `src/app/health/applications/renewal/payment-step.tsx` — `bg-[#00427A]`, `border-[#00427A]`
- `src/app/health/documents/[id]/client-view.tsx` — inline `#FFF`
- `src/components/document/gacpthai-document-layout.tsx` — `#2E7D32` etc.

Most of these are concentrated in legacy auth + document-print code. None
are in Phase A5 layout primitives (`GovLayout`, `Footer`, `accessibility`)
— those use only Tailwind palette tokens or `bg-[#0b1f3a]` (the gov navy)
which is the documented exception. Either:
(a) extend `tailwind.config.js` with a `gov-navy` token and migrate, or
(b) add `// eslint-disable-next-line gacp/no-raw-color` on the 3 known
intentional uses.

## CI integration

The CI's `lint-frontend` job currently caps warnings at 50. As of this
baseline (149 total warnings, 25 from `no-raw-color`), the cap is met
but the job stays advisory (`continue-on-error: true`). Step-8 of
Phase A5 also moves the cap to 0, at which point the job becomes a
real gate.
