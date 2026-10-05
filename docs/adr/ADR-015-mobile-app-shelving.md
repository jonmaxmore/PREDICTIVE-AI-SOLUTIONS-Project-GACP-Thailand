# ADR-015: Mobile App Shelving Until Field-Officer Use Case Is Funded

- Status: Accepted
- Date: 2026-04-29
- Deciders: jonmaxmore (project owner)
- Supersedes: None
- Related:
  - `apps/mobile-app/` (Flutter scaffold, ~142 Dart files)
  - `docs/audit/2026-04-25-ux-and-provider-gap-report.md`
  - ADR-003: Offline-First via IndexedDB (the offline-sync contract a future mobile activation would need)

## Context

A Flutter mobile app at `apps/mobile-app/` has been part of the monorepo since v1.0. It contains ~142 Dart source files structured as a clean architecture (core / data / domain / features / presentation) and consumes the same REST API as the web app via OpenAPI-generated clients at `apps/mobile-app/lib/generated/api/`.

As of 2026-04-29 the mobile app:

- Has 13 outstanding `TODO` markers in load-bearing paths: GPS location service, multipart file upload, sync API calls, password-reset email flow, document review screen, audit detail download, application-detail fetch.
- Has had no feature commits since v3.0 (2026-03-08); the most recent commit on the directory was `1f22a12` (2026-04-26) — a `snapshot: preserve local working state` placeholder, not active development.
- Has a generic Flutter README with no GACP-specific onboarding, build, or test instructions.
- Is referenced by **no** CI workflow — `.github/workflows/` does not build, test, or lint the Flutter code.
- Has no production deployment target — no app-store listings, no internal distribution channel.

The web app at `apps/web-app/` is fully responsive and PWA-installable (Serwist service worker, manifest.json), so users on mobile devices already have a working path to the platform without a native install.

The original product motivation for the native app was field-officer ergonomics: GPS-bound audit locations, offline cultivation-log entry, QR scanning during inspections, photo capture with EXIF retention. None of these have a current product owner or budget.

## Decision

The mobile app is **shelved**. No active development is planned. The code remains in the monorepo as a reference scaffold for if/when the field-officer mobile use case is funded.

This is **not deletion**. The code is retained because:

1. Re-creating the clean-architecture skeleton, OpenAPI client generation, and theme/state plumbing would cost weeks if started fresh.
2. The existing `TODO` markers act as a useful map of "what would need to be wired up first" if work resumes.
3. Removing it would require rewiring `pnpm-workspace.yaml`, `openapi/openapitools.json`, and `.github/workflows/generate-api-clients.yml` — costs that exceed the disk savings.

## Conditions for resuming work

Resume mobile-app development when **all** of the following hold:

1. A named product owner takes responsibility for the mobile experience.
2. At least one field-use case has documented business value sufficient to justify roughly 6–8 weeks of focused engineering (for example, a DTAM auditor pilot, or a grower-cooperative offline-data-entry program).
3. Hosting and distribution paths are identified: TestFlight + Google Play internal-track at minimum, with a maintenance commitment that includes app-store renewal fees.
4. The backend has the corresponding mobile-friendly endpoints in scope — chunked upload for large audit photos, a stable offline-sync contract (see ADR-003).

When those conditions are met, this ADR is superseded by a new ADR documenting the activation plan, success metrics, and ownership.

## Consequences

- The PWA web experience remains the only mobile path for users today.
- New backend features should be designed assuming PWA delivery; "mobile-only" features should be flagged in PRs and routed back to product before merge.
- The 13 outstanding mobile-app `TODO`s are not bugs and should not be triaged in normal code-quality sweeps. They are intentional gaps until the activation conditions hold.
- CI cost stays low: no Flutter build/test job needed.
- The OpenAPI client-generation workflow (`.github/workflows/generate-api-clients.yml`) continues to run on `openapi/*` changes so the Dart client stays in sync — cheap insurance against bit-rot if work resumes.

## Alternatives considered

1. **Delete the directory.** Rejected — the rebuild cost outweighs the storage savings, and the OpenAPI generation paths would still need to be torn down and re-stood up if work resumes.
2. **Active maintenance — fix all 13 TODOs and ship to TestFlight.** Rejected — there is no product owner and no documented use case sized for 6–8 weeks of engineering.
3. **Hand off to a contractor.** Rejected — same blockers (no use case, no owner) plus contractor coordination overhead and the IP-handoff problem on resume.
