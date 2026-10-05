#!/usr/bin/env node
/**
 * check-thai-copy-style
 *
 * Two typographic rules from the thai-ui-copy guideline, enforced instead of
 * remembered:
 *
 *   1. Thai separates clauses with a space, not an em dash.
 *   2. ไม้ยมก (ๆ) takes a space before it, per Royal Institute style.
 *
 * Both are about how Thai reads. Neither is about English, so an English string
 * may use a dash freely, and neither is about code, so a comment may say
 * whatever it likes.
 *
 * WHY THIS IS NOT A GREP
 *
 * The obvious greps are wrong in both directions, measurably so on this
 * repository:
 *
 *   grep -rlE '[ก-๙].*—' apps/web-app/src            -> 101 files
 *   grep -rlE "'[^']*[ก-๙][^']*—[^']*'" ...          ->  80 files
 *
 * The first counts English code comments that merely sit near Thai text. The
 * second is worse: an apostrophe in an English comment ("don't", "the
 * operator's") opens what the regex takes to be a string literal, so unrelated
 * text downstream is read as copy. The true count is far smaller.
 *
 * That gap matters twice over. A gate that reports 80 false positives gets
 * switched off, and a bulk rewrite driven by one of those greps edits comments
 * and logic — which is exactly how a style pass damages a codebase.
 *
 * So: strip comments, then read string literals, then look only at literals
 * containing Thai. Test files are skipped deliberately — their strings are
 * assertions about behaviour, and rewriting one to satisfy a style rule is how
 * a green gate stops meaning anything.
 */

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '../..');

/**
 * Where user-facing copy lives.
 *
 * `apps/backend` is here because it emits Thai the applicant reads —
 * notification bodies, workflow rejection reasons, the Thai side of the error
 * map. The first version of this gate scanned only the two front ends while
 * claiming the rules were enforced; a gate quoted as evidence has to cover the
 * ground it claims.
 */
const SCAN_ROOTS = ['apps/web-app/src', 'apps/mobile-app/lib', 'apps/backend'];

const SCAN_EXTENSIONS = ['.ts', '.tsx', '.dart', '.js'];

/** Trees nobody here writes by hand. */
const SKIP_DIRS = ['node_modules', 'build', '.next', 'coverage', 'dist', '.turbo'];

/** Any Thai character. A literal without one is not Thai copy. */
const THAI = /[฀-๿]/;

const RULES = [
    {
        id: 'em-dash',
        test: (text) => text.includes('—'),
        why: 'Thai separates clauses with a space, not an em dash (—)',
    },
    {
        id: 'maiyamok',
        // A ๆ that follows a Thai character directly, with no space between.
        test: (text) => /[฀-๿]ๆ/.test(text),
        why: 'ไม้ยมก takes a space before it: "อื่น ๆ" not "อื่นๆ"',
    },
];

/** A file whose strings are assertions rather than copy. */
function isSkipped(file) {
    const normalised = file.split(path.sep).join('/');
    return /(^|\/)__tests__\//.test(normalised)
        || /\.test\.[jt]sx?$/.test(normalised)
        || /\.spec\.[jt]sx?$/.test(normalised)
        || /_test\.dart$/.test(normalised);
}

/**
 * Replace comment bodies with spaces, preserving offsets and newlines so line
 * numbers stay true.
 *
 * Quote characters inside comments are erased here, which is the whole point:
 * an apostrophe in prose must not be able to open a string literal.
 */
function blankComments(source) {
    let out = '';
    let index = 0;
    let state = 'code';
    let quote = '';

    while (index < source.length) {
        const char = source[index];
        const next = source[index + 1];

        if (state === 'code') {
            if (char === '/' && next === '/') {
                state = 'line-comment';
                out += '  ';
                index += 2;
                continue;
            }
            if (char === '/' && next === '*') {
                state = 'block-comment';
                out += '  ';
                index += 2;
                continue;
            }
            if (char === '"' || char === "'" || char === '`') {
                state = 'string';
                quote = char;
                out += char;
                index += 1;
                continue;
            }
            out += char;
            index += 1;
            continue;
        }

        if (state === 'string') {
            if (char === '\\') {
                out += source.slice(index, index + 2);
                index += 2;
                continue;
            }
            if (char === quote) {
                state = 'code';
                quote = '';
            }
            out += char;
            index += 1;
            continue;
        }

        if (state === 'line-comment') {
            if (char === '\n') {
                state = 'code';
                out += '\n';
            } else {
                out += ' ';
            }
            index += 1;
            continue;
        }

        // block-comment
        if (char === '*' && next === '/') {
            state = 'code';
            out += '  ';
            index += 2;
            continue;
        }
        out += char === '\n' ? '\n' : ' ';
        index += 1;
    }

    return out;
}

