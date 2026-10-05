'use strict';
/**
 * Class guard for the "select gap" repeat defect (2026-09-27, this incident:
 * `applicant: { select: { phone: true } }` — the User column is
 * `phoneNumber`, not `phone`; commit 83157701's narrow-select security fix
 * introduced it in two places and no *unit* test caught it because those
 * suites mock `prisma`, so a mock happily returns whatever shape a test
 * hands it. Only a real Prisma client validates a `select`/`omit`/`where`
 * against the actual schema — see the sibling doc note in
 * `apps/backend/__tests__/unit/applicant-resolver.test.js` history and
 * `.superpowers`/the change log's "select gap" entries for earlier instances of
 * this same class.
 *
 * This module answers a narrower, static version of that same question
 * WITHOUT a database, by reading `Prisma.dmmf` (the same metadata Prisma
 * Client itself validates against, so it never drifts from the schema on
 * disk) and text/brace-matching backend source. Fix-round-1 (2026-09-27
 * review) widened it past the exact bug shape; this doc is the EXACT,
 * HONEST list of what it does and does not catch, not a summary.
 *
 * ============================================================
 * CATCHES
 * ============================================================
 *
 * 1. RELATION-SCOPED inline select, anywhere in a file, any nesting depth:
 *      `<relationName>: { select: { <key>: true } }`
 *    Checked against the relation's target model — but ONLY when
 *    `<relationName>` is UNAMBIGUOUS schema-wide (see "ambiguous name"
 *    below). This is the shape of the original bug
 *    (`applicant: { select: { phone: true } }`).
 *
 * 2. TOP-LEVEL inline `select`/`omit` on a LITERAL direct Prisma call:
 *      `prisma.<model>.<op>({ select: { <key>: true } })`
 *      `prisma.<model>.<op>({ omit: { <key>: true } })`
 *    and the same with `tx.<model>.<op>(...)` (the transaction-callback
 *    convention this codebase uses — `$transaction(async (tx) => ...)`).
 *    `<model>` must be a literal identifier (`prisma.user`, not
 *    `prisma[modelVar]`), and the call's arguments must be a literal object
 *    immediately after the opening `(`. Checked against literal `<model>`'s
 *    fields via the client-property → PascalCase-model map this file derives
 *    from the schema (Prisma's own convention: first letter lower-cased,
 *    e.g. `InvoiceLineItem` → `invoiceLineItem`).
 *
 * 3. TOP-LEVEL SCALAR `where` keys on the SAME literal direct calls:
 *      `prisma.<model>.<op>({ where: { <key>: <scalar> } })`
 *    ONLY when `<key>`'s value does not open with `{` or `[` — i.e. a
 *    direct string/number/boolean/null/identifier/`new Date(...)`-shaped
 *    value, not an operator object, a relation filter, or an array. See
 *    "DOES NOT CATCH" #3-4 for exactly what that excludes.
 *
 * All three checks only look at TOP-LEVEL keys of the block they are
 * judging (brace-depth tracked): a `select` nested one level inside another
 * relation's `include`/`select` is a SEPARATE match that check #1 finds on
 * its own pass, judged against ITS OWN relation — not double-counted and
 * not misjudged against the outer call's model.
 *
 * ============================================================
 * DOES NOT CATCH (explicit — not a summary)
 * ============================================================
 *
 * 1. `select`/`omit`/`where` passed as a variable or built dynamically
 *    (`select: applicantSelect`, `select: buildSelect(...)`) — there is no
 *    object literal to parse without evaluating the variable.
 *
 * 2. A `where` key whose value is an object. That object could be a scalar
 *    filter operator (`{ equals: 'x' }`, `{ contains: 'x' }`), a relation
 *    filter (`{ is: {...} }`, `{ some: {...} }`), or boolean composition
 *    (`NOT: {...}`) — this scanner does NOT try to tell those apart, so it
 *    skips ALL of them. A wrong field name buried in
 *    `where: { phone: { contains: 'x' } }` is NOT caught. This is a real,
 *    intentional gap, not an oversight: telling a scalar-filter-object from
 *    a relation-filter-object generically (across every model) needs the
 *    field's `kind` cross-referenced per key, which is feasible but was not
 *    built in this round — flagging as a further follow-up, not attempted.
 *
 * 3. `AND`/`OR`/`NOT` — skipped UNCONDITIONALLY (not by value shape; these
 *    three names are hardcoded as Prisma's boolean-composition operators,
 *    never real field names on any model). This is deliberately not just
 *    "falls out of #2's array rule": `where: { OR: someArrayVariable }` has
 *    a bare-identifier RHS, not a literal `[`, and a first version of this
 *    scanner (round 1) flagged it as a fake scalar key named `OR` — a real
 *    false positive the backend sweep produced twice. Any other
 *    ARRAY-valued top-level `where` key, and everything nested inside such
 *    an array, is skipped via #2's value-shape rule instead (arrays are
 *    never treated as scalar) — those nested objects are not walked.
 *
 * 4. Nested `where` clauses in general (`where: { applicant: { is: {...} } }`,
 *    `where: { AND: [{ where-shaped object }] }`) — only the TOP level of a
 *    literal call's own `where` object is inspected.
 *
 * 5. Calls where the receiver is not the literal identifier `prisma` or
 *    `tx` (a renamed import, `db.user.findFirst(...)`, a destructured
 *    delegate held in its own variable), or where the model segment is not
 *    a literal identifier (`prisma[modelVar].findFirst(...)`) — the model
 *    can't be resolved without evaluating code.
 *
 * 6. Any call whose arguments are not a literal object immediately after
 *    the opening `(` (`prisma.user.findMany(await buildArgs())`).
 *
 * 7. `include: { relation: true }` with no nested `select`/`omit` — nothing
 *    to check.
 *
 * 8. Any of the three shapes inside files outside `SCAN_DIRS`, or inside
 *    `__tests__`/`test-support`/`tests` directories — a mock's object shape
 *    is not a claim about what Prisma will accept.
 *
 * 9. NOTHING inside a `//` line comment, a `/* … *\/` block comment, or a
 *    string/template literal's contents — `stripCommentsAndStrings` blanks
 *    all of it before any regex runs (round 1: the real sweep hit English
 *    prose like a file:line reference `(prisma/schema/auth.prisma:181)`, a
 *    quoted `"read: true"` inside a doc comment, and a template literal
 *    `` `BATCH:${trimmedBugRef}` `` — none of those are Prisma call sites).
 *    This means a genuinely wrong key written INSIDE a string that is
 *    itself later used as a dynamic Prisma argument is not caught either —
 *    already covered by #1 (dynamic values aren't evaluated).
 *
 * ============================================================
 * AMBIGUOUS NAME HANDLING (applies to checks #1 and #2)
 * ============================================================
 *
 * A relation field's NAME (e.g. `applicant`, `owner`) is not globally
 * unique across models — nothing stops two different models from each
 * declaring a field with the same name pointing at two different targets.
 * Likewise, two models could in principle produce the same client-property
 * name. Rather than hand-list "the names that are safe" (an allowlist that
 * goes stale), this module computes, from the schema itself, which names
 * are AMBIGUOUS (map to more than one target) and SKIPS those, for both the
 * relation-name map (check #1) and the client-property map (check #2/#3).
 * A missed check under an ambiguous name is a false NEGATIVE (safe);
 * guessing the wrong target model would be a false POSITIVE (not safe). How
 * many names are ambiguous is a live fact of the schema, not hardcoded here
 * — run `buildRelationFieldTargets`/`buildModelClientPropertyMap` and count
 * to see the current number; it will drift as the schema grows and this
 * file must not hardcode a snapshot of it.
 *
 * ============================================================
 * FALSE-POSITIVE RISK — read this before trusting a green run blindly
 * ============================================================
 *
 * This is pure text/brace matching, not an AST or a type-checker. It has no
 * notion of "this object literal is really inside a Prisma call" beyond the
 * textual shapes above. A plain, non-Prisma object literal that happens to
 * be shaped exactly like one of the matched patterns — e.g.
 * `const uiConfig = { applicant: { select: { phone: true, label: 'x' } } }`
 * sitting in ordinary UI config code, nothing to do with Prisma — is
 * flagged identically to a real query. Zero such collisions exist in the
 * current backend sweep (verified by running `scanBackendSource` and
 * reading every hit), but that is a fact about today's source tree, not a
 * guarantee of the tool. The "no false positive" language in the ambiguous-
 * name section above is scoped STRICTLY to "not guessing the wrong target
 * model for an ambiguous name" — it is NOT a claim that arbitrary code can
 * never textually resemble one of the three matched shapes.
 */

