/**
 * The dictionary should describe what the app renders — not what it might.
 *
 * PR #705 found `th.health.help.home` fully populated and read by nothing:
 * the page hardcoded its own divergent copy, so editing the dictionary
 * changed nothing on screen. That was not an isolated bug. Roughly half
 * the Thai dictionary is unreachable for the same reason, and because the
 * English side is unreachable in exactly the same places, a user who has
 * selected English still gets Thai on those pages.
 *
 * This gate measures reachability so the number cannot grow unnoticed.
 *
 * WHY AN AST AND NOT A GREP: a substring search for the final key segment
 * reported 342 unreached leaves; the real figure is far higher, because
 * common segments like `title` appear somewhere in the tree and mask every
 * dead path that ends in one. Going the other way is worse — an early
 * version of this analysis missed the `t('a.b.c')` string-path API (223
 * call sites) and the direct `th` module import, and would have declared
 * live copy dead. Deleting live copy on the strength of a bad scan is the
 * one failure mode this gate must never enable.
 *
 * SAFETY DIRECTION: whenever the resolver cannot prove how a subtree is
 * used, it marks that subtree REACHED. The reported number is therefore a
 * lower bound on the problem and never a reason to delete something that
 * is actually rendered.
 */

const path = require('node:path');
const {
    dictionaryLeaves,
    reachablePaths,
    unreachedLeaves,
    ACCESS_ROOT,
} = require('../../../../scripts/ci/check-i18n-reachability');

const WEB_APP = path.join(__dirname, '../../../web-app');

describe('the dictionary loader', () => {
    it('reads every leaf of the Thai dictionary', () => {
        const leaves = dictionaryLeaves(WEB_APP, 'th');
        expect(leaves.length).toBeGreaterThan(1500);
        expect(leaves).toContain('health.help.home.heroTitle');
    });

    it('reads the English dictionary to the same shape', () => {
        // Parity is enforced elsewhere; here it matters because an
        // unreachable key is unreachable in BOTH languages, which is what
        // makes it a translation failure rather than dead config.
        const th = dictionaryLeaves(WEB_APP, 'th');
        const en = dictionaryLeaves(WEB_APP, 'en');
        expect(en.length).toBe(th.length);
    });
});

describe('reachability: dict.a.b property chains', () => {
    it('resolves a direct chain', () => {
        const reached = reachablePaths([
            { file: 'x.tsx', text: "const { dict } = useLanguage(); return <p>{dict.common.cancel}</p>;" },
        ]);
        expect(reached.has('common.cancel')).toBe(true);
    });

    it('resolves a chain written with optional links', () => {
        // The codebase writes `dict.provider?.audits?.dashboard`.
        const reached = reachablePaths([
            { file: 'x.tsx', text: "const a = dict.provider?.audits?.dashboard; return a.title;" },
        ]);
        expect(reached.has('provider.audits.dashboard.title')).toBe(true);
    });

    it('follows an alias to a second alias', () => {
        // Real pattern: `const pDict = dict.provider` then `const m = pDict?.metrics`.
        const reached = reachablePaths([
            { file: 'x.tsx', text: "const pDict = dict.provider; const m = pDict?.metrics; return m.total;" },
        ]);
        expect(reached.has('provider.metrics.total')).toBe(true);
    });
});

