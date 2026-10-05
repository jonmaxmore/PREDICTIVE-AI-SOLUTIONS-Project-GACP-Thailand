#!/usr/bin/env node

// One-shot remediation helper for check:ai-style findings.
//   1. Strips ASCII banner lines (// ----{5,}, // ===={5,}).
//   2. Removes emoji characters from comment text.
//   3. Strips emoji characters from logger/console calls (with whitespace cleanup).
//
// Mirrors the detection regex in scripts/ci/check-ai-style-smells.js so the
// gate goes green afterwards. Edits in place; run from repo root.

const fs = require('fs');
const path = require('path');

const ROOTS = ['apps', 'scripts', 'packages'];
const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', 'build', 'coverage', '.git', '.turbo', 'generated']);
const SKIP_FILE_PATTERNS = [
    /\.min\.js$/,
    /apps[\\/]+mobile-app[\\/]+lib[\\/]+generated/,
    /\.prisma[\\/]+migrations[\\/].*\.sql$/,
];
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
const EMOJI_PROBE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}\u{2300}-\u{23FF}]/u;
const EMOJI_STRIP = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}\u{2300}-\u{23FF}]/gu;

function isExempt(file) {
    return EMOJI_EXEMPT_FILES.some((re) => re.test(file));
}
function shouldSkip(file) {
    return SKIP_FILE_PATTERNS.some((re) => re.test(file));
}

const files = [];
function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
        if (SKIP_DIRS.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { walk(full); continue; }
        if (!entry.isFile()) continue;
        if (shouldSkip(full)) continue;
        if (!EXTENSIONS.has(path.extname(entry.name))) continue;
        files.push(full);
    }
}

let totalBanners = 0;
let totalCommentEmoji = 0;
let totalLoggerEmoji = 0;
const changedFiles = new Set();

for (const root of ROOTS) {
    if (fs.existsSync(root)) walk(root);
}

for (const file of files) {
    let content;
    try { content = fs.readFileSync(file, 'utf8'); } catch { continue; }
    const exempt = isExempt(file);
    const useCrlf = content.includes('\r\n');
    const eol = useCrlf ? '\r\n' : '\n';
    const lines = content.split(/\r?\n/);
    let inBlockComment = false;
    const outLines = [];
    let dirty = false;

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];

        if (BANNER_RE.test(line)) {
            totalBanners += 1;
            dirty = true;
            continue;
        }

        if (exempt) {
            outLines.push(line);
            continue;
        }

        if (line.includes('/*')) inBlockComment = true;
        const isCommentContext = inBlockComment || COMMENT_LINE_RE.test(line);
        if (line.includes('*/')) inBlockComment = false;

        if (EMOJI_PROBE.test(line)) {
            const before = line;
            if (isCommentContext) {
                // Strip emoji + any single trailing space.
                line = line.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}\u{2300}-\u{23FF}]\s?/gu, '');
                if (line !== before) {
                    totalCommentEmoji += 1;
                    dirty = true;
                }
            } else if (LOGGER_CALL_RE.test(line)) {
                line = line.replace(EMOJI_STRIP, '');
                // Collapse 2+ spaces (introduced by emoji removal) -- but only
                // inside template/string literals it's still safe; only one
                // emoji per slot is typical here.
                line = line.replace(/ {2,}/g, ' ');
                // Tidy ` x` artifacts where emoji+space sat at start of a tpl.
                if (line !== before) {
                    totalLoggerEmoji += 1;
                    dirty = true;
                }
            }
        }

        outLines.push(line);
    }

    if (dirty) {
        let nextContent = outLines.join(eol);
        if (content.endsWith('\n') && !nextContent.endsWith('\n')) nextContent += eol;
        fs.writeFileSync(file, nextContent);
        changedFiles.add(file);
    }
}

console.log(`[fix-ai-style] banners removed:      ${totalBanners}`);
console.log(`[fix-ai-style] comment emoji lines:  ${totalCommentEmoji}`);
console.log(`[fix-ai-style] logger emoji lines:   ${totalLoggerEmoji}`);
console.log(`[fix-ai-style] files changed:        ${changedFiles.size}`);
for (const f of [...changedFiles].sort()) {
    console.log(`  - ${path.relative(process.cwd(), f)}`);
}