const fs = require('fs');
const path = require('path');

const BACKEND_ROOT = path.join(__dirname, '..');

/** Directories that hold real backend source touching Prisma. Tests/mocks
 * excluded deliberately (see module doc) — a fixture's shape is not a claim
 * about what Prisma will accept. */
const SCAN_DIRS = [
    'config', 'constants', 'controllers', 'cron', 'jobs', 'middleware',
    'modules', 'routes', 'services', 'shared', 'storage', 'utils',
    'validation', 'prisma',
];

const IGNORE_DIR_NAMES = new Set(['node_modules', '__tests__', 'test-support', 'tests']);

/** Every Prisma Client operation this codebase calls with a `select`/`omit`/
 * `where`-bearing args object — see module doc #2/#3 for the call shape.
 * Grepped from real call sites (`prisma.<model>.<op>(`) across services/
 * routes/controllers/jobs/utils/shared/prisma; extend this list if a new
 * operation shows up, rather than widening the regex to match anything. */
const DIRECT_CALL_OPERATIONS = [
    'findFirst', 'findFirstOrThrow', 'findUnique', 'findUniqueOrThrow', 'findMany',
    'create', 'createMany', 'createManyAndReturn',
    'update', 'updateMany', 'updateManyAndReturn', 'upsert',
    'delete', 'deleteMany', 'aggregate', 'groupBy', 'count',
];

