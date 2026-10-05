#!/usr/bin/env node
/**
 * Third-party-services gate — no source file may name one of the specific
 * foreign services this platform decided, on their own facts, not to depend
 * on.
 *
 * How this runs (2026-08-14): NOTHING runs it automatically, and there is no
 * `pnpm check:` alias either. Its only invoker was `.github/workflows/ci.yml:58`
 * and GitHub Actions is permanently unavailable (the change log 2026-08-14).
 * `apps/backend/__tests__/unit/third-party-services-scope.test.js` covers the
 * scope/marker logic in the jest suite, but nothing runs this repo-wide
 * verdict over the tree; run it with
 * `node scripts/ci/check-third-party-services.js` until it has a row in
 * scripts/ci/full-gate-checks.txt.
 *
 * Background
 * ──────────
 * This platform processes citizen registration data for DTAM: national IDs,
 * contact details, and the exact GPS coordinates of privately owned farms.
 * The 2026-07-25 third-party-dependency audit (docs/audit-reports/) mapped 96
 * outbound flows and found 29 worth removing on their own facts: Firebase
 * Authentication made Google the identity provider for every login (a
 * permanent Google account record keyed by the national-ID hash), Google
 * Calendar received applicant names and farm coordinates directly from our
 * server, and map tiles, embeds and "open in maps" links disclosed a farm's
 * exact location — and the visiting officer's IP — to a foreign map operator
 * on an ordinary page view.
 *
 * (This platform separately sends payment data to a payment provider at
 * checkout. That is a disclosed, functional dependency this gate does not
 * concern itself with — retired data-residency framing does not apply here;
 * see FORBIDDEN below for exactly which services this gate blocks and why.)
 *
 * Those were removed one by one, each for its own concrete harm. This gate is
 * what stops them coming back.
 *
 * Why a repo-wide grep rather than unit tests
 * ───────────────────────────────────────────
 * The leaks were spread across four languages and three of them are not
 * reachable by the jest suites: Dart screens in apps/mobile-app, Docker
 * compose and workflow YAML, and Dockerfiles. A single lexical gate covers
 * every file the repository ships regardless of language, and it fails on the
 * one thing that actually matters — a foreign host appearing in our source.
 * The behavioural contracts (fail-closed tile resolution, CSP directives) are
 * unit-tested separately; this is the backstop, not the whole defence.
 *
 * Allowlisted mentions
 * ────────────────────
 * Prose that *describes* a removed dependency is not a dependency. Audit
 * reports, tombstone comments and this gate's own pattern list all name the
 * hosts on purpose. So the gate skips documentation paths outright and, inside
 * code, skips comments — a comment cannot issue a network request. That covers
 * line comments, JSX comments and the interior of block comments.
 *
 * Live code sometimes has to name a host too: the guard tests that assert a
 * URL is *rejected* must spell out the URL they reject. Those carry an inline
 * marker on the line:
 *
 *     'https://fonts.googleapis.com/...',  // third-party-allow: asserts this host is blocked
 *
 * A marker is preferred over a growing list of allowlisted files because it
 * sits where a reviewer will see it, states its reason, and stays greppable:
 * `grep -rn "third-party-allow" .` is the complete register of exceptions.
 *
 * Exit codes
 * ──────────
 *   0 — clean
 *   1 — at least one violation
 *   2 — runtime / IO error
 */

'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..');

/**
 * Directories that ship code we control.
 *
 * `nginx` and `deploy` are here because the config that terminates every
 * production request lives there. While they were absent this gate reported a
 * clean repository with `identitytoolkit.googleapis.com` still granted by the
 * live Content-Security-Policy header — a gate that passes because it is not
 * looking is worse than no gate, because it gets quoted as evidence.
 */
const SCAN_ROOTS = ['apps', 'scripts', 'packages', '.github', 'nginx', 'deploy'];

/** Extensions worth scanning — source and configuration, not binaries. */
const SCAN_EXTENSIONS = new Set([
    '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
    '.dart', '.yml', '.yaml', '.json', '.env', '.example',
    // nginx vhosts. Adding the directories above is not enough on its own —
    // the walker filters by extension before anything else sees the file.
    '.conf',
    // Markup. A `<link>` or an `@import` in a stylesheet block is a request the
    // browser makes before a single line of our JavaScript runs, so leaving
    // .html out meant the gate could not see the one construct that fetches a
    // font CDN with no code at all. Fourteen of the sixteen .html files this
    // repository ships are the PDF templates that carried
    // `@import url('https://fonts.googleapis.com/...')` until 2026-07-25
    // (apps/backend/assets/fonts/sarabun/README.md) — precisely the files most
    // worth watching, and precisely the ones nobody was watching.
    '.html',
]);

