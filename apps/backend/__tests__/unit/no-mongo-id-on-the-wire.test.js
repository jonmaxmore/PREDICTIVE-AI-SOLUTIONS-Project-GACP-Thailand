/**
 * `_id` is MongoDB's primary-key convention. This application stores nothing in
 * MongoDB — the database has no `_id` column anywhere (information_schema: 0) and
 * neither does the Prisma schema. The name lived only on the wire, because five
 * route handlers spelled it that way, and it cost real money:
 *
 *   - `mapHealthApplication` emitted `_id` and NO `id`, so a version of the health
 *     billing page that read `.id` got undefined — permanent spinner, colliding
 *     React keys. The recorded fix was to teach the FRONTEND to read `_id`,
 *     spreading the wrong name instead of removing it.
 *   - A contract test was then written to LOCK it: "does NOT expose a plain `id`
 *     key … a rename would re-break billing". The guard held the defect in place.
 *   - Twenty-one frontend files ended up reading `_id`, several with comments
 *     explaining the trap to the next reader.
 *
 * Operator ordered it removed root and branch, 2026-09-05.
 *
 * This guard is deliberately a SOURCE scan rather than a response assertion: the
 * name could come back in any handler, and a test that only checks the handlers we
 * remembered to list is a test that passes while the sixth one reintroduces it.
 *
 * It counts DECLARATIONS, not mentions — a comment explaining the history (there
 * is one, in billing-app-select.ts) must not make this red, or the lesson gets
 * deleted to keep the gate green. That is the mistake this repo has made five
 * times; see the green-mask classifier fix on 2026-09-05.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOTS = [
    path.join(__dirname, '..', '..', 'routes'),
    path.join(__dirname, '..', '..', 'services'),
    path.join(__dirname, '..', '..', 'shared'),
];

/** `_id:` as an object KEY, or `._id` as a property READ. Not the word in prose. */
const MONGO_ID_DECLARATION = /(^|[^\w$])_id\s*:|\._id\b/;

/** `async (_id, opts) => …` — the conventional unused-parameter underscore. */
const UNUSED_PARAM = /\(\s*_id\s*[,)]/;

function walk(dir, out = []) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name === 'node_modules') { continue; }
        const full = path.join(dir, e.name);
        if (e.isDirectory()) { walk(full, out); } else if (e.name.endsWith('.js')) { out.push(full); }
    }
    return out;
}

function offendersIn(file) {
    return fs.readFileSync(file, 'utf8').split('\n').reduce((acc, line, i) => {
        const code = line.trim();
        if (code.startsWith('//') || code.startsWith('*') || code.startsWith('/*')) { return acc; }
        if (UNUSED_PARAM.test(line)) { return acc; }
        if (MONGO_ID_DECLARATION.test(line)) { acc.push(`${path.relative(process.cwd(), file)}:${i + 1}  ${code.slice(0, 90)}`); }
        return acc;
    }, []);
}

describe('no route, service or shared module puts MongoDB\'s `_id` on the wire', () => {
    const files = ROOTS.filter((r) => fs.existsSync(r)).flatMap((r) => walk(r));

    test('the scan actually reaches the source tree', () => {
        // Without this, deleting the routes directory would make the guard "pass".
        expect(files.length).toBeGreaterThan(50);
    });

    test('no file declares or reads `_id`', () => {
        const offenders = files.flatMap(offendersIn);
        expect(offenders).toEqual([]);
    });

    test('the classifier ignores prose and unused parameters, and catches real ones', () => {
        expect(MONGO_ID_DECLARATION.test('  _id: app.id,')).toBe(true);
        expect(MONGO_ID_DECLARATION.test('const x = row._id;')).toBe(true);
        expect(MONGO_ID_DECLARATION.test(' * it used to emit `_id`, a Mongo name')).toBe(false);
        expect(UNUSED_PARAM.test('jest.fn(async (_id, data) => {')).toBe(true);
        // A real field named e.g. `application_id` must not trip it.
        expect(MONGO_ID_DECLARATION.test('  application_id: app.id,')).toBe(false);
    });
});
