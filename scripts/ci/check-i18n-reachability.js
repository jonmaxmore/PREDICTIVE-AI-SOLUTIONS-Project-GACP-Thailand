#!/usr/bin/env node
'use strict';

/**
 * How much of the dictionary does the app actually render?
 *
 * A key nothing reads is not spare capacity. It is a page that hardcoded
 * its copy instead of looking it up, which means that page cannot be
 * translated: the English side of the same key is equally unread, so a
 * user who has chosen English still gets Thai there. PR #705 found one
 * such page by rendering it; this finds the rest by reading the source.
 *
 * The analysis resolves the three ways this codebase reaches copy:
 *
 *   dict.a.b.c        property chains from the useLanguage() hook,
 *                     including `?.` links and locals aliased off them
 *                     (`const pDict = dict.provider` -> `pDict.metrics`),
 *                     resolved to a fixpoint so alias-of-alias works
 *   t('a.b.c')        the dotted-string helper, 223 call sites
 *   th.a.b.c          a direct module import, which server components
 *                     must use because they cannot call the hook
 *
 * ONE DIRECTION OF ERROR IS ACCEPTABLE. Calling a dead key live wastes a
 * little space. Calling a live key dead invites someone to delete copy
 * that users are reading. So every construct the resolver cannot follow —
 * a computed index, a subtree handed to a function, a dynamic t() — marks
 * its subtree REACHED. The number this prints is a floor.
 *
 * Usage:
 *   node scripts/ci/check-i18n-reachability.js            report + ratchet
 *   node scripts/ci/check-i18n-reachability.js --list     print the paths
 */

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '../..');
const WEB_APP = path.join(REPO_ROOT, 'apps/web-app');
const BASELINE_FILE = path.join(__dirname, 'i18n-reachability-baseline.json');

/** Sentinel meaning "any key may be reached"; see the dynamic-t() case. */
const ACCESS_ROOT = '*';

const SKIP_DIRS = ['node_modules', '.next', 'build', 'coverage', 'dist', '.turbo'];
const SOURCE_EXT = ['.ts', '.tsx'];

/**
 * The i18n implementation reads the dictionary generically — `t()` walks
 * it by path — so scanning it would mark everything reached and make the
 * gate vacuous. Consumers are what we want to measure.
 */
// `src/lib/i18n.ts` used to be listed here too — a second, older i18n runtime
// that fetched /locales/{th,en}/common.json at runtime. It had zero consumers
// anywhere in the app (its own docstring was the only reference to it), so it
// and the 266-leaf JSON pair it served were deleted rather than excluded.
const NOT_A_CONSUMER = [
    'src/lib/i18n/dictionaries/',
    'src/lib/i18n/language-context.tsx',
];

function loadTypeScript() {
    try {
        return require(require.resolve('typescript', { paths: [WEB_APP] }));
    } catch {
        throw new Error(
            'check-i18n-reachability needs the TypeScript compiler. Run this after '
            + 'dependencies are installed (the CI lint job does `pnpm install` first).',
        );
    }
}

/**
 * Every dotted leaf path in one language's dictionary.
 *
 * Read out of the syntax tree rather than by evaluating the module. A
 * gate whose premise is "parse it, do not guess" has no business running
 * the code it inspects, and this way a section file that one day imports
 * a helper still yields its literal keys instead of throwing.
 */
function dictionaryLeaves(webAppDir, language) {
    const ts = loadTypeScript();
    const sectionsDir = path.join(webAppDir, 'src/lib/i18n/dictionaries/sections');
    const out = [];

    /** Recurse through a `{ … }` literal, emitting a path per non-object value. */
    const walkObject = (node, prefix) => {
        for (const prop of node.properties) {
            if (!ts.isPropertyAssignment(prop)) {
                continue;
            }
            const name = ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name)
                ? prop.name.text
                : null;
            if (name === null) {
                continue;
            }
            const dotted = prefix ? `${prefix}.${name}` : name;
            if (ts.isObjectLiteralExpression(prop.initializer)) {
                walkObject(prop.initializer, dotted);
            } else {
                out.push(dotted);
            }
        }
    };

    for (const file of fs.readdirSync(sectionsDir).filter((n) => n.startsWith(`${language}-`))) {
        const full = path.join(sectionsDir, file);
        const sourceFile = ts.createSourceFile(
            full, fs.readFileSync(full, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS,
        );
        // Each section file is `export const <name> = { <lang-root>: { … } }`.
        // The language root (`health`, `wizard`, …) is part of the path, so
        // the walk starts at the exported literal itself.
        (function findExport(node) {
            if (ts.isVariableStatement(node)
                && node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
                for (const decl of node.declarationList.declarations) {
                    if (decl.initializer && ts.isObjectLiteralExpression(decl.initializer)) {
                        walkObject(decl.initializer, '');
                    }
                }
            }
            ts.forEachChild(node, findExport);
        }(sourceFile));
    }
    return out;
}