/**
 * The TypeScript compiler, resolved from the web app that depends on it.
 *
 * Scanning TS/TSX by hand does not work, and this repository proves it: a
 * regex literal containing a quote —
 *
 *     /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
 *
 * — opens a string as far as a hand-rolled scanner is concerned, and every
 * quote after it pairs one step out. The gate reported a violation whose text
 * was `: '—',`: a fragment of source, carrying Thai from one place and a dash
 * from another. Regex-versus-division, JSX text, and nested template
 * substitutions are all the same shape of problem. The compiler already knows
 * all of it.
 */
function loadTypeScript() {
    try {
        return require(require.resolve('typescript', { paths: [path.join(REPO_ROOT, 'apps/web-app')] }));
    } catch {
        return null;
    }
}

/** String literals in TS/TSX, located by the compiler. */
function typescriptLiterals(source, file) {
    const ts = loadTypeScript();
    if (!ts) {
        throw new Error('typescript is required to scan .ts/.tsx — run the workspace install first');
    }

    const sourceFile = ts.createSourceFile(
        file || 'file.tsx',
        source,
        ts.ScriptTarget.Latest,
        true,
        /\.tsx$/.test(file || '') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );

    const literals = [];
    const visit = (node) => {
        const isLiteral = node.kind === ts.SyntaxKind.StringLiteral
            || node.kind === ts.SyntaxKind.NoSubstitutionTemplateLiteral
            || node.kind === ts.SyntaxKind.TemplateHead
            || node.kind === ts.SyntaxKind.TemplateMiddle
            || node.kind === ts.SyntaxKind.TemplateTail
            || node.kind === ts.SyntaxKind.JsxText;

        if (isLiteral && typeof node.text === 'string') {
            const start = node.getStart(sourceFile);
            literals.push({
                body: node.text,
                line: sourceFile.getLineAndCharacterOfPosition(start).line + 1,
                // Raw span including delimiters. The two transformations only
                // ever touch — and ๆ, neither of which can appear in a quote,
                // a backtick or a ${ } boundary, so rewriting the raw slice
                // cannot damage the literal's structure.
                start,
                end: node.getEnd(),
            });
        }
        ts.forEachChild(node, visit);
    };
    visit(sourceFile);

    return literals;
}

/**
 * String literals in Dart.
 *
 * Dart is regular enough to scan directly, but only if the three forms it
 * actually uses are handled: `'''`/`"""` blocks that span lines, `r'...'` raw
 * strings where a backslash is not an escape, and ordinary quotes. This
 * repository contains 10 of the first and 303 of the second, so skipping them
 * is not an option.
 */
/** `ไ` and `\u{0E44}` to the character they denote; anything else is left as written. */
function decodeDartEscapes(text) {
    return text
        .replace(/\\u\{([0-9a-fA-F]+)\}/g, (match, hex) => safeFromCodePoint(hex, match))
        .replace(/\\u([0-9a-fA-F]{4})/g, (match, hex) => safeFromCodePoint(hex, match));
}

function safeFromCodePoint(hex, fallback) {
    const code = Number.parseInt(hex, 16);
    if (!Number.isFinite(code) || code > 0x10ffff) {
        return fallback;
    }
    try {
        return String.fromCodePoint(code);
    } catch {
        return fallback;
    }
}