function listJsFiles(root) {
    const out = [];
    (function walk(dir) {
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            if (IGNORE_DIR_NAMES.has(entry.name)) { continue; }
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(full);
            } else if (entry.isFile() && entry.name.endsWith('.js')) {
                out.push(full);
            }
        }
    })(root);
    return out;
}

function listBackendSourceFiles() {
    const files = [];
    for (const dir of SCAN_DIRS) {
        files.push(...listJsFiles(path.join(BACKEND_ROOT, dir)));
    }
    return files;
}

/** name -> Set(targetModelName), built from every relation field in the schema. */
function buildRelationFieldTargets(dmmf) {
    const map = new Map();
    for (const model of dmmf.datamodel.models) {
        for (const field of model.fields) {
            if (field.kind === 'object' && field.relationName) {
                if (!map.has(field.name)) { map.set(field.name, new Set()); }
                map.get(field.name).add(field.type);
            }
        }
    }
    return map;
}

/** modelName -> Set(every field name declared on that model, any kind). */
function buildModelFieldSets(dmmf) {
    const map = new Map();
    for (const model of dmmf.datamodel.models) {
        map.set(model.name, new Set(model.fields.map((f) => f.name)));
    }
    return map;
}

/**
 * clientPropertyName -> PascalCase model name, using Prisma Client's own
 * naming convention (first letter lower-cased). Skips (does not map) any
 * client-property name that more than one model would produce — see module
 * doc "AMBIGUOUS NAME HANDLING". Not observed in the current schema, but the
 * guard against it is generic, not schema-specific.
 */
function buildModelClientPropertyMap(dmmf) {
    const map = new Map();
    const ambiguous = new Set();
    for (const model of dmmf.datamodel.models) {
        const clientProp = model.name.charAt(0).toLowerCase() + model.name.slice(1);
        if (ambiguous.has(clientProp)) { continue; }
        if (map.has(clientProp) && map.get(clientProp) !== model.name) {
            map.delete(clientProp);
            ambiguous.add(clientProp);
            continue;
        }
        map.set(clientProp, model.name);
    }
    return map;
}

