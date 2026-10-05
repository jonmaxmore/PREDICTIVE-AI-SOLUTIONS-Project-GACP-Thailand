'use strict';
/**
 * Class guard for the "select gap" repeat defect: an `Unknown field` Prisma
 * error waiting to happen because a `select`/`omit`/`where` names a field
 * the target model doesn't have. This is a static check against
 * `Prisma.dmmf` (the schema Prisma Client itself validates against) — fast,
 * no database — so it runs in every unit-suite pass, not only when an
 * integration suite happens to touch the buggy query.
 *
 * Proves it catches the actual regression (commit 83157701, fixed
 * 2026-09-27): `applicant: { select: { phone: true } }` on the Invoice /
 * Application → User relation. See
 * apps/backend/__tests__/integration/user-phone-select.test.js for the
 * real-Postgres RED-first proof of the runtime bug; this file proves the
 * STATIC scanner would have caught the same line without ever needing a
 * database.
 *
 * Fix round 1 (2026-09-27 review, `design notes
 * phone-review.md`) widened the scanner past the relation-scoped shape to
 * also cover top-level `select`/`omit`/`where` on literal direct Prisma
 * calls (`prisma.<model>.<op>({...})` / `tx.<model>.<op>({...})`) — see
 * scripts/check-prisma-select-fields.js's module doc for the exact,
 * exhaustive "CATCHES" / "DOES NOT CATCH" list this test file exercises.
 */

const { Prisma } = require('@prisma/client');
const {
    buildRelationFieldTargets,
    buildModelFieldSets,
    buildModelClientPropertyMap,
    stripCommentsAndStrings,
    scanSourceForInvalidRelationSelects,
    scanSourceForInvalidDirectCalls,
    scanBackendSource,
} = require('../../scripts/check-prisma-select-fields');

const dmmf = Prisma.dmmf;
const relationTargets = buildRelationFieldTargets(dmmf);
const modelFields = buildModelFieldSets(dmmf);
const clientPropModel = buildModelClientPropertyMap(dmmf);

describe('stripCommentsAndStrings — the preprocessing step that stopped comment-text false positives', () => {
    test('blanks a `//` line comment but keeps line count (so line numbers stay correct)', () => {
        const src = 'a();\n// prisma/schema/auth.prisma:181 mentions phone: true here\nb();';
        const out = stripCommentsAndStrings(src);
        expect(out.split('\n')).toHaveLength(3);
        expect(out).not.toMatch(/phone/);
        expect(out.split('\n')[1].trim()).toBe('');
    });

    test('blanks a `/* */` block comment across multiple lines', () => {
        const src = 'a();\n/* where: { phone: true }\n   is not real code */\nb();';
        const out = stripCommentsAndStrings(src);
        expect(out).not.toMatch(/phone/);
        expect(out.split('\n')).toHaveLength(4);
    });

    test('blanks string CONTENTS but keeps the quote characters — so a real value still reads as a scalar', () => {
        const out = stripCommentsAndStrings("phone: '0812345678'");
        expect(out).toBe("phone: '          '");
    });

    test('blanks a template literal, including its `${...}` interpolation', () => {
        const out = stripCommentsAndStrings('decisionNote: `BATCH:${trimmedBugRef}`');
        expect(out).not.toMatch(/BATCH/);
        expect(out.startsWith('decisionNote: `')).toBe(true);
        expect(out.endsWith('`')).toBe(true);
    });

    test('same length as the input (so every absolute index / line number still lines up)', () => {
        const src = "// comment\nconst x = 'hi';\n/* block */ done();";
        expect(stripCommentsAndStrings(src).length).toBe(src.length);
    });
});

describe('buildRelationFieldTargets / buildModelFieldSets (schema facts)', () => {
    test('`applicant` names exactly one target model (User) — unambiguous, so it is checked', () => {
        const targets = relationTargets.get('applicant');
        expect(targets).toBeDefined();
        expect([...targets]).toEqual(['User']);
    });

    test('User has `phoneNumber`, not `phone`', () => {
        const userFields = modelFields.get('User');
        expect(userFields.has('phoneNumber')).toBe(true);
        expect(userFields.has('phone')).toBe(false);
    });
});

describe('buildModelClientPropertyMap (schema facts)', () => {
    test('`user` (the client-property name) maps to model `User`', () => {
        expect(clientPropModel.get('user')).toBe('User');
    });

    test('a multi-word model maps via first-letter-lowercase, e.g. `invoiceLineItem` -> `InvoiceLineItem`', () => {
        expect(clientPropModel.get('invoiceLineItem')).toBe('InvoiceLineItem');
    });

    test('skips (does not map) a client-property name two different models would both produce', () => {
        const fakeDmmf = {
            datamodel: {
                models: [
                    { name: 'Owner', fields: [] },
                    { name: 'owner', fields: [] }, // pathological, but proves the guard, not the schema
                ],
            },
        };
        const map = buildModelClientPropertyMap(fakeDmmf);
        expect(map.has('owner')).toBe(false);
    });
});

