/**
 * @jest-environment node
 *
 * GET /api/webapp-version — design-reproducibility/01-build-identity.
 *
 * This is the one endpoint whose job is to tell the truth about which commit
 * a running frontend server is serving (see the route's own header comment
 * for the 2026-08-14 incident this exists to catch: gacp-frontend-staging
 * silently serving a two-day-stale image). scripts/probes/deploy-drift.sh
 * and scripts/ops/which-build.sh both read this response; Footer.tsx now
 * fetches it client-side too (design-reproducibility/01-build-identity).
 *
 * No test file existed for this route before this one — build-info.ts (the
 * function it wraps) already had thorough coverage, but nothing proved the
 * HTTP layer: that GET returns exactly `{ revision, builtAt }` as JSON, and
 * that an unset GIT_SHA/BUILT_AT answers `null` rather than a 500 or a
 * placeholder string that would read as a real (wrong) commit.
 */

import { GET, dynamic } from './route';

describe('GET /api/webapp-version', () => {
    const saved = { ...process.env };

    afterEach(() => {
        process.env = { ...saved };
    });

    it('is force-dynamic — must never freeze the BUILDER stage\'s env into the compiled output', () => {
        // See route.ts's own comment: without this, `next build` evaluates the
        // handler once and every deployed instance answers with whatever (or
        // whatever absence) the builder stage had, forever.
        expect(dynamic).toBe('force-dynamic');
    });

    it('returns the real commit and build time when the runner stage was stamped', async () => {
        process.env.GIT_SHA = '93aeb959f0e4c2b8a7d6e5f4c3b2a1908070605';
        process.env.BUILT_AT = '2026-08-14T07:46:09Z';

        const res = GET();
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toEqual({
            revision: '93aeb959f0e4c2b8a7d6e5f4c3b2a1908070605',
            builtAt: '2026-08-14T07:46:09Z',
        });
    });

    it('answers null — not a 500, not a placeholder string — when GIT_SHA/BUILT_AT were never baked in', async () => {
        delete process.env.GIT_SHA;
        delete process.env.BUILT_AT;

        const res = GET();
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toEqual({ revision: null, builtAt: null });
    });

    it('never answers with the literal "unknown" — that would compare unequal to every real SHA and read as drift', async () => {
        delete process.env.GIT_SHA;

        const res = GET();
        const body = await res.json();
        expect(body.revision).not.toBe('unknown');
        expect(body.revision).toBeNull();
    });
});
