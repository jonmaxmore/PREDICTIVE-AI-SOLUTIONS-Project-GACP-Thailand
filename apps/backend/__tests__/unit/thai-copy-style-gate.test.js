/**
 * The Thai copy rules, made enforceable.
 *
 * the thai-ui-copy guideline states two typographic rules as hard rules:
 * Thai separates clauses with a space rather than an em dash, and ไม้ยมก takes
 * a space before it. Both were being broken in shipped strings, and the only
 * thing enforcing either was somebody remembering.
 *
 * The reason this needs a real gate rather than a grep is that the naive greps
 * are wrong in both directions, and provably so on this repository:
 *
 *   - `grep -l '[ก-๙].*—'` over `apps/web-app/src` reports 101 files. Most are
 *     English code comments that merely sit near Thai text. An em dash in a
 *     comment is not user-facing copy and must not be flagged.
 *   - `grep -lE "'[^']*[ก-๙][^']*—[^']*'"` reports 80 files, because an
 *     apostrophe in an English comment ("don't", "the operator's") opens what
 *     the regex believes is a string literal.
 *
 * A gate that cries wolf 80 times gets switched off, and a bulk rewrite driven
 * by one of those greps would edit comments and logic. So the detector strips
 * comments first, then looks only inside string literals, then only at literals
 * that actually contain Thai.
 *
 * These tests pin that behaviour, including the false positives above, because
 * those are the cases that decide whether the gate is usable.
 */

const gate = require('../../../../scripts/ci/check-thai-copy-style');

/** Violations found in one snippet, by rule id. */
const rulesFor = (source, file = 'sample.tsx') =>
    gate.findViolations(source, file).map((violation) => violation.rule);

describe('findViolations', () => {
    describe('em dash in Thai copy', () => {
        it('flags a Thai string that separates clauses with an em dash', () => {
            expect(rulesFor('const a = "ข้อมูลไม่ครบ — กรุณาแก้ไข";')).toEqual(['em-dash']);
        });

        it('flags it in a single-quoted string too', () => {
            expect(rulesFor("const a = 'ข้อมูลไม่ครบ — กรุณาแก้ไข';")).toEqual(['em-dash']);
        });

        it('flags it in a template literal', () => {
            expect(rulesFor('const a = `ข้อมูลไม่ครบ — กรุณาแก้ไข`;')).toEqual(['em-dash']);
        });

        it('leaves an English string alone', () => {
            // The rule is about Thai typography. English prose may use dashes.
            expect(rulesFor('const a = "Loading failed — please retry";')).toEqual([]);
        });
    });

    describe('what it must not flag', () => {
        it('ignores an em dash in a line comment', () => {
            // This is the 101-file false positive.
            expect(rulesFor('// the wizard step — ข้อมูลฟาร์ม — is optional\nconst a = 1;')).toEqual([]);
        });

        it('ignores an em dash in a block comment', () => {
            expect(rulesFor('/*\n * ค่าธรรมเนียม — the fee\n */\nconst a = 1;')).toEqual([]);
        });

        it('is not fooled by an apostrophe in an English comment', () => {
            // This is the 80-file false positive: the apostrophe in "don't"
            // opens a string literal as far as a naive regex is concerned, and
            // everything up to the next apostrophe looks quoted.
            const source = [
                "// don't let the operator's dash — this one — be treated as copy",
                'const label = "ยินดีต้อนรับ";',
            ].join('\n');
            expect(rulesFor(source)).toEqual([]);
        });

        it('ignores a dash in a Thai comment, which is not user-facing', () => {
            expect(rulesFor('// หมายเหตุ — ใช้ภายใน\nconst a = 1;')).toEqual([]);
        });
    });

    describe('ไม้ยมก spacing', () => {
        it('flags ๆ with no space before it', () => {
            expect(rulesFor('const a = "อื่นๆ";')).toEqual(['maiyamok']);
        });

        it('accepts ๆ with a space before it', () => {
            expect(rulesFor('const a = "อื่น ๆ";')).toEqual([]);
        });

        it('flags each offending literal once per rule', () => {
            expect(rulesFor('const a = "บ่อยๆ และ เร็วๆ";')).toEqual(['maiyamok']);
        });

        it('ignores ๆ inside a comment', () => {
            expect(rulesFor('// ต่างๆ นานา\nconst a = 1;')).toEqual([]);
        });
    });

    describe('both rules at once', () => {
        it('reports each rule the literal breaks', () => {
            expect(rulesFor('const a = "อื่นๆ — กรุณาเลือก";').sort()).toEqual(['em-dash', 'maiyamok']);
        });
    });

    describe('Dart', () => {
        it('applies the same rules to .dart strings', () => {
            expect(rulesFor("const a = 'ชำระแล้ว — รอตรวจสอบ';", 'x.dart')).toEqual(['em-dash']);
        });

        it('ignores Dart comments', () => {
            expect(rulesFor("// ชำระแล้ว — รอตรวจสอบ\nconst a = 1;", 'x.dart')).toEqual([]);
        });
    });

    describe('what it reports', () => {
        it('gives the line number and the offending text', () => {
            const [violation] = gate.findViolations('const a = 1;\nconst b = "ไม่ครบ — แก้ไข";', 'f.tsx');
            expect(violation.line).toBe(2);
            expect(violation.text).toContain('ไม่ครบ');
        });
    });
});

