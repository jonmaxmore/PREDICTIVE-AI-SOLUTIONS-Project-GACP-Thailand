'use strict';

/**
 * Unit test for the green-mask ratchet classifier (scripts/ci/check-green-mask-
 * assertions.js). Pins the rule so the gate can never go vacuous: only a
 * status-code array that mixes a 2xx with a 4xx/5xx is a mask; a pure-success or
 * pure-error array is not.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
    mixesSuccessAndError, scanFile, allTestFiles, SKIP_DIRS,
} = require('../../../../scripts/ci/check-green-mask-assertions');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

describe('green-mask classifier — mixesSuccessAndError', () => {
    it('flags an array mixing a 2xx with a 4xx/5xx (the green-mask)', () => {
        expect(mixesSuccessAndError('[200, 400, 404]')).toBe(true); // green-mask-allow: classifier self-test fixture (a string arg, not an HTTP assertion)
        expect(mixesSuccessAndError('[200, 201, 409]')).toBe(true); // green-mask-allow: fixture
        expect(mixesSuccessAndError('[201, 500]')).toBe(true); // green-mask-allow: fixture
    });

    it('catches hex-encoded status codes too (0xC8=200, 0x190=400)', () => {
        expect(mixesSuccessAndError('[0xC8, 0x190]')).toBe(true); // green-mask-allow: fixture
    });

    it('does NOT flag a pure-error array (legitimate negative assertion)', () => {
        expect(mixesSuccessAndError('[409, 422]')).toBe(false);
        expect(mixesSuccessAndError('[400, 401, 403, 404]')).toBe(false);
    });

    it('does NOT flag a pure-success array', () => {
        expect(mixesSuccessAndError('[200, 201]')).toBe(false);
        expect(mixesSuccessAndError('[200]')).toBe(false);
    });

    it('ignores non-status numbers', () => {
        expect(mixesSuccessAndError('[1, 2, 3]')).toBe(false);
        expect(mixesSuccessAndError('[]')).toBe(false);
    });
});

describe('green-mask scanner — a focused test can never be waived', () => {
    // The focus markers are assembled from fragments so this very file does not
    // trip the gate that scans it (every test file in the repo is scanned).
    const FOCUSED_SRC = [
        `it${'.'}only('focused', () => {}); // green-mask-allow: claiming this one is deliberate`,
        `${'f'}it('focused via the fit alias', () => {});`,
        `${'f'}describe('focused suite', () => {});`,
    ].join('\n');

    let fixture;
    beforeAll(() => {
        fixture = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'green-mask-')), 'focused.spec.js');
        fs.writeFileSync(fixture, FOCUSED_SRC);
    });
    afterAll(() => { fs.rmSync(path.dirname(fixture), { recursive: true, force: true }); });

    it('reports .only even when the line carries a green-mask-allow comment', () => {
        const hits = scanFile(fixture).only;
        expect(hits.map((h) => h.line)).toContain(1);
    });

    it('reports the fit / fdescribe aliases too', () => {
        const hits = scanFile(fixture).only;
        expect(hits.map((h) => h.line)).toEqual([1, 2, 3]);
    });
});

/**
 * Scope pin (QA #808). Until 2026-08-06 the scanner used a four-directory
 * allow-list that covered 558 of 821 test files; 263 files — 32% of the corpus,
 * including apps/backend/__tests__/ itself — were never scanned, and nothing
 * said so. A gate that silently covers a third less than a reader assumes is
 * the phantom guardrail this repo keeps finding. These tests fail if the scope
 * is narrowed again, so the regression cannot land quietly.
 */
describe('green-mask scanner — scope cannot silently narrow', () => {
    const scanned = new Set(allTestFiles().map((f) => path.relative(REPO_ROOT, f).replace(/\\/g, '/')));

    it('covers apps/backend/__tests__ ROOT, not only its integration/ + unit/ subdirs', () => {
        // The file that sat outside the old allow-list while carrying 4 masks.
        expect(scanned.has('apps/backend/__tests__/smoke-all-endpoints.test.js')).toBe(true);
    });

    it('covers co-located component tests under apps/web-app/src', () => {
        const inSrc = [...scanned].filter((f) => f.startsWith('apps/web-app/src/'));
        // ~263 files live outside the old allow-list, most of them here. A single
        // one proves the walk is not directory-gated; the floor below proves scale.
        expect(inSrc.length).toBeGreaterThan(50);
    });

    it('scans the whole corpus, not a subset (floor well above the old 558)', () => {
        // Deliberately a floor, not an equality: tests get added and removed. It
        // sits above the old allow-list total so reverting to it goes red.
        expect(scanned.size).toBeGreaterThan(700);
    });

    it('skips only build/vendor directories', () => {
        expect([...scanned].some((f) => f.includes('node_modules/'))).toBe(false);
        expect(SKIP_DIRS.has('node_modules')).toBe(true);
        expect(SKIP_DIRS.has('coverage')).toBe(true);
    });
});