describe('scanSourceForInvalidRelationSelects — RED: catches the actual regression line', () => {
    const ctx = { relationTargets, modelFields };

    test('flags `applicant: { select: { phone: true } }` (the exact bug, commit 83157701)', () => {
        const source = [
            'const invoice = await prisma.invoice.findFirst({',
            '    where: { id },',
            '    include: {',
            '        applicant: {',
            '            select: {',
            '                id: true, firstName: true, lastName: true, email: true, phone: true,',
            '            },',
            '        },',
            '    },',
            '});',
        ].join('\n');

        const violations = scanSourceForInvalidRelationSelects(source, ctx);

        expect(violations).toHaveLength(1);
        expect(violations[0]).toMatchObject({
            relationField: 'applicant',
            targetModel: 'User',
            key: 'phone',
        });
        expect(violations[0].line).toBe(6); // the `phone: true,` line
    });

    test('flags the same shape under `auditor` (also a User relation)', () => {
        const source = [
            'include: {',
            '    auditor: { select: { firstName: true, phone: true } },',
            '},',
        ].join('\n');

        const violations = scanSourceForInvalidRelationSelects(source, ctx);
        expect(violations).toHaveLength(1);
        expect(violations[0]).toMatchObject({ relationField: 'auditor', targetModel: 'User', key: 'phone' });
    });

    test('does NOT flag the fixed form (`phoneNumber: true`)', () => {
        const source = 'include: { applicant: { select: { phoneNumber: true, email: true } } }';
        expect(scanSourceForInvalidRelationSelects(source, ctx)).toHaveLength(0);
    });

    test('does NOT descend into a nested relation select — that is its own match', () => {
        // `entity` nested inside `application`'s select is a SEPARATE relation
        // (`application` → Application, `entity` → Entity). The nested
        // `type: true` must not be judged against Application's own fields.
        const source = [
            'include: {',
            '    application: {',
            '        select: {',
            '            id: true,',
            '            entity: { select: { id: true, type: true, displayName: true } },',
            '        },',
            '    },',
            '},',
        ].join('\n');

        const violations = scanSourceForInvalidRelationSelects(source, ctx);
        // `application` names >1 target model in this schema in general only if
        // ambiguous; whatever it resolves to, `id`/`entity` are valid there and
        // the nested Entity block (`id`,`type`,`displayName`) is valid on Entity —
        // the assertion that matters is there are ZERO violations, i.e. the
        // nested block was judged against Entity, not misjudged against
        // whatever `application` targets.
        expect(violations).toHaveLength(0);
    });

    test('skips an AMBIGUOUS relation name rather than guessing (no false positive)', () => {
        // Fabricate a name->targets map with two different models for the same
        // field name, the way two unrelated models sharing a field name would
        // look schema-wide. A key invalid on BOTH candidate models must still
        // not be reported, because this scanner refuses to guess which one a
        // given call site means.
        const fakeTargets = new Map([['owner', new Set(['User', 'Organization'])]]);
        const fakeFields = new Map([
            ['User', new Set(['id', 'phoneNumber'])],
            ['Organization', new Set(['id', 'name'])],
        ]);
        const source = 'include: { owner: { select: { totallyNotAField: true } } }';
        const violations = scanSourceForInvalidRelationSelects(source, {
            relationTargets: fakeTargets,
            modelFields: fakeFields,
        });
        expect(violations).toHaveLength(0);
    });
});

