# Visual Regression Tests

Playwright pixel-diff snapshots of the public-facing pages, captured to detect
incidental visual regression in subsequent design passes.

## Why this exists

Design Pass 1-5 (PRs #38, #39, #40, #41, #42) hardened many specific surfaces
— button rows, table overflow, form labels, Thai validators, etc. Without a
visual net, the next bug is one un-reviewed CSS edit away. This is the cheap
version of that net (no Storybook): just point Playwright at the live site
and diff full-page screenshots against a committed baseline.

## Workflow

### First time (or after an intentional redesign)

Run against the canonical environment with `--update-snapshots`:

```bash
# Against local dev server (recommended for the initial baseline so you
# control fonts + viewport):
cd apps/web-app
pnpm dev   # in another terminal, port 3000
E2E_BASE_URL=http://localhost:3000 pnpm exec playwright test e2e/visual --update-snapshots

# Or against staging / prod (if you don't have a local dev setup):
E2E_BASE_URL=https://gacpth.com pnpm exec playwright test e2e/visual --update-snapshots
```

Review the resulting `*.png` files in `e2e/visual/public-pages.visual.spec.ts-snapshots/`,
make sure they look right, then commit them.

Then drop the `test.fixme` in the spec to enable the gate:

```ts
// before:
test.fixme(`${name} matches snapshot`, async ({ page }) => { ... })
// after:
test(`${name} matches snapshot`, async ({ page }) => { ... })
```

### On every later PR

CI runs the spec automatically (once it's been promoted from `.fixme`).
Pixel diff > 1% per page → CI fail with a side-by-side diff in the
Playwright HTML report.

If the diff is intentional (a real redesign): re-run with
`--update-snapshots`, review, commit the new baselines.

## Configuration

The spec uses 1% pixel-diff tolerance to absorb font-antialiasing noise
across CI runners while still catching real layout shifts. Animations are
disabled at runtime (CSS injection) so screenshots are deterministic.

## Pages covered

| Path | What this catches |
|------|-------------------|
| `/auth/health/login` | Login chrome regression (the most-visible public surface) |
| `/accessibility` | Phase A5 accessibility statement layout |
| `/terms` | Long-form legal copy with footer |
| `/privacy` | Long-form legal copy with footer |

Auth-gated pages (applicant wizard, provider dashboard) are intentionally
excluded — they need session cookies which makes baselining brittle. A
follow-up pass can add them with a deterministic test login.