describe('real TSX, where a hand-rolled scanner desynchronises', () => {
    /**
     * Reduced from apps/web-app/src/app/provider/scheduler/queue/client-view.tsx.
     *
     * The first version of this gate scanned quotes by hand and reported a
     * violation whose "text" was `: '—',` — a fragment of source, not a string.
     * It had paired a backtick with an unrelated one further down the file and
     * swallowed the JSX between them, so the body picked up Thai from one place
     * and a dash from another. Neither belonged to a single literal.
     *
     * A gate that invents violations is worse than no gate: every real finding
     * it reports is now suspect. TS/TSX is scanned with the TypeScript compiler
     * for this reason.
     */
    const REAL_SHAPE = [
        // The trigger: a REGEX LITERAL containing a quote character. A scanner
        // that does not know regex literals sees this `"` as the start of a
        // string and every quote after it is paired one out of step.
        'const esc = (s) => /[",\\n\\r]/.test(s) ? `"${s.replace(/"/g, \'""\')}"` : s;',
        "const rows = [",
        "    { label: 'คิวรอจัดตาราง', value: summary ? String(summary.totalPending) : '—' },",
        "    {",
        "        label: 'รอเก่าสุด',",
        "        value: summary",
        "            ? `${summary.oldestPendingDays} วัน`",
        "            : '—',",
        "    },",
        "];",
    ].join('\n');

    it('finds no violation in it, because there is none', () => {
        expect(gate.findViolations(REAL_SHAPE, 'client-view.tsx')).toEqual([]);
    });

    it('never reports source code as the offending copy', () => {
        for (const violation of gate.findViolations(REAL_SHAPE, 'client-view.tsx')) {
            expect(violation.text).not.toMatch(/[;{}]|=>/);
        }
    });

    it('still sees a genuine violation in the same file shape', () => {
        const withDefect = REAL_SHAPE.replace("'คิวรอจัดตาราง'", "'คิวรอจัดตาราง — ทั้งหมด'");
        expect(gate.findViolations(withDefect, 'client-view.tsx').map((v) => v.rule)).toEqual(['em-dash']);
    });
});

describe('Dart string forms', () => {
    it('does not desynchronise on a triple-quoted string', () => {
        const source = [
            "const a = '''",
            "หลายบรรทัด",
            "''';",
            "const b = 'ปกติ';",
        ].join('\n');
        expect(gate.findViolations(source, 'x.dart')).toEqual([]);
    });

    it('flags a dash inside a triple-quoted Thai string', () => {
        const source = "const a = '''ไม่ครบ — แก้ไข''';";
        expect(gate.findViolations(source, 'x.dart').map((v) => v.rule)).toEqual(['em-dash']);
    });

    it('handles a raw string', () => {
        expect(gate.findViolations(String.raw`const a = r'ทางเดิน\n ปกติ';`, 'x.dart')).toEqual([]);
    });

    it('flags a dash in a raw Thai string', () => {
        expect(gate.findViolations("const a = r'ไม่ครบ — แก้ไข';", 'x.dart').map((v) => v.rule))
            .toEqual(['em-dash']);
    });

    it('sees Thai written as \\u escapes', () => {
        // Found by attacking the gate rather than by reading it. TS/TSX was
        // already safe because the compiler hands back the cooked text, but the
        // Dart scanner kept escapes raw, so a literal with no literal Thai
        // character in it was skipped as "not Thai copy" and its em dash rode
        // through. No file in apps/mobile-app does this today — which is
        // exactly why it would have gone unnoticed until one did.
        const escaped = "const a = '\\u0E44\\u0E21\\u0E48 — \\u0E01';";
        expect(/[฀-๿]/.test(escaped)).toBe(false);
        expect(gate.findViolations(escaped, 'x.dart').map((v) => v.rule)).toEqual(['em-dash']);
    });

    it('leaves a raw string\'s escapes alone, because Dart does', () => {
        // In r'...' a backslash is a backslash, so ไ is six characters and
        // not Thai. Decoding it here would invent a violation.
        expect(gate.findViolations("const a = r'\\u0E44 — x';", 'x.dart')).toEqual([]);
    });
});


describe('the ground the gate covers', () => {
    it('scans the web app, the Flutter app, and the backend', () => {
        // The backend was the hole. It emits Thai the applicant reads —
        // notification bodies, workflow rejection reasons, error messages
        // mapped to Thai — and the first version of this gate did not look at
        // it, while the commit message said the rules were enforced. A gate
        // that is quoted as evidence has to cover the ground it claims.
        expect(gate.SCAN_ROOTS).toEqual(expect.arrayContaining([
            'apps/web-app/src',
            'apps/mobile-app/lib',
            'apps/backend',
        ]));
    });

    it('recognises the extensions user-facing copy lives in', () => {
        // .js because the backend is JavaScript.
        for (const extension of ['.ts', '.tsx', '.dart', '.js']) {
            expect(gate.SCAN_EXTENSIONS).toContain(extension);
        }
    });

    it('skips vendored and generated trees', () => {
        // node_modules and Prisma's generated client would swamp the report
        // with code nobody here writes.
        for (const dir of ['node_modules', 'build', '.next', 'coverage']) {
            expect(gate.SKIP_DIRS).toContain(dir);
        }
    });

    it('skips test files, whose strings are assertions rather than copy', () => {
        // A test that asserts on old wording is evidence, not a defect. Editing
        // one to satisfy a style gate is how a green gate stops meaning
        // anything.
        for (const file of ['a.test.tsx', 'b.spec.ts', 'x/__tests__/c.tsx', 'y_test.dart']) {
            expect(gate.isSkipped(file)).toBe(true);
        }
    });

    it('does not skip ordinary source files', () => {
        for (const file of ['apps/web-app/src/app/page.tsx', 'apps/mobile-app/lib/main.dart']) {
            expect(gate.isSkipped(file)).toBe(false);
        }
    });
});