function depthAt(str, idx) {
    let depth = 0;
    for (let i = 0; i < idx; i++) {
        if (str[i] === '{') { depth++; } else if (str[i] === '}') { depth--; }
    }
    return depth;
}

function findMatchingClose(str, openIdx) {
    let depth = 1;
    for (let i = openIdx + 1; i < str.length; i++) {
        if (str[i] === '{') { depth++; } else if (str[i] === '}') {
            depth--;
            if (depth === 0) { return i; }
        }
    }
    return -1;
}

function lineOf(str, idx) {
    let line = 1;
    for (let i = 0; i < idx; i++) {
        if (str[i] === '\n') { line++; }
    }
    return line;
}

/**
 * Blanks out `//` line comments, `/* ... *\/` block comments, and the
 * CONTENTS of string/template literals — replacing every character with a
 * space (newlines preserved as `\n`), so the result has the SAME length and
 * SAME line numbers as `source`. Every regex in this file runs against this
 * cleaned copy, not the raw source.
 *
 * Fix round 1 (2026-09-27 review) added this after the real backend sweep
 * produced false positives straight out of prose: a comment reading
 * `(prisma/schema/auth.prisma:181)` was read as a `where` key `prisma`
 * valued `181`; a comment quoting `"read: true"` was read as a real
 * `select` key; a template literal `` `BATCH:${trimmedBugRef}` `` was read
 * as a `where` key `BATCH`. None of those are Prisma call sites — they are
 * English prose and a log-message string that happen to contain a colon.
 *
 * Template literals (`` ` ``) are treated as opaque strings terminated by
 * the next unescaped backtick — a `${...}` interpolation inside one is
 * blanked along with the rest, not evaluated as code. This can, in theory,
 * mis-close a template literal that itself contains a brace-imbalanced
 * expression inside `${}` (extremely rare in this codebase's style); no
 * such case was found in the real sweep this round produced.
 */
function stripCommentsAndStrings(source) {
    let out = '';
    let i = 0;
    const n = source.length;
    while (i < n) {
        const c = source[i];
        const c2 = i + 1 < n ? source[i + 1] : '';
        if (c === '/' && c2 === '/') {
            while (i < n && source[i] !== '\n') { out += ' '; i++; }
            continue;
        }
        if (c === '/' && c2 === '*') {
            out += '  ';
            i += 2;
            while (i < n && !(source[i] === '*' && source[i + 1] === '/')) {
                out += source[i] === '\n' ? '\n' : ' ';
                i++;
            }
            if (i < n) { out += '  '; i += 2; }
            continue;
        }
        if (c === '\'' || c === '"' || c === '`') {
            // Keep the quote CHARACTERS themselves (so the value still visibly
            // starts with a quote — a scalar, not `{`/`[`) and blank only the
            // CONTENTS between them.
            const quote = c;
            out += quote;
            i++;
            while (i < n && source[i] !== quote) {
                if (source[i] === '\\' && i + 1 < n) {
                    out += '  ';
                    i += 2;
                    continue;
                }
                out += source[i] === '\n' ? '\n' : ' ';
                i++;
            }
            if (i < n) { out += quote; i++; }
            continue;
        }
        out += c;
        i++;
    }
    return out;
}

