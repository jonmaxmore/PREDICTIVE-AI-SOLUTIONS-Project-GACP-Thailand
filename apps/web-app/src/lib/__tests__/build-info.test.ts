/**
 * What commit is this Next.js server running?
 *
 * Mirror of apps/backend/__tests__/unit/build-info.test.js, and deliberately a
 * mirror rather than a shared package: the two live in different languages and
 * different build systems, and packages/ is not in this app's ts-jest transform.
 *
 * Everything here protects one distinction: "this build does not know what it
 * is" (null) must not look like "this build is some commit" (a string).
 * scripts/probes/deploy-drift.sh compares this against a git ref, and a
 * placeholder like "unknown" compares unequal to every real SHA — so it would
 * report drift and send somebody chasing a deploy that already happened,
 * instead of saying the image cannot answer.
 *
 * The frontend is the half that actually went stale: on 2026-08-14
 * gacp-frontend-staging was running an image built 2026-07-23, two days before
 * the audit that removed 29 outbound flows.
 * Spec: design note 2026-08-14-runtime-deploy-drift-design
 */
import { buildInfo } from '../build-info';

describe('buildInfo', () => {
    const saved = { ...process.env };

    afterEach(() => {
        process.env = { ...saved };
    });

    it('reports the commit from GIT_SHA', () => {
        process.env.GIT_SHA = '93aeb9591f0e4c2b8a7d6e5f4c3b2a1908070605';
        expect(buildInfo().revision).toBe('93aeb9591f0e4c2b8a7d6e5f4c3b2a1908070605');
    });

    it('reports the build time from BUILT_AT', () => {
        process.env.BUILT_AT = '2026-08-14T07:46:09Z';
        expect(buildInfo().builtAt).toBe('2026-08-14T07:46:09Z');
    });

    it('reports null when GIT_SHA was never set', () => {
        delete process.env.GIT_SHA;
        expect(buildInfo().revision).toBeNull();
    });

    it('reports null when GIT_SHA is empty — an ARG with no value expands to ""', () => {
        process.env.GIT_SHA = '';
        expect(buildInfo().revision).toBeNull();
    });

    it('reports null when GIT_SHA is only whitespace', () => {
        process.env.GIT_SHA = '   ';
        expect(buildInfo().revision).toBeNull();
    });

    it('trims a trailing newline — shell substitution in a build arg leaves one', () => {
        process.env.GIT_SHA = '93aeb959\n';
        expect(buildInfo().revision).toBe('93aeb959');
    });

    it('never invents a placeholder for an absent value', () => {
        delete process.env.GIT_SHA;
        delete process.env.BUILT_AT;
        expect(buildInfo()).toEqual({ revision: null, builtAt: null });
    });

    it('reads GIT_SHA, not NEXT_PUBLIC_GIT_SHA — this value must not reach the browser', () => {
        delete process.env.GIT_SHA;
        process.env.NEXT_PUBLIC_GIT_SHA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
        expect(buildInfo().revision).toBeNull();
    });
});
