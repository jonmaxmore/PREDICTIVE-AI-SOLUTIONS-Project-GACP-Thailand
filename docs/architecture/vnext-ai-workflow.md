# vNext AI Workflow (2026 Baseline)

This project adopts an incremental vNext model: modernize continuously without destabilizing production.

## Why This Approach

- We continue to use `Next.js + NGINX` for production reliability.
- We evaluate newer runtime/router ideas (for example Vinext-style patterns) as experiments, not immediate replacements.
- We treat AI as an accelerator for implementation, while quality gates remain deterministic and human-reviewed.

## Source References

- Video reference: https://www.youtube.com/watch?v=9aZyDcCsNk8
- Cloudflare announcement/analysis context: https://blog.cloudflare.com/en-us/introducing-vinext/
- Vinext repository: https://github.com/cloudflare/vinext

## Adoption Policy for This Repository

1. Keep production stack stable:
   - frontend: Next.js
   - edge reverse proxy: NGINX
   - optional API gateway evolution: Kong OSS (incremental only)
2. New architecture ideas are added behind explicit migration plans and rollback plans.
3. Do not replace core runtime in a single cutover.

## AI Delivery Loop (Team Standard)

1. Define contract first:
   - API request/response
   - validation schema
   - expected error model
2. Implement in small batches:
   - one flow at a time
   - one risk domain at a time (auth, member, payment, traceability)
3. Run deterministic gates before merge:
   - `node scripts/ci/check-no-new-eslint-warnings.js`
   - `node scripts/ci/check-max-lines.js --mode=delta --warn=400 --max=500`
   - `npm --prefix apps/web-app run lint:auth`
   - `npx tsc --noEmit` (inside `apps/web-app`)
4. Run UAT evidence scripts for critical flows:
   - auth hardening
   - member journey smoke tests
5. Merge only when gates pass and rollback path is defined.

## File Size and Complexity Standard

- Hard limit: `500` lines per source file (delta policy).
- Warning threshold: `400` lines.
- Rule for contributors:
  - if a file exceeds `500` and grows in the same change, split before merge.
  - if a legacy file is already >500, do not grow it; extract modules first.

## Type Safety Standard (2026)

- New frontend code uses strict TypeScript types (avoid `any`).
- `any` is permitted only with explicit containment boundaries and follow-up cleanup tickets.
- Shared payload and auth interfaces must be centralized and reused.

## Security + Reliability Standard

- Security controls are non-negotiable:
  - CSRF, cookie policy, rate limiting, audit logs
- Every auth/member change must include:
  - regression test update
  - backward compatibility check
  - deployment rollback command

## Current Priority Queue

1. Reduce file-size debt in modules currently over 500 lines.
2. Reduce frontend `any` usage in member/auth critical path.
3. Keep CI gates strict for changed files to prevent new debt.

## Operational Commands

- vNext audit report:
  - `node scripts/tools/vnext-audit.js`
- changed-file size gate:
  - `npm run check:max-lines`
- auth lint gate:
  - `npm --prefix apps/web-app run lint:auth`
