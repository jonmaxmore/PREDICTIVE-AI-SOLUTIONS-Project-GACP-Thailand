import { NextResponse } from 'next/server';
import { buildInfo } from '@/lib/build-info';

/**
 * GET /api/webapp-version — which commit is this frontend serving?
 *
 * Read by scripts/probes/deploy-drift.sh, which compares the answer against the
 * git ref this deployment is supposed to match. It exists because on 2026-08-14
 * gacp-frontend-staging was serving an image built 2026-07-23 — two days before
 * the audit that removed 29 outbound flows — and nothing in the repository could
 * see it, since every gate reads files in the repo rather than asking the
 * running system.
 *
 * WHY NOT /api/version: that path is owned by the BACKEND — its mobile
 * version-check endpoint (routes/api/index.js:436, minClientVersion). nginx
 * routes /api/* to the backend except for explicitly carved-out prefixes, so a
 * frontend route at /api/version answers fine in an isolated container and is
 * silently shadowed through the real proxy: the probe got the backend's mobile
 * answer and reported the frontend unreadable. Observed on the first probe run
 * against the deployed stack, 2026-08-14. This path has its own exact-match
 * carve-out in nginx/gacp.production.conf.
 *
 * WHY NOT a path outside /api: middleware.ts:236's matcher skips only api|_next|
 * static assets, so any other path is auth-gated and answers 307 to /login.
 *
 * `force-dynamic` is load-bearing, not boilerplate. Without it Next evaluates
 * this handler during `next build` and freezes the result into the standalone
 * output, so the image would report the BUILDER stage's environment forever —
 * where GIT_SHA is not set. The failure would be invisible: a 200 with a
 * well-formed body that is simply always null, from the one endpoint whose job
 * is to tell the truth about what is deployed.
 *
 * Unauthenticated on purpose: the probe has to reach it from any machine, and
 * the value is a commit id of a private repository — it identifies a build, it
 * does not grant anything. The trade is stated in the spec §6.
 */
export const dynamic = 'force-dynamic';

export function GET() {
    return NextResponse.json(buildInfo());
}