/** Never descend into these. */
const SKIP_DIRECTORIES = new Set([
    'node_modules', '.next', '.git', 'build', 'dist', 'coverage',
    '.dart_tool', 'ios', 'android', 'web', 'macos', 'linux', 'windows',
    'test-results', 'playwright-report', 'generated',
]);

/**
 * Paths whose whole purpose is to discuss these hosts. Documentation and
 * audit history must be free to name what was removed; so must this file.
 */
const ALLOWLISTED_PATHS = [
    'docs/',
    'scripts/ci/check-third-party-services.js',
];

/**
 * Inline escape hatch for live code that must name a host in order to reject
 * it. Requires a reason after the colon so the exception explains itself.
 */
const INLINE_ALLOW = /third-party-allow:\s*\S/;

/**
 * Specific foreign services this platform found itself disclosing data or
 * metadata to, and decided to remove — not a blanket rule against naming any
 * foreign host. Each entry names the pattern and why it is disallowed, so a
 * failure tells the reader what the concrete risk was rather than only that a
 * string matched.
 */
const FORBIDDEN = [
    {
        pattern: /openstreetmap\.org|tile\.osm\b/i,
        service: 'OpenStreetMap',
        why: 'tile and embed requests disclose the area being viewed — i.e. roughly where a Thai farm is — plus the citizen\'s IP',
    },
    {
        pattern: /\bmaps\.google\.com|google\.com\/maps|maps\.googleapis\.com/i,
        service: 'Google Maps',
        why: 'a maps link carries the farm\'s exact coordinates to Google along with the officer\'s IP and referrer',
    },
    {
        pattern: /\bapi\.mapbox\.com|tiles\.mapbox\.com|\bmaptiler\.com/i,
        service: 'Mapbox / MapTiler',
        why: 'commercial foreign tile hosts — same location/IP disclosure as any other third-party map source',
    },
    {
        // `\bfirebase\b` is the load-bearing alternative and it is deliberately
        // broader than a hostname. Every entry above it used to be a hostname,
        // and a hostname is not the shape in which Firebase actually enters a
        // codebase: the client SDK arrives as `from 'firebase/app'` and drags
        // in the `@firebase/*` scope, while the hosts it contacts only appear
        // at runtime. So the gate could watch four domains forever and still
        // not notice the dependency being wired back in — which is how
        // `apps/web-app/jest.config.mjs` kept a `firebase|@firebase` transform
        // exception in live configuration for weeks after the SDK was removed
        // (e451fd04), with this gate reporting a clean repository every run.
        // `\bfirebase\b` subsumes the old `\bfirebase-admin\b` (the hyphen is a
        // word boundary); the *io/*app/*storage hostnames still need spelling
        // out because no word boundary follows `firebase` in them.
        pattern: /identitytoolkit\.googleapis\.com|securetoken\.googleapis\.com|\bfirebase\b|firebaseio\.com|firebaseapp\.com|firebasestorage\.app/i,
        service: 'Firebase / Google Identity',
        why: 'makes Google the identity provider for Thai citizens and DTAM officers instead of the official government identity providers (ThaID / Health ID) this platform verifies against; removed entirely and must not return',
    },
    {
        pattern: /www\.googleapis\.com|googleapis\.com\/calendar|\bgoogleapis\b/i,
        service: 'Google APIs',
        why: 'the calendar integration exported applicant names, farm coordinates and both parties\' email addresses',
    },
    {
        pattern: /fonts\.googleapis\.com|fonts\.gstatic\.com/i,
        service: 'Google Fonts',
        why: 'every page view would send the visitor\'s IP to Google; fonts are self-hosted via @fontsource',
    },
];

/**
 * Split a file into lines, marking which are commentary rather than code.
 *
 * Tracks `/* ... *​/` across lines so a host named halfway through a block
 * comment is still recognised as prose, and treats JSX `{/* ... *​/}` the same
 * way. This is lexical, not a parser: a `/*` inside a string literal would
 * mislead it. That trade is deliberate — the failure mode is a missed
 * detection in an unusual file, not a false accusation, and the behavioural
 * tests cover the paths that matter most.
 */