describe('reachability: the t() string-path API', () => {
    it('resolves a literal dotted path', () => {
        const reached = reachablePaths([
            { file: 'x.tsx', text: "const { t } = useLanguage(); return t('wizard.common.errorTitle');" },
        ]);
        expect(reached.has('wizard.common.errorTitle')).toBe(true);
    });

    it('narrows a template literal to the subtree its prefix names', () => {
        // Real call: t(`wizard.generalStep.typeNames.${applicantType}`).
        // The interpolation can only name a child of `typeNames`, so
        // widening to the whole dictionary — which is what "cannot
        // resolve" first did — throws away the entire analysis: one such
        // call made the gate report 0 unreached out of 1934.
        const reached = reachablePaths([
            { file: 'x.tsx', text: 'const { t } = useLanguage(); return t(`wizard.generalStep.typeNames.${kind}`);' },
        ]);
        expect(reached.has(ACCESS_ROOT)).toBe(false);
        expect(unreachedLeaves(['wizard.generalStep.typeNames.individual'], reached)).toEqual([]);
        expect(unreachedLeaves(['auth.register.title'], reached)).toEqual(['auth.register.title']);
    });

    it('drops a partial trailing segment before narrowing', () => {
        // t(`wizard.step${n}.title`) — "step" is half a segment, so the
        // safe subtree is the parent, not `wizard.step`.
        const reached = reachablePaths([
            { file: 'x.tsx', text: 'const { t } = useLanguage(); return t(`wizard.step${n}.title`);' },
        ]);
        expect(unreachedLeaves(['wizard.anything.title'], reached)).toEqual([]);
        expect(unreachedLeaves(['auth.register.title'], reached)).toEqual(['auth.register.title']);
    });

    it('treats a template with no static prefix as reaching everything', () => {
        const reached = reachablePaths([
            { file: 'x.tsx', text: 'const { t } = useLanguage(); return t(`${section}.title`);' },
        ]);
        expect(reached.has(ACCESS_ROOT)).toBe(true);
    });

    it('treats a backtick string with no interpolation as a literal path', () => {
        const reached = reachablePaths([
            { file: 'x.tsx', text: "const { t } = useLanguage(); return t(`common.cancel`);" },
        ]);
        expect(reached.has('common.cancel')).toBe(true);
    });

    it('treats a non-literal argument as reaching everything', () => {
        // t(someVariable) can name any key at runtime. Proving nothing is
        // the only honest answer, and the gate must not then claim a key
        // is dead.
        const reached = reachablePaths([
            { file: 'x.tsx', text: "const { t } = useLanguage(); return t(keyFromProps);" },
        ]);
        expect(reached.has(ACCESS_ROOT)).toBe(true);
    });
});

describe('reachability: direct dictionary imports', () => {
    it('resolves a chain rooted at an imported dictionary', () => {
        // app/help/page.tsx does exactly this — a server component cannot
        // use the hook, so it imports `th` and reads it directly.
        const reached = reachablePaths([
            {
                file: 'page.tsx',
                text: "import { th } from '@/lib/i18n/dictionaries/th';\nconst copy = th.health.help.home;\nexport default () => <h1>{copy.heroTitle}</h1>;",
            },
        ]);
        expect(reached.has('health.help.home.heroTitle')).toBe(true);
    });

    it('ignores an identically named local that is not the dictionary', () => {
        const reached = reachablePaths([
            { file: 'x.tsx', text: "const th = { some: { thing: 1 } }; return th.some.thing;" },
        ]);
        expect(reached.has('some.thing')).toBe(false);
    });
});

describe('reachability stays conservative when it cannot prove usage', () => {
    it('marks a whole subtree reached when it is accessed computationally', () => {
        const reached = reachablePaths([
            { file: 'x.tsx', text: "const { dict } = useLanguage(); return dict.dashboard.status[code];" },
        ]);
        expect(unreachedLeaves(['dashboard.status.draft', 'dashboard.status.paid'], reached)).toEqual([]);
    });

    it('marks a subtree reached when it is aliased but not further resolved', () => {
        const reached = reachablePaths([
            { file: 'x.tsx', text: "const copy = dict.health.renewal; return render(copy);" },
        ]);
        expect(unreachedLeaves(['health.renewal.title'], reached)).toEqual([]);
    });

    it('reports a leaf as unreached only when nothing touches its path', () => {
        const reached = reachablePaths([
            { file: 'x.tsx', text: "const { dict } = useLanguage(); return dict.common.cancel;" },
        ]);
        expect(unreachedLeaves(['common.cancel', 'auth.register.title'], reached))
            .toEqual(['auth.register.title']);
    });
});
