/**
 * F-G4-10 — the Thai check digit is computed in ONE place, and stays that way.
 *
 * The ledger item was not "somebody forgot the checksum". The rule existed in
 * SEVEN copies and step 4 of the wizard happened to use the one that was only a
 * length test. Consolidating them fixes today; this pin is what fixes tomorrow.
 * It scans production source for the arithmetic itself and fails if it appears
 * anywhere except the shared module.
 *
 * ── What counts as "the arithmetic" ──────────────────────────────────────────
 * The two halves nobody writes by accident: the descending weight applied to a
 * digit (`13 - i`, or an explicit `[13, 12, 11, ...]` table) and the mod-11 fold
 * (`% 11`). A file has to contain both to be flagged, so a stray `% 11` in
 * unrelated code is not a false positive.
 *
 * ── What this pin does NOT cover, and why ────────────────────────────────────
 * Test fixtures, e2e helpers and dev scripts GENERATE valid IDs — they compute a
 * check digit to build a number, they do not judge one. That is the inverse
 * function and a different job, and those files are also where other people's
 * work-in-progress lives. Pulling them in would make this pin a merge-conflict
 * generator rather than a guard. The risk it exists to stop is a second JUDGE in
 * shipped code, and that is exactly what it covers.
 *
 * If this test fails: do not add your file to the allowlist. Import
 * `isThaiIdChecksumValid` from `@gacp/validation/thai-id-checksum` instead.
 * Adding an entry below is a decision about a national standard and belongs to
 * the operator, not to whoever is unblocking a build.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../../../..');

/** The one file allowed to contain the arithmetic. */
const SHARED_MODULE = path.join('packages', 'validation', 'src', 'thai-id-checksum.js');

/**
 * Shipped code: what a farmer's browser downloads and what the server runs.
 * Deliberately excludes tests, e2e specs, scripts and build output (see header).
 */
const SCANNED_ROOTS = [
    path.join('packages', 'validation', 'src'),
    path.join('apps', 'backend', 'routes'),
    path.join('apps', 'backend', 'services'),
    path.join('apps', 'backend', 'shared'),
    path.join('apps', 'backend', 'utils'),
    path.join('apps', 'backend', 'validation'),
    path.join('apps', 'backend', 'middleware'),
    path.join('apps', 'backend', 'controllers'),
    path.join('apps', 'web-app', 'src'),
];

const SCANNED_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']);

const SKIPPED_DIRECTORIES = new Set([
    'node_modules', 'dist', 'build', '.next', 'coverage', '__tests__', '__mocks__', 'tests',
]);

/**
 * A descending positional weight applied to a digit — `13 - i` and its spellings.
 *
 * The named-constant form is listed too (`(THAI_ID_LENGTH - i)`), because a copy
 * that aliases 13 behind a constant is still a copy, and the first draft of this
 * pin missed exactly that: it scanned clean while the shared module itself was
 * written that way.
 */
const WEIGHT_PATTERNS = [
    /\(\s*13\s*-\s*\w+\s*\)/,                            // (13 - i)
    /\(\s*[A-Za-z_$][\w$]*\s*-\s*\w+\s*\)\s*[;,)]?\s*$/m, // (SOME_LENGTH - i) at line end
    /\b13\s*,\s*12\s*,\s*11\s*,\s*10\s*,\s*9\b/,         // [13, 12, 11, 10, 9, ...]
];

/** The mod-11 fold. */
const MOD_11 = /%\s*11\b/;

function walk(dir, out) {
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return out; // a root that does not exist on this checkout is not a failure
    }
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (!SKIPPED_DIRECTORIES.has(entry.name)) {walk(full, out);}
        } else if (entry.isFile()) {
            if (SCANNED_EXTENSIONS.has(path.extname(entry.name))
                && !entry.name.includes('.test.')
                && !entry.name.includes('.spec.')) {
                out.push(full);
            }
        }
    }
    return out;
}

function scannedFiles() {
    const files = [];
    for (const root of SCANNED_ROOTS) {walk(path.join(REPO_ROOT, root), files);}
    return files;
}

function filesContainingTheArithmetic() {
    const hits = [];
    for (const file of scannedFiles()) {
        const source = fs.readFileSync(file, 'utf8');
        if (!MOD_11.test(source)) {continue;}
        if (!WEIGHT_PATTERNS.some((p) => p.test(source))) {continue;}
        hits.push(path.relative(REPO_ROOT, file).split(path.sep).join('/'));
    }
    return hits.sort();
}

describe('Thai check digit — single source of truth', () => {
    it('scans a non-trivial amount of shipped source (the pin is not vacuously green)', () => {
        // Without this, a broken path constant would make every assertion below
        // pass by scanning nothing at all.
        expect(scannedFiles().length).toBeGreaterThan(300);
    });

    it('the shared module is the ONLY shipped file containing the arithmetic', () => {
        const expected = SHARED_MODULE.split(path.sep).join('/');
        expect(filesContainingTheArithmetic()).toEqual([expected]);
    });

    it('the pin actually detects a second copy (it is not a regex that matches nothing)', () => {
        // A guard that cannot fail guards nothing. Prove the detector fires on a
        // realistic duplicate before trusting the assertion above.
        const duplicate = [
            'function isValid(id) {',
            '  let sum = 0;',
            '  for (let i = 0; i < 12; i++) { sum += Number(id[i]) * (13 - i); }',
            '  return ((11 - (sum % 11)) % 10) === Number(id[12]);',
            '}',
        ].join('\n');

        expect(MOD_11.test(duplicate)).toBe(true);
        expect(WEIGHT_PATTERNS.some((p) => p.test(duplicate))).toBe(true);

        // and on the weight-table spelling
        const tableForm = 'const W = [13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2]; const c = sum % 11;';
        expect(MOD_11.test(tableForm)).toBe(true);
        expect(WEIGHT_PATTERNS.some((p) => p.test(tableForm))).toBe(true);

        // and does NOT fire on an unrelated `% 11`
        const unrelated = 'const bucket = hash % 11;';
        expect(WEIGHT_PATTERNS.some((p) => p.test(unrelated))).toBe(false);
    });

    it('every shipped file that judges a Thai ID reaches the shared module', () => {
        // The consolidated callers, named so that deleting the import from any of
        // them is a visible change rather than a silent regression.
        const callers = [
            'apps/backend/utils/thai-id-validator.js',
            'apps/backend/services/applicant-validation.js',
            'apps/backend/shared/zod-schemas.js',
            'apps/backend/validation/canonical-application-validator.js',
            'apps/backend/validation/application-schemas.js',
            'apps/web-app/src/lib/utils.ts',
            'apps/web-app/src/utils/validation.ts',
            'apps/web-app/src/lib/validation/thai-formats.ts',
            'apps/web-app/src/app/health/applications/new/_steps/hooks/use-form-step.ts',
        ];
        for (const caller of callers) {
            const source = fs.readFileSync(path.join(REPO_ROOT, caller), 'utf8');
            expect({ caller, importsSharedModule: source.includes('@gacp/validation/thai-id-checksum') })
                .toEqual({ caller, importsSharedModule: true });
        }
    });
});