/**
 * Detection pins moved in from the throwaway QA harness that verified the
 * 2026-08-06 evasions. Evidence that lives only in a session transcript is
 * evidence that disappears; these keep it executable.
 */
/**
 * A THOUSANDS SEPARATOR IS NOT A STATUS CODE.
 *
 * The classifier reads every three-digit run out of an array literal. In a Thai
 * money assertion — ['5,535', '27,675', '33,210'] — those runs are 535, 675 and
 * 210, which look to it like a 5xx mixed with a 2xx, and the gate reported a
 * NET-NEW mask on a test that asserts no status at all
 * (farmer-manual-quotes-the-real-price.test.js, 2026-09-05).
 *
 * This is the same class as the ratchet and QR pins before it: a guard matching a
 * SHAPE rather than a DECLARATION. The cost is worse than noise — the honest fix
 * available to whoever hits it is a `green-mask-allow` comment, which files a
 * false statement ("deliberate tolerant assertion") into the code and buys the
 * next reader nothing. No HTTP status is ever written with a separator, so
 * excluding separated numbers cannot hide a real mask.
 */
describe('green-mask classifier — a comma-formatted amount is money, not a status', () => {
    it('does not read 5,535 / 33,210 as a 5xx mixed with a 2xx', () => {
        expect(mixesSuccessAndError("['5,535', '27,675', '33,210']")).toBe(false);
    });

    it('does not read a single separated amount as a status either', () => {
        expect(mixesSuccessAndError("['1,200', '5,404']")).toBe(false);
    });

    it('still catches a real mask sitting NEXT TO an amount', () => {
        // Removing the separated numbers must not remove the bare ones with them.
        expect(mixesSuccessAndError("[200, 404, '1,000']")).toBe(true); // green-mask-allow: classifier fixture, not an HTTP assertion
    });

    it('still catches [200,404] written with NO space after the comma', () => {
        // The trap in the fix itself: `200,404` matches a thousands-separated
        // number exactly. Only a separator INSIDE a quoted token is money — a
        // comma between two bare array elements is the array's own punctuation.
        expect(mixesSuccessAndError('[200,404]')).toBe(true); // green-mask-allow: classifier fixture
        expect(mixesSuccessAndError('[201,500,404]')).toBe(true); // green-mask-allow: classifier fixture
    });

    it('still catches bare 3-digit numbers that merely look separated', () => {
        // '200' and '404' are not thousands-separated — the comma is the array's own.
        expect(mixesSuccessAndError("['200', '404']")).toBe(true); // green-mask-allow: classifier fixture
    });
});

describe('green-mask classifier — QA #808 evasions stay closed', () => {
    let dir;
    const write = (name, src) => { const p = path.join(dir, name); fs.writeFileSync(p, src); return p; };

    beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'green-mask-qa-')); });
    afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });

    it('catches hex-only status arrays (0xC8 = 200, 0x194 = 404)', () => {
        const f = write('hex.spec.js', 'it("a", () => { expect([0xC8, 0x194]).toContain(s); });'); // green-mask-allow: scanner fixture written to tmp, not an HTTP assertion
        expect(scanFile(f).tolerant.length).toBe(1);
    });

    it('catches a hex success mixed with a decimal error', () => {
        const f = write('mixed-radix.spec.js', 'it("a", () => { expect([0xC8, 404]).toContain(s); });'); // green-mask-allow: scanner fixture
        expect(scanFile(f).tolerant.length).toBe(1);
    });

    it('does not flag a pure-error array (false-positive guard)', () => {
        const f = write('pure-error.spec.js', 'it("a", () => { expect([409, 422]).toContain(s); });');
        expect(scanFile(f).tolerant).toEqual([]);
    });

    it('honours green-mask-allow on a tolerant array, but never on focus', () => {
        const allowed = write('allowed.spec.js', 'it("a", () => { expect([200, 404]).toContain(s); }); // green-mask-allow: signed');
        expect(scanFile(allowed).tolerant).toEqual([]);
        const focused = write('focus.spec.js', `describe${'.'}only("a", () => {}); // green-mask-allow: cannot neutralise focus`);
        expect(scanFile(focused).only.length).toBe(1);
    });

    it('DOES NOT catch the two documented limits — multi-line and var-extract', () => {
        // Asserting the limit keeps the docstring honest: if a future change
        // starts catching these, the docstring must stop calling them limits.
        const multi = write('multiline.spec.js', 'it("a", () => { expect([\n  200,\n  404,\n]).toContain(s); });'); // green-mask-allow: scanner fixture
        expect(scanFile(multi).tolerant).toEqual([]);
        const extracted = write('extract.spec.js', 'const codes = [200, 404];\nit("a", () => { expect(codes).toContain(s); });'); // green-mask-allow: scanner fixture
        expect(scanFile(extracted).tolerant).toEqual([]);
    });
});