function classifyLines(content) {
    let inBlock = false;
    return content.split('\n').map((line) => {
        const trimmed = line.trim();
        const wasInBlock = inBlock;

        const opens = (trimmed.match(/\/\*/g) || []).length;
        const closes = (trimmed.match(/\*\//g) || []).length;
        if (opens > closes) inBlock = true;
        else if (closes > opens) inBlock = false;

        const isComment = wasInBlock
            || trimmed.startsWith('//')
            || trimmed.startsWith('/*')
            || trimmed.startsWith('{/*')
            || trimmed.startsWith('*')
            || trimmed.startsWith('#')
            || trimmed.startsWith('<!--');

        return { text: line, isComment };
    });
}

function isAllowlisted(relativePath) {
    const normalised = relativePath.split(path.sep).join('/');
    return ALLOWLISTED_PATHS.some((allowed) => normalised.startsWith(allowed));
}

/**
 * The walker's scope test, kept in one place.
 *
 * The scope meta-test has to ask "would the gate have looked at this file?"
 * about every file the repository ships. Re-deriving that from SCAN_EXTENSIONS
 * on the test side would put the rule in two places, and the two would drift
 * exactly when it mattered — the `.env` special case below is already easy to
 * miss. One predicate, asked by both the walker and the test.
 */
function isScannableFile(fileName) {
    return SCAN_EXTENSIONS.has(path.extname(fileName)) || fileName.startsWith('.env');
}

function* walk(dir) {
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return;
    }
    for (const entry of entries) {
        if (entry.isDirectory()) {
            if (SKIP_DIRECTORIES.has(entry.name)) continue;
            yield* walk(path.join(dir, entry.name));
        } else if (entry.isFile()) {
            if (isScannableFile(entry.name)) {
                yield path.join(dir, entry.name);
            }
        }
    }
}

/**
 * Every forbidden reference in one file, ignoring comments and inline
 * exceptions. Separate from the walk so it can be exercised directly.
 */
function scanFile(absolutePath, relativePath) {
    const violations = [];

    let content;
    try {
        content = fs.readFileSync(absolutePath, 'utf8');
    } catch {
        return violations;
    }

    classifyLines(content).forEach((line, index) => {
        if (line.isComment) return;
        if (INLINE_ALLOW.test(line.text)) return;
        for (const rule of FORBIDDEN) {
            if (rule.pattern.test(line.text)) {
                violations.push({
                    file: relativePath,
                    line: index + 1,
                    service: rule.service,
                    why: rule.why,
                    text: line.text.trim().slice(0, 140),
                });
                break;
            }
        }
    });

    return violations;
}

function main() {
    const violations = [];
    let scanned = 0;
    const perExtension = new Map();

    for (const root of SCAN_ROOTS) {
        const absoluteRoot = path.join(REPO_ROOT, root);
        if (!fs.existsSync(absoluteRoot)) continue;

        for (const file of walk(absoluteRoot)) {
            const relative = path.relative(REPO_ROOT, file);
            if (isAllowlisted(relative)) continue;
            scanned += 1;
            const ext = path.extname(file) || '(none)';
            perExtension.set(ext, (perExtension.get(ext) || 0) + 1);
            violations.push(...scanFile(file, relative));
        }
    }

    // Report the count, not just the verdict. A gate that says "OK" without
    // saying how much it read cannot be told apart from a gate whose walker
    // returned nothing — which is the exact failure this file was written
    // about, and the exact failure that let a Google Fonts link sit in a
    // shipped .html for every one of this gate's first ten days while CI
    // reported a clean repository.
    const breakdown = [...perExtension.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([ext, count]) => `${ext}:${count}`)
        .join(' ');
    console.log(`[third-party-services] Scanned ${scanned} file(s) under ${SCAN_ROOTS.join(', ')} against ${FORBIDDEN.length} forbidden services.`);
    console.log(`[third-party-services] By extension: ${breakdown}`);

    if (violations.length === 0) {
        console.log('[third-party-services] OK — none of the specifically forbidden services is referenced in live code.');
        return 0;
    }

    console.error(`[third-party-services] FAIL — ${violations.length} reference(s) to a forbidden service in live code:\n`);
    for (const v of violations) {
        console.error(`  ${v.file}:${v.line}`);
        console.error(`    ${v.service} — ${v.why}`);
        console.error(`    ${v.text}\n`);
    }
    console.error('Each service in FORBIDDEN above was removed for a concrete, documented harm');
    console.error('(identity hand-off to Google, a location/IP disclosure, ...). Route the');
    console.error('feature through a source the operator controls, or drop it. See');
    console.error('the third-party services review for the history.');
    return 1;
}

module.exports = {
    SCAN_ROOTS,
    SCAN_EXTENSIONS,
    SKIP_DIRECTORIES,
    FORBIDDEN,
    isScannableFile,
    walk,
    scanFile,
    main,
};

// Only exit the process when run as a command. Requiring this file from a test
// must not take the test runner down with it.
if (require.main === module) {
    try {
        process.exit(main());
    } catch (error) {
        console.error('[third-party-services] runtime error:', error.message);
        process.exit(2);
    }
}