describe('scanSourceForInvalidDirectCalls — RED: top-level select/omit/where on a literal direct call', () => {
    const ctx = { clientPropModel, modelFields };

    test('flags a wrong key in a TOP-LEVEL select with no relation wrapper — `prisma.user.findFirst({ select: { phone: true } })`', () => {
        const source = [
            'const row = await prisma.user.findFirst({',
            '    where: { id },',
            '    select: {',
            '        id: true,',
            '        phone: true,',
            '    },',
            '});',
        ].join('\n');

        const violations = scanSourceForInvalidDirectCalls(source, ctx);
        expect(violations).toHaveLength(1);
        expect(violations[0]).toMatchObject({ clause: 'select', model: 'user', targetModel: 'User', key: 'phone' });
        expect(violations[0].line).toBe(5); // the `phone: true,` line
    });

    test('does NOT flag the fixed top-level select (`phoneNumber: true`)', () => {
        const source = 'await prisma.user.findFirst({ select: { phoneNumber: true } });';
        expect(scanSourceForInvalidDirectCalls(source, ctx)).toHaveLength(0);
    });

    test('flags a wrong key in a TOP-LEVEL omit — `prisma.user.findMany({ omit: { phone: true } })`', () => {
        const source = [
            'const rows = await prisma.user.findMany({',
            '    where: { isDeleted: false },',
            '    omit: {',
            '        password: true,',
            '        phone: true,',
            '    },',
            '});',
        ].join('\n');

        const violations = scanSourceForInvalidDirectCalls(source, ctx);
        expect(violations).toHaveLength(1);
        expect(violations[0]).toMatchObject({ clause: 'omit', model: 'user', targetModel: 'User', key: 'phone' });
    });

    test('flags a wrong key in a TOP-LEVEL scalar where — `prisma.user.findFirst({ where: { phone: "x" } })`', () => {
        const source = "await prisma.user.findFirst({ where: { phone: '0812345678' } });";
        const violations = scanSourceForInvalidDirectCalls(source, ctx);
        expect(violations).toHaveLength(1);
        expect(violations[0]).toMatchObject({ clause: 'where', model: 'user', targetModel: 'User', key: 'phone' });
    });

    test('does NOT flag the fixed scalar where (`phoneNumber: "x"`)', () => {
        const source = "await prisma.user.findFirst({ where: { phoneNumber: '0812345678' } });";
        expect(scanSourceForInvalidDirectCalls(source, ctx)).toHaveLength(0);
    });

    test('does NOT flag a legitimate top-level where scalar (`email`, `id`)', () => {
        const source = "await prisma.user.findFirst({ where: { id: '1', email: 'a@b.com' } });";
        expect(scanSourceForInvalidDirectCalls(source, ctx)).toHaveLength(0);
    });

    test('the same literal-call check also matches `tx.<model>.<op>(...)` (the $transaction(async (tx) => ...) convention)', () => {
        const source = 'await tx.user.update({ where: { id }, data: {}, select: { phone: true } });';
        const violations = scanSourceForInvalidDirectCalls(source, ctx);
        expect(violations).toHaveLength(1);
        expect(violations[0]).toMatchObject({ clause: 'select', model: 'user', targetModel: 'User', key: 'phone' });
    });

    test('DOES NOT CATCH #2: a wrong key hidden inside a where OPERATOR object is skipped, not flagged', () => {
        // `where: { phone: { contains: 'x' } }` — the value is an object, not a
        // scalar. Documented gap (module doc "DOES NOT CATCH" #2): this scanner
        // does not distinguish a scalar-filter object from a relation filter,
        // so it skips both rather than guess.
        const source = "await prisma.user.findFirst({ where: { phone: { contains: '08' } } });";
        expect(scanSourceForInvalidDirectCalls(source, ctx)).toHaveLength(0);
    });

    test('DOES NOT CATCH #3-4: an array-valued where key (`OR`/`AND`) and its nested objects are skipped, not flagged', () => {
        const source = "await prisma.user.findFirst({ where: { OR: [{ phone: '08' }, { email: 'a@b.com' }] } });";
        expect(scanSourceForInvalidDirectCalls(source, ctx)).toHaveLength(0);
    });

    test('DOES NOT CATCH #1: select passed as a variable is not evaluated, so it is not flagged even when wrong', () => {
        const source = [
            'const applicantSelect = { phone: true };',
            'await prisma.user.findFirst({ select: applicantSelect });',
        ].join('\n');
        expect(scanSourceForInvalidDirectCalls(source, ctx)).toHaveLength(0);
    });

    test('DOES NOT CATCH #5: a non-literal receiver (`db.user.findFirst`) is not resolved, so it is not flagged', () => {
        const source = "await db.user.findFirst({ select: { phone: true } });";
        expect(scanSourceForInvalidDirectCalls(source, ctx)).toHaveLength(0);
    });

    test('a relation-nested select inside a direct call is still caught by the RELATION check, not double-counted by the direct-call check', () => {
        const source = [
            'await prisma.invoice.findFirst({',
            '    where: { id },',
            '    select: {',
            '        id: true,',
            '        applicant: { select: { phone: true } },',
            '    },',
            '});',
        ].join('\n');

        const direct = scanSourceForInvalidDirectCalls(source, ctx);
        expect(direct).toHaveLength(0); // `applicant` itself is not `true` at the top level of the outer select

        const relational = scanSourceForInvalidRelationSelects(source, { relationTargets, modelFields });
        expect(relational).toHaveLength(1);
        expect(relational[0]).toMatchObject({ relationField: 'applicant', targetModel: 'User', key: 'phone' });
    });
});

