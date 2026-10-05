#!/usr/bin/env node

// Detects AI-smell patterns the team has agreed to keep out of source code
// (memory: feedback_human_style_code.md). Scans .js / .ts / .tsx / .prisma
// under apps/, scripts/, packages/ — skips node_modules, .next, dist, build,
// generated client output, and migration SQL.
//
// Patterns flagged:
//   1. ASCII banner triplets / standalone bars (// ===========, // ----------)
//   2. Emoji inside line/block comments OR inside logger.* / console.* calls
//
// User-facing strings (NotifyTemplates, i18n catalogues, *.locale.json,
// Thai notification templates) are EXEMPT — emoji there is product copy.

const fs = require('fs');
const path = require('path');

const ROOTS = ['apps', 'scripts', 'packages'];
const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', 'build', 'coverage', '.git', '.turbo', 'generated']);
const SKIP_FILE_PATTERNS = [
    /\.min\.js$/,
    /apps[\\/]+mobile-app[\\/]+lib[\\/]+generated/,
    /\.prisma[\\/]+migrations[\\/].*\.sql$/,
];

// Files where emoji is intentional product copy — applicant/officer-facing
// notification text, i18n strings, OG metadata, etc.
const EMOJI_EXEMPT_FILES = [
    /services[\\/]+notification-service\.js$/,
    /services[\\/]+notification[\\/].*\.js$/,
    /lib[\\/]+i18n[\\/]/,
    /[\\/]+locales[\\/]/,
    /[\\/]+translations?[\\/]/,
];

const EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.cjs', '.mjs', '.prisma']);

const BANNER_RE = /^\s*\/\/\s*[=\-#_]{5,}\s*$/;
const COMMENT_LINE_RE = /^\s*(\/\/|\*|\/\*)/;
const LOGGER_CALL_RE = /\b(logger|console)\.(log|info|warn|error|debug)\s*\(/;
// Stateless (no /g) — `.test()` on a /g regex stores lastIndex between calls
// and skips matches on subsequent lines. Detection regex stays non-global.
const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}\u{2300}-\u{23FF}]/u;

const banners = [];
const emojiInComments = [];
const emojiInLogger = [];

function isExempt(file) {
    return EMOJI_EXEMPT_FILES.some((re) => re.test(file));
}

function shouldSkip(file) {
    return SKIP_FILE_PATTERNS.some((re) => re.test(file));
}

function walk(dir) {
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return;
    }
    for (const entry of entries) {
        if (SKIP_DIRS.has(entry.name)) {
            continue;
        }
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            walk(full);
            continue;
        }
        if (!entry.isFile()) {
            continue;
        }
        if (shouldSkip(full)) {
            continue;
        }
        if (!EXTENSIONS.has(path.extname(entry.name))) {
            continue;
        }
        scan(full);
    }
}

function scan(file) {
    let content;
    try {
        content = fs.readFileSync(file, 'utf8');
    } catch {
        return;
    }
    const exempt = isExempt(file);
    const lines = content.split('\n');
    let inBlockComment = false;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineNumber = i + 1;

        if (BANNER_RE.test(line)) {
            banners.push({ file, line: lineNumber, snippet: line.trim().slice(0, 60) });
            continue;
        }

        if (exempt) {
            continue;
        }

        if (line.includes('/*')) {
            inBlockComment = true;
        }
        const isCommentContext = inBlockComment || COMMENT_LINE_RE.test(line);
        if (line.includes('*/')) {
            inBlockComment = false;
        }

        if (EMOJI_RE.test(line)) {
            if (isCommentContext) {
                emojiInComments.push({ file, line: lineNumber, snippet: line.trim().slice(0, 80) });
            } else if (LOGGER_CALL_RE.test(line)) {
                emojiInLogger.push({ file, line: lineNumber, snippet: line.trim().slice(0, 80) });
            }
        }
    }
}

for (const root of ROOTS) {
    if (fs.existsSync(root)) {
        walk(root);
    }
}

function report(label, items) {
    if (items.length === 0) {
        return false;
    }
    console.log(`\n[ai-style-smells] ${label} (${items.length}):`);
    for (const item of items.slice(0, 25)) {
        console.log(`  ${path.relative(process.cwd(), item.file)}:${item.line}  ${item.snippet}`);
    }
    if (items.length > 25) {
        console.log(`  ... ${items.length - 25} more`);
    }
    return true;
}

const hasBanners = report('ASCII banner separators', banners);
const hasCommentEmoji = report('Emoji inside comments', emojiInComments);
const hasLoggerEmoji = report('Emoji inside logger / console calls', emojiInLogger);

const total = banners.length + emojiInComments.length + emojiInLogger.length;
// Cleanup completed PR #56 (2026-04-30) brought the count to zero. Strict
// mode is the lock-in: any new banner or stray emoji introduced by a future
// PR fails this gate. The opt-out (`SOFT=1` or `--soft`) is for one-off
// situations where someone wants to see findings without blocking — not for
// deploys.
const soft = process.env.SOFT === '1' || process.argv.includes('--soft');

if (total === 0) {
    console.log('[ai-style-smells] PASS — no banner separators or stray emoji in source');
    process.exit(0);
}

console.log(`\n[ai-style-smells] ${soft ? 'WARN' : 'FAIL'} — ${total} finding(s) total`);
console.log('[ai-style-smells] Rules: see memory/feedback_human_style_code.md');
console.log('[ai-style-smells] Exempt list (product copy in Thai notification templates / i18n) lives');
console.log('[ai-style-smells]   in EMOJI_EXEMPT_FILES inside this script — extend it when adding');
console.log('[ai-style-smells]   new user-facing template files.');
console.log('[ai-style-smells]');
console.log('[ai-style-smells] Default mode is fail-on-finding (locked in 2026-04-30 once the');
console.log('[ai-style-smells]   ratchet hit zero). Pass --soft or SOFT=1 to report without');
console.log('[ai-style-smells]   exit code 1 — useful for diagnostic runs but not for CI gates.');

process.exit(soft ? 0 : 1);
