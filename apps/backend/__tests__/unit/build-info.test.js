/**
 * What commit is this process running?
 *
 * The deploy-drift probe compares this value against a git ref, so everything
 * here protects one distinction: "this build does not know what it is" (null)
 * must not look like "this build is some commit" (a string). A placeholder such
 * as "unknown" compares unequal to every real SHA, so it reads as drift and
 * sends somebody chasing a deploy that already happened.
 *
 * Why this matters at all: on 2026-08-14 gacp-frontend-staging was running an
 * image built 2026-07-23, two days before the audit that removed 29 outbound
 * flows — and nothing in the repository could see it, because every gate reads
 * files in the repo rather than asking what is deployed.
 * Spec: design note 2026-08-14-runtime-deploy-drift-design
 */
const { buildInfo } = require('../../shared/build-info');

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
});