/**
 * Walk a property-access chain down to its root identifier.
 * Returns `{ root, segments }`, or null if the chain bottoms out in
 * something that is not a plain identifier (a call, an index, `this`).
 */
function unwindChain(ts, node) {
    const segments = [];
    let current = node;
    while (ts.isPropertyAccessExpression(current)) {
        segments.unshift(current.name.text);
        current = current.expression;
    }
    return ts.isIdentifier(current) ? { root: current.text, segments } : null;
}

/**
 * Resolve the set of dictionary paths reached by the given sources.
 * Each source is `{ file, text }` so callers can pass real files or, in
 * tests, snippets.
 */
function reachablePaths(sources) {
    const ts = loadTypeScript();
    const reached = new Set();

    for (const { file, text } of sources) {
        const sourceFile = ts.createSourceFile(
            file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX,
        );

        // Roots that ARE the dictionary: the hook's `dict` binding, plus
        // any identifier imported from a dictionary module. A local named
        // `th` that came from somewhere else is not a root.
        const roots = new Set(['dict']);
        (function collectRoots(node) {
            if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)
                && /(^|\/)dictionaries\/(th|en)$/.test(node.moduleSpecifier.text)) {
                const bindings = node.importClause && node.importClause.namedBindings;
                if (bindings && ts.isNamedImports(bindings)) {
                    for (const element of bindings.elements) {
                        roots.add(element.name.text);
                    }
                }
            }
            ts.forEachChild(node, collectRoots);
        }(sourceFile));

        // Locals aliased off a root, to a fixpoint so `const m = pDict.metrics`
        // resolves after `const pDict = dict.provider` has been seen.
        const aliases = new Map();
        for (let pass = 0; pass < 8; pass += 1) {
            let changed = false;
            (function collectAliases(node) {
                if (ts.isVariableDeclaration(node) && node.initializer && ts.isIdentifier(node.name)) {
                    const chain = unwindChain(ts, node.initializer);
                    if (chain) {
                        let prefix = null;
                        if (roots.has(chain.root)) {
                            prefix = chain.segments.join('.');
                        } else if (aliases.has(chain.root)) {
                            prefix = [aliases.get(chain.root), ...chain.segments].filter(Boolean).join('.');
                        }
                        if (prefix !== null && aliases.get(node.name.text) !== prefix) {
                            aliases.set(node.name.text, prefix);
                            changed = true;
                        }
                    }
                }
                ts.forEachChild(node, collectAliases);
            }(sourceFile));
            if (!changed) {
                break;
            }
        }

        const resolve = (chain) => (roots.has(chain.root)
            ? chain.segments.join('.')
            : [aliases.get(chain.root), ...chain.segments].filter(Boolean).join('.'));

        (function collectAccess(node) {
            // t('a.b.c'), and its template form.
            if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)
                && node.expression.text === 't' && node.arguments.length > 0) {
                const arg = node.arguments[0];
                if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) {
                    reached.add(arg.text);
                } else if (ts.isTemplateExpression(arg)) {
                    // `wizard.generalStep.typeNames.${kind}` can only name a
                    // child of typeNames, so widening to the whole dictionary
                    // would discard the analysis — one such call took the
                    // report from ~1000 unreached to 0. Keep the static head
                    // and drop any half-finished segment before the first
                    // substitution: in `wizard.step${n}.title`, "step" is a
                    // fragment, so the parent is the most we can claim.
                    const head = arg.head.text;
                    const prefix = head.endsWith('.')
                        ? head.slice(0, -1)
                        : head.slice(0, Math.max(0, head.lastIndexOf('.')));
                    reached.add(prefix ? `${prefix}.${ACCESS_ROOT}` : ACCESS_ROOT);
                } else {
                    reached.add(ACCESS_ROOT);
                }
            }

            // The outermost link of a chain carries the full path; inner
            // links would only add prefixes we already cover.
            if (ts.isPropertyAccessExpression(node) && !ts.isPropertyAccessExpression(node.parent)) {
                const chain = unwindChain(ts, node);
                if (chain && (roots.has(chain.root) || aliases.has(chain.root))) {
                    reached.add(resolve(chain));
                }
            }

            // dict.a.b[expr] — the key is not knowable here, so the whole
            // subtree counts as reached.
            if (ts.isElementAccessExpression(node)) {
                const chain = unwindChain(ts, node.expression);
                if (chain && (roots.has(chain.root) || aliases.has(chain.root))) {
                    reached.add(`${resolve(chain)}.${ACCESS_ROOT}`);
                }
            }
            ts.forEachChild(node, collectAccess);
        }(sourceFile));

        // An alias may be handed to a function or spread rather than read
        // key by key. Treat everything under it as reached.
        for (const prefix of aliases.values()) {
            reached.add(prefix ? `${prefix}.${ACCESS_ROOT}` : ACCESS_ROOT);
        }
    }
    return reached;
}