const RELATION_SELECT_RE = /\b([A-Za-z_][A-Za-z0-9_]*)\s*:\s*{\s*select\s*:\s*{/g;
const TRUE_KEY_RE = /([A-Za-z_][A-Za-z0-9_]*)\s*:\s*true\b/g;

/** Prisma's boolean-composition `where` operators — never real field names on
 * any model, so they are skipped unconditionally (not by value shape) in
 * `findTopLevelScalarWhereKeys`. Without this, `OR: someArrayVariable` (RHS a
 * bare identifier, not a literal `[`) reads as a scalar-shaped key named
 * `OR` — a real false positive the round-1 backend sweep produced twice
 * (`routes/api/interoperability/interoperability-resolve.js`). */
const WHERE_LOGICAL_KEYS = new Set(['AND', 'OR', 'NOT']);

/**
 * Scans one file's source text for `<relation>: { select: { <key>: true } }`
 * blocks (module doc, check #1) and reports any top-level key that does not
 * exist on the relation's (unambiguous) target model.
 *
 * @returns {Array<{relationField:string, targetModel:string, key:string, line:number}>}
 */
function scanSourceForInvalidRelationSelects(rawSource, { relationTargets, modelFields }) {
    const source = stripCommentsAndStrings(rawSource);
    const violations = [];
    RELATION_SELECT_RE.lastIndex = 0;
    let match;
    while ((match = RELATION_SELECT_RE.exec(source))) {
        const relationField = match[1];
        const targets = relationTargets.get(relationField);
        if (!targets || targets.size !== 1) {
            // Unknown name, or ambiguous (points at >1 model schema-wide) — skip
            // rather than guess. See module doc.
            continue;
        }
        const [targetModel] = [...targets];
        const validFields = modelFields.get(targetModel);
        if (!validFields) { continue; }

        const openIdx = match.index + match[0].length - 1; // index of select's own '{'
        const closeIdx = findMatchingClose(source, openIdx);
        if (closeIdx === -1) { continue; }
        const block = source.slice(openIdx + 1, closeIdx);

        TRUE_KEY_RE.lastIndex = 0;
        let keyMatch;
        while ((keyMatch = TRUE_KEY_RE.exec(block))) {
            if (depthAt(block, keyMatch.index) !== 0) { continue; } // nested select — its own pass handles it
            const key = keyMatch[1];
            if (!validFields.has(key)) {
                violations.push({
                    relationField,
                    targetModel,
                    key,
                    line: lineOf(source, openIdx + 1 + keyMatch.index),
                });
            }
        }
    }
    return violations;
}

/**
 * Finds every TOP-LEVEL (brace-depth 0 within `content`) `<keyNames>: { ... }`
 * block. Used to locate a direct call's own `select`/`omit`/`where` object
 * among its other top-level args (`data`, `orderBy`, `take`, ...).
 *
 * @returns {Array<{key:string, openIdx:number, block:string}>} `openIdx` is
 *   the index (within `content`) of the block's own opening `{`.
 */
function findTopLevelObjectValues(content, keyNames) {
    const re = new RegExp(`\\b(${keyNames.join('|')})\\s*:\\s*{`, 'g');
    const results = [];
    let m;
    while ((m = re.exec(content))) {
        if (depthAt(content, m.index) !== 0) { continue; }
        const openIdx = m.index + m[0].length - 1;
        const closeIdx = findMatchingClose(content, openIdx);
        if (closeIdx === -1) { continue; }
        results.push({ key: m[1], openIdx, block: content.slice(openIdx + 1, closeIdx) });
    }
    return results;
}

const WHERE_KEY_RE = /([A-Za-z_][A-Za-z0-9_]*)\s*:\s*/g;

/**
 * Top-level keys of a `where` block whose value is a plain scalar (does not
 * open with `{` or `[`) — module doc check #3 / "DOES NOT CATCH" #2-4.
 *
 * @returns {Array<{key:string, index:number}>} `index` within `block`.
 */
function findTopLevelScalarWhereKeys(block) {
    const results = [];
    WHERE_KEY_RE.lastIndex = 0;
    let m;
    while ((m = WHERE_KEY_RE.exec(block))) {
        if (depthAt(block, m.index) !== 0) { continue; }
        if (WHERE_LOGICAL_KEYS.has(m[1])) { continue; } // AND/OR/NOT — never a real field, any RHS shape
        const rest = block.slice(m.index + m[0].length).match(/^\s*(\S)/);
        if (!rest) { continue; }
        if (rest[1] === '{' || rest[1] === '[') { continue; } // operator object / relation filter / array — skip
        results.push({ key: m[1], index: m.index });
    }
    return results;
}

/**
 * Scans one file's source text for LITERAL direct Prisma calls
 * (`prisma.<model>.<op>({ ... })` / `tx.<model>.<op>({ ... })`) and checks
 * their top-level `select`/`omit` keys (module doc check #2) and top-level
 * SCALAR `where` keys (check #3) against the literal `<model>`'s fields.
 *
 * @returns {Array<{clause:'select'|'omit'|'where', model:string, targetModel:string, key:string, line:number}>}
 */
function scanSourceForInvalidDirectCalls(rawSource, { clientPropModel, modelFields }) {
    const source = stripCommentsAndStrings(rawSource);
    const violations = [];
    const callRe = new RegExp(
        `\\b(?:prisma|tx)\\.([A-Za-z_][A-Za-z0-9_]*)\\.(?:${DIRECT_CALL_OPERATIONS.join('|')})\\s*\\(\\s*{`,
        'g',
    );
    let match;
    while ((match = callRe.exec(source))) {
        const clientProp = match[1];
        const targetModel = clientPropModel.get(clientProp);
        if (!targetModel) { continue; } // unknown or ambiguous client-property name — skip, don't guess
        const validFields = modelFields.get(targetModel);
        if (!validFields) { continue; }

        const argsOpenIdx = match.index + match[0].length - 1; // the call's args object's own '{'
        const argsCloseIdx = findMatchingClose(source, argsOpenIdx);
        if (argsCloseIdx === -1) { continue; }
        const argsContent = source.slice(argsOpenIdx + 1, argsCloseIdx);
        const argsContentAbsoluteStart = argsOpenIdx + 1;

        for (const { key: clause, openIdx: blockOpenIdx, block } of findTopLevelObjectValues(argsContent, ['select', 'omit'])) {
            const blockAbsoluteStart = argsContentAbsoluteStart + blockOpenIdx + 1;
            TRUE_KEY_RE.lastIndex = 0;
            let keyMatch;
            while ((keyMatch = TRUE_KEY_RE.exec(block))) {
                if (depthAt(block, keyMatch.index) !== 0) { continue; }
                const key = keyMatch[1];
                if (!validFields.has(key)) {
                    violations.push({
                        clause,
                        model: clientProp,
                        targetModel,
                        key,
                        line: lineOf(source, blockAbsoluteStart + keyMatch.index),
                    });
                }
            }
        }

        for (const { openIdx: blockOpenIdx, block } of findTopLevelObjectValues(argsContent, ['where'])) {
            const blockAbsoluteStart = argsContentAbsoluteStart + blockOpenIdx + 1;
            for (const { key, index } of findTopLevelScalarWhereKeys(block)) {
                if (!validFields.has(key)) {
                    violations.push({
                        clause: 'where',
                        model: clientProp,
                        targetModel,
                        key,
                        line: lineOf(source, blockAbsoluteStart + index),
                    });
                }
            }
        }
    }
    return violations;
}

/**
 * Scans every real backend source file under SCAN_DIRS with both checks
 * (relation-scoped select, and direct-call select/omit/where).
 * @returns {Array<{file:string, clause:string, key:string, targetModel:string, line:number, [relationField]:string, [model]:string}>}
 */
function scanBackendSource({ dmmf, files } = {}) {
    const relationTargets = buildRelationFieldTargets(dmmf);
    const modelFields = buildModelFieldSets(dmmf);
    const clientPropModel = buildModelClientPropertyMap(dmmf);
    const targetFiles = files || listBackendSourceFiles();

    const all = [];
    for (const file of targetFiles) {
        const source = fs.readFileSync(file, 'utf8');
        const relViolations = scanSourceForInvalidRelationSelects(source, { relationTargets, modelFields })
            .map((v) => ({ clause: 'select', ...v }));
        const directViolations = scanSourceForInvalidDirectCalls(source, { clientPropModel, modelFields });
        for (const v of [...relViolations, ...directViolations]) {
            all.push({ file: path.relative(BACKEND_ROOT, file), ...v });
        }
    }
    return all;
}

module.exports = {
    buildRelationFieldTargets,
    buildModelFieldSets,
    buildModelClientPropertyMap,
    stripCommentsAndStrings,
    scanSourceForInvalidRelationSelects,
    scanSourceForInvalidDirectCalls,
    scanBackendSource,
    listBackendSourceFiles,
};