/**
 * Fix round 1's widened sweep (module doc CATCHES #2/#3) found real,
 * unambiguous "Unknown field" bugs that this round does NOT fix — see
 * the backlog (2026-09-27) for the full reasoning on each:
 *
 *   - `middleware/role-middleware.js:263` — `canAccessApplication` is dead
 *     (zero route callers) AND the correct fix is not a same-shape rename
 *     (it likely needs `req.user.canonicalId` compared against `healthId`,
 *     not `req.user.id` against a same-named column) — guessing an auth
 *     comparison under a select-gap fix round is worse than leaving it
 *     named here.
 *
 *   - `services/trace-service/queries.js:20,37` — the fix (`isActive: true`
 *     → `status: 'ACTIVE'`) IS mechanical and unambiguous — it was written,
 *     proven, and then REVERTED on operator instruction: the T&T (trace)
 *     area is under a standing freeze, and nothing there may be touched
 *     until the operator confirms the unfreeze, independent of how safe or
 *     dead the specific line is. Two entries (one per call site).
 *
 * This is the same idiom as `error-codes-source-pointers.test.js`'s
 * `KNOWN_PREEXISTING_DRIFT`: a named, exact baseline that fails LOUD (not
 * silently) the moment it goes stale in either direction — a NEW violation
 * appears, or one of these stops matching (fixed, or the line moved)
 * without the baseline being updated to match.
 */
const KNOWN_PREEXISTING_VIOLATIONS = [
    {
        file: 'middleware/role-middleware.js',
        clause: 'select',
        model: 'application',
        targetModel: 'Application',
        key: 'userId',
        line: 263,
        reason: 'dead code (zero route callers); correct fix is an auth-semantics change, not a rename — needs an owner decision',
    },
    {
        file: 'services/trace-service/queries.js',
        clause: 'where',
        model: 'traceQrSecurity',
        targetModel: 'TraceQrSecurity',
        key: 'isActive',
        line: 20,
        reason: "fix is status: 'ACTIVE' (mechanical, proven) — BLOCKED by the standing T&T/trace freeze, not by any doubt about the fix",
    },
    {
        file: 'services/trace-service/queries.js',
        clause: 'where',
        model: 'traceQrSecurity',
        targetModel: 'TraceQrSecurity',
        key: 'isActive',
        line: 37,
        reason: "fix is status: 'ACTIVE' (mechanical, proven) — BLOCKED by the standing T&T/trace freeze, not by any doubt about the fix",
    },
];

function isKnownPreexisting(v) {
    return KNOWN_PREEXISTING_VIOLATIONS.some((k) => (
        k.file === v.file && k.clause === v.clause && k.model === v.model
        && k.targetModel === v.targetModel && k.key === v.key && k.line === v.line
    ));
}

describe('scanBackendSource — GREEN: the real backend source tree today (both checks combined)', () => {
    function formatViolation(v) {
        const scope = v.relationField ? `${v.relationField}.${v.clause}` : `${v.model}.${v.clause}`;
        return `  ${v.file}:${v.line} — ${scope}.${v.key} (${v.targetModel} has no such field)`;
    }

    test('zero User-target violations across the whole backend (relation-select + direct-call select/omit/where)', () => {
        const violations = scanBackendSource({ dmmf }).filter((v) => v.targetModel === 'User');
        if (violations.length > 0) {
            // Fails loud with file:line so a new instance of this class is never
            // a silent number — see the project rules L1.
            throw new Error(`Found ${violations.length} invalid User-target field(s):\n${violations.map(formatViolation).join('\n')}`);
        }
        expect(violations).toHaveLength(0);
    });

    test('zero NEW invalid fields across the backend — only the named, logged baseline entry may remain (general sweep)', () => {
        const violations = scanBackendSource({ dmmf });
        const unexpected = violations.filter((v) => !isKnownPreexisting(v));
        if (unexpected.length > 0) {
            throw new Error(`Found ${unexpected.length} NEW invalid field(s) across the backend:\n${unexpected.map(formatViolation).join('\n')}`);
        }
        expect(unexpected).toHaveLength(0);
    });

    test('the baseline names only violations that still actually exist (no stale/over-claimed entry)', () => {
        const violations = scanBackendSource({ dmmf });
        const stillPresent = KNOWN_PREEXISTING_VIOLATIONS.filter((k) => violations.some((v) => isKnownPreexisting(v) && v.file === k.file && v.line === k.line));
        expect(stillPresent).toHaveLength(KNOWN_PREEXISTING_VIOLATIONS.length);
    });

    test('the sweep finds EXACTLY the known baseline and nothing else — the honest current count', () => {
        const violations = scanBackendSource({ dmmf });
        expect(violations).toHaveLength(KNOWN_PREEXISTING_VIOLATIONS.length);
        expect(violations.every(isKnownPreexisting)).toBe(true);
    });
});