/** Leaves that no resolved path covers. */
function unreachedLeaves(leaves, reached) {
    if (reached.has(ACCESS_ROOT)) {
        return [];
    }
    const subtrees = [...reached]
        .filter((p) => p.endsWith(`.${ACCESS_ROOT}`))
        .map((p) => p.slice(0, -(ACCESS_ROOT.length + 1)));
    const exact = new Set([...reached].filter((p) => !p.endsWith(`.${ACCESS_ROOT}`)));
    // A path that stops above a leaf still reaches it: reading
    // `dict.a.b` where `b` is an object means `b`'s leaves render.
    const prefixes = [...exact];
    return leaves.filter((leaf) => {
        if (exact.has(leaf)) {
            return false;
        }
        if (subtrees.some((s) => leaf === s || leaf.startsWith(`${s}.`))) {
            return false;
        }
        if (prefixes.some((p) => leaf.startsWith(`${p}.`) || p.startsWith(`${leaf}.`))) {
            return false;
        }
        return true;
    });
}

function consumerSources(webAppDir) {
    const root = path.join(webAppDir, 'src');
    const out = [];
    (function walk(dir) {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (SKIP_DIRS.includes(entry.name)) {
                continue;
            }
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(full);
                continue;
            }
            if (!SOURCE_EXT.includes(path.extname(entry.name))) {
                continue;
            }
            const rel = path.relative(webAppDir, full).split(path.sep).join('/');
            if (NOT_A_CONSUMER.some((skip) => rel.startsWith(skip))) {
                continue;
            }
            out.push({ file: full, text: fs.readFileSync(full, 'utf8') });
        }
    }(root));
    return out;
}

function analyse() {
    const leaves = dictionaryLeaves(WEB_APP, 'th');
    const reached = reachablePaths(consumerSources(WEB_APP));
    const unreached = unreachedLeaves(leaves, reached);
    return { leaves, reached, unreached };
}

function main() {
    const { leaves, unreached } = analyse();
    const listOnly = process.argv.includes('--list');

    if (listOnly) {
        for (const p of unreached.sort()) {
            process.stdout.write(`${p}\n`);
        }
        return 0;
    }

    const baseline = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'));
    const pct = ((unreached.length / leaves.length) * 100).toFixed(1);
    process.stdout.write(
        `[i18n-reachability] ${unreached.length} of ${leaves.length} Thai leaves unreached (${pct}%), `
        + `budget ${baseline.maxUnreached}\n`,
    );

    if (unreached.length > baseline.maxUnreached) {
        const grew = unreached.length - baseline.maxUnreached;
        process.stderr.write(
            `\n[i18n-reachability] FAILED: ${grew} more unreached key(s) than the budget allows.\n\n`
            + 'A key nothing reads means a page hardcoded its copy instead of looking it up,\n'
            + 'so that page renders Thai even for a user who has selected English.\n\n'
            + 'Read the new copy from the dictionary rather than inlining it. If you are\n'
            + 'deliberately retiring a feature, lower `maxUnreached` in\n'
            + `${path.relative(REPO_ROOT, BASELINE_FILE)} in the same commit that removes its keys.\n\n`
            + 'To see the full list:  node scripts/ci/check-i18n-reachability.js --list\n',
        );
        return 1;
    }
    return 0;
}

module.exports = {
    ACCESS_ROOT,
    NOT_A_CONSUMER,
    analyse,
    consumerSources,
    dictionaryLeaves,
    reachablePaths,
    unreachedLeaves,
    main,
};

if (require.main === module) {
    process.exit(main());
}
