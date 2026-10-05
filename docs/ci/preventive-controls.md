# Tier-2 Preventive Controls

Four lightweight checks that catch root-cause patterns from the v3.2.0 audit
cycle. Each one fires on the *first* introduction of the bad pattern.

**Status 2026-08-14 — read this before trusting the table below.** These were
written as GitHub Actions jobs. The operator ruled on 2026-08-14 that Actions
will not be paid for, so hosted runners are permanently unavailable
(the change log 2026-08-14). Nothing in `.github/workflows/` executes. The
gates that do run today are `scripts/ci/local-gate.sh` (every machine) and
`scripts/ci/full-gate.sh` on the staging box, whose check list is
`scripts/ci/full-gate-checks.txt`. Controls 2, 3 and 4 appear in **neither**
list — they are run by hand or not at all, and the "Runs today" column says so.

| # | Control | What it catches | Runs today? |
|---|---------|-----------------|-------------|
| 1 | `.gitattributes` | Windows CRLF leaking into shell scripts and YAML; lost executable bit on `*.sh` after a Windows commit | Yes — git applies it on every commit, no runner involved |
| 2 | Workflow script-path validator | Stale `node scripts/...` references in workflows after a script is renamed or moved | **No.** Its only invoker was `ci.yml:302`. It also validates `.github/workflows/*`, files that no longer execute — the audit of 2026-08-14 classes it DEAD (`evidence/rules-audit-2026-08-14/raw-result.txt`) |
| 3 | Prisma migration drift detector | `prisma/schema` and `prisma/migrations` going out of sync (model added without a migration) | **By hand only** — `pnpm check:prisma-migration-consistency` (`package.json:30`). The `prisma-drift-check` job was removed from `ci.yml` (see the note at `ci.yml:304`) |
| 4 | Frontend lint warning ratchet | New ESLint warnings sneaking into `apps/web-app` one PR at a time | **No.** Its only invoker was `frontend-lint-ratchet.yml:49`. Run it by hand until it has a home in local-gate or full-gate |

## Files

- `.gitattributes` — line-ending + executable-bit policy
- `scripts/ci/validate-workflow-paths.js` — Control 2 implementation (no live invoker)
- `scripts/ci/check-frontend-lint-ratchet.js` — Control 4 implementation (no live invoker)
- `scripts/ci/frontend-lint-baseline.json` — committed warning ceiling (`maxWarnings: 0`, last updated 2026-05-18)
- `.github/workflows/frontend-lint-ratchet.yml` — Control 4 workflow, cannot dispatch

## Running locally

```bash
# Control 2
node scripts/ci/validate-workflow-paths.js

# Control 3
cd apps/backend
npx prisma migrate diff \
  --from-migrations prisma/migrations \
  --to-schema-datamodel prisma/schema \
  --exit-code

# Control 4 (requires `pnpm install` first)
node scripts/ci/check-frontend-lint-ratchet.js
```

## Updating the lint baseline (Control 4)

The baseline can only go DOWN, and only an agent may move it down. Raising it
is an operator act with a the change log entry — the project rules L4/L6
(the audit ledger` states the same rule for the other ratchets).

When the actual warning count drops:

1. Run `node scripts/ci/check-frontend-lint-ratchet.js` locally — it prints
   the suggested new ceiling. (It needs `pnpm` and installed `web-app`
   dependencies; it exits 1 on ESLint *errors* regardless of the warning
   ceiling.)
2. Edit `scripts/ci/frontend-lint-baseline.json`:
   - Set `maxWarnings` to the new value
   - Update `lastUpdated` to today's date (YYYY-MM-DD)
3. Commit. The ceiling is only as strong as the next hand-run of the script:
   no automated gate currently enforces it (see the status note above).

## Emergency override

These controls are intentionally cheap to disable in a true emergency. Pick
the *most surgical* override:

- **Control 1 (gitattributes):** commit with `git -c core.autocrlf=false` to
  bypass line-ending normalisation for a single commit. Prefer fixing the
  underlying file in a follow-up over leaving the override permanent.
- **Control 2 (workflow paths):** nothing to override — it has no live
  invoker. If it is ever revived against a live artifact set, the surgical
  override is to comment the offending reference out, land the rename, then
  restore.
- **Control 3 (prisma drift):** no job to override. Drift is caught by hand
  (`pnpm check:prisma-migration-consistency`) and, for broken migrations, by
  the required `migrate-deploy` check in `scripts/ci/full-gate-checks.txt`.
  Generate the missing migration with `npx prisma migrate dev` rather than
  skipping the check.
- **Control 4 (lint ratchet):** if a tooling upgrade legitimately adds many
  warnings, raising `maxWarnings` is **not** an agent's call. Report the new
  count, propose the number, and let the operator sign it (L4 ratchet, L6
  "เขียนกฎได้ ยกเว้นกฎไม่ได้"). Silently raising the number is the exact
  failure the ratchet exists to make visible.

## Why these four and not more

These are the four cheapest, most-mechanical patterns we have evidence
of recurring. They each have a unit-test-like property: they fire on the
first instance of the bad pattern and never on a clean diff. We did not
add controls that produce false positives or that need ongoing tuning —
those become noise and get ignored.

When a NEW class of recurring bug shows up, add a fifth control here.
Resist the urge to expand existing controls into broader policies; keep
each one narrow enough that the failure message tells you exactly what
to fix.