function dartLiterals(source) {
    const literals = [];
    let index = 0;

    const lineAt = (offset) => source.slice(0, offset).split('\n').length;

    while (index < source.length) {
        const char = source[index];
        const isRaw = char === 'r' && (source[index + 1] === "'" || source[index + 1] === '"');
        const quoteStart = isRaw ? index + 1 : index;
        const quote = source[quoteStart];

        if (quote !== '"' && quote !== "'") {
            index += 1;
            continue;
        }

        const triple = source.slice(quoteStart, quoteStart + 3) === quote.repeat(3);
        const delimiter = triple ? quote.repeat(3) : quote;
        const start = index;
        let cursor = quoteStart + delimiter.length;
        let body = '';

        while (cursor < source.length) {
            if (!isRaw && source[cursor] === '\\') {
                body += source.slice(cursor, cursor + 2);
                cursor += 2;
                continue;
            }
            if (source.slice(cursor, cursor + delimiter.length) === delimiter) {
                cursor += delimiter.length;
                break;
            }
            if (source[cursor] === '\n' && !triple) {
                break;
            }
            body += source[cursor];
            cursor += 1;
        }

        // Thai spelled as \u escapes is still Thai on screen. TS/TSX gets this
        // for free — the compiler hands back cooked text — but this scanner
        // keeps escapes raw, so without decoding, a literal holding no literal
        // Thai character reads as "not Thai copy" and its em dash rides
        // through. A raw string is exempt: in r'...' a backslash is a
        // backslash, so decoding there would invent a violation.
        literals.push({
            body: isRaw ? body : decodeDartEscapes(body),
            line: lineAt(start),
            start,
            end: cursor,
        });
        index = cursor;
    }

    return literals;
}

/** Every string literal in a file, with its line number. */
function stringLiterals(source, file = '') {
    return path.extname(file) === '.dart'
        ? dartLiterals(source)
        : typescriptLiterals(source, file || 'file.tsx');
}

/**
 * @param {string} source file contents
 * @param {string} file   path, used only to decide nothing here — kept so
 *   callers can pass it through to the report
 * @returns {Array<{rule: string, line: number, text: string, why: string}>}
 */
function findViolations(source, file = '') {
    const violations = [];
    // The compiler already knows what a comment is; the Dart scanner does not,
    // so only that path needs them blanked first.
    const literals = path.extname(file) === '.dart'
        ? stringLiterals(blankComments(source), file)
        : stringLiterals(source, file);

    for (const literal of literals) {
        if (!THAI.test(literal.body)) {
            continue;
        }
        for (const rule of RULES) {
            if (rule.test(literal.body)) {
                violations.push({
                    rule: rule.id,
                    line: literal.line,
                    text: literal.body.trim(),
                    why: rule.why,
                    file,
                });
            }
        }
    }

    return violations;
}

function walk(dir, found = []) {
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return found;
    }
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (SKIP_DIRS.includes(entry.name)) {
                continue;
            }
            walk(full, found);
        } else if (SCAN_EXTENSIONS.includes(path.extname(entry.name))) {
            found.push(full);
        }
    }
    return found;
}

function main() {
    const violations = [];

    for (const root of SCAN_ROOTS) {
        for (const file of walk(path.join(REPO_ROOT, root))) {
            const relative = path.relative(REPO_ROOT, file).split(path.sep).join('/');
            if (isSkipped(relative)) {
                continue;
            }
            violations.push(...findViolations(fs.readFileSync(file, 'utf8'), relative));
        }
    }

    if (violations.length === 0) {
        console.log('[thai-copy-style] OK — no em dash or ไม้ยมก spacing issues in Thai copy');
        return 0;
    }

    console.error(`[thai-copy-style] ${violations.length} issue(s):\n`);
    for (const violation of violations) {
        console.error(`  ${violation.file}:${violation.line}  [${violation.rule}]  ${violation.why}`);
        console.error(`    ${violation.text}\n`);
    }
    return 1;
}

module.exports = { SCAN_ROOTS, SCAN_EXTENSIONS, SKIP_DIRS, RULES, isSkipped, blankComments, stringLiterals, findViolations, main };

if (require.main === module) {
    try {
        process.exit(main());
    } catch (error) {
        console.error('[thai-copy-style] runtime error:', error.message);
        process.exit(1);
    }
}
