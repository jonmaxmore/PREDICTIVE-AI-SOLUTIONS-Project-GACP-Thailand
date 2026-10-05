'use strict';

/**
 * OAuth client_id hardcode guard (no DB, pure filesystem scan).
 *
 * Law 3.3 (NO SECRET in code) + Law 3.5 (NO HARDCODE of business IDs). Every
 * OAuth client_id/secret must come from process.env via
 * config/auth-providers.js#getProviderConfig — the adapters never hold a literal
 * id (thaid-adapter.js / provider-id-adapter.js read cfg.clientId only).
 *
 * The concrete threat this pins: the ThaID/BORA *Sandbox* shared client_id is a
 * UUIDv7 the manual prints publicly (T-SBX p.19, prefix 019c324c) and explicitly
 * says NOT to copy into the repo — it must live in .env locally only
 * (evidence/AUTH-01/manual-citations.md:158). This test fails if that public
 * test credential — or any UUID / long-hex / base64 client_id — is hardcoded, as
 * a quoted or backtick STRING LITERAL, to a client_id/clientId key in any backend
 * source .js (whole tree, excluding node_modules + __tests__).
 *
 * BEST-EFFORT grep-pin — KNOWN LIMITS (documented, not claimed closed; QA #806):
 *   - a client_id assembled by string concatenation ('019c' + '324c…') or a
 *     template placeholder is NOT caught — a line-based literal scan cannot see
 *     a value split across expressions. The real defence is the mandate + review;
 *     this catches the accidental paste, not a determined evasion.
 *   - only .js is scanned (TS/JSON config excluded).
 *
 * PASSES today: since the mock IdP was removed (operator 2026-08-14) there is NO
 * hardcoded client_id literal left in scanned source at all. The single thing
 * the key+literal scan still reports on the real tree is
 * config/auth-providers.js:171 — `clientId: process.env[\`${prefix}CLIENT_ID\`]`
 * — whose captured literal is an env KEY NAME, not a credential (the classifier
 * correctly calls it non-suspicious). It is NOT a specimen, and the audit of
 * 2026-08-14 flagged exactly that: a floor that counts it as one is a guard
 * going vacuous while looking green.
 *
 * The scanner is therefore pinned by a sanity floor (last describe) that PLANTS
 * a credential-shaped client_id in a throwaway tree on disk and requires the
 * same collectSourceFiles + key regex + literal regex + classifier pipeline to
 * walk it, find it and flag it. A regex that silently stops matching breaks
 * LOUDLY instead of passing vacuously — and that floor no longer depends on any
 * specimen surviving inside production source.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const BACKEND_ROOT = path.resolve(__dirname, '..', '..');

// Dirs that hold real backend logic. node_modules, __tests__ and *.test.js
// legitimately contain id-shaped literals (fixtures/placeholders) and are excluded.
// Scan the WHOLE backend source tree, not a fixed dir allow-list — a hardcoded
// id in a root file (server.js) or in validation/ / scripts/ / data/ must not be
// invisible (QA #806). collectSourceFiles already skips node_modules + __tests__
// + *.test/spec.js.

// The ThaID Sandbox shared client_id (UUIDv7) prints with this timestamp prefix
// in T-SBX p.19. Distinctive enough that any appearance in source means a public
// test credential got committed — which the manual forbids.
const DTAM_SHARED_ID_PREFIX = '019c324c';

/** Recursively collect *.js source files (skip node_modules, __tests__, *.test/spec.js). */
function collectSourceFiles(dir) {
    /** @type {string[]} */
    const out = [];
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return out;
    }
    for (const e of entries) {
        if (e.name === 'node_modules' || e.name === '__tests__') { continue; }
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
            out.push(...collectSourceFiles(full));
        } else if (
            e.isFile()
            && e.name.endsWith('.js')
            && !e.name.endsWith('.test.js')
            && !e.name.endsWith('.spec.js')
        ) {
            out.push(full);
        }
    }
    return out;
}

function allSourceFiles() {
    return collectSourceFiles(BACKEND_ROOT);
}

/**
 * Does this string literal LOOK like a real OAuth client_id / secret (as opposed
 * to a readable hyphenated seam value like 'gacp-readable-seam-client')?
 *   - starts with the DTAM/ThaID sandbox shared-id prefix, OR
 *   - a UUID (any version — UUIDv7 019c324c-...-7...-...-..., UUIDv4, etc.), OR
 *   - a long contiguous hex run (>=16), OR
 *   - a base64 / base64url token (>=24, letters+digits, NO hyphen so the
 *     hyphenated readable mock value is never mistaken for a credential).
 */
function isSuspiciousClientId(value) {
    if (!value) { return false; }
    const v = String(value).trim();
    if (v.startsWith(DTAM_SHARED_ID_PREFIX)) { return true; }
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) { return true; }
    if (/^[0-9a-f]{16,}$/i.test(v)) { return true; }
    if (v.length >= 24 && /^[A-Za-z0-9_+/]+={0,2}$/.test(v) && /[A-Za-z]/.test(v) && /[0-9]/.test(v)) {
        return true;
    }
    return false;
}

// Matches a `client_id` / `clientId` key used as an assignment target (object
// literal `key:` or `key =`, key optionally quoted). Case-insensitive; the
// `_?` + /i covers both `client_id` and `clientId`.
const CLIENT_ID_KEY_RE = /["']?\bclient_?id\b["']?\s*[:=]\s*/gi;
// Extracts single/double-quoted AND backtick string literals from a value expr.
const STRING_LITERAL_RE = /(["'`])([^"'`\r\n]*)\1/g;

/**
 * Every string literal assigned to a client_id/clientId key, with its file.
 * Inspects the value expression up to end-of-line, so it catches BOTH
 * `client_id: 'X'` and the env-fallback form `client_id: process.env.Y || 'X'`.
 * A bare `process.env.*` value has no string literal → never reported.
 *
 * `files` defaults to the real backend tree. The parameter exists so the sanity
 * floor can run this exact function over a PLANTED tree — same code path, same
 * regexes — instead of asserting that some specimen still happens to live in
 * production source (audit 2026-08-14).
 */
function scanClientIdAssignments(files = allSourceFiles()) {
    const hits = [];
    for (const file of files) {
        let text;
        try {
            text = fs.readFileSync(file, 'utf8');
        } catch {
            continue;
        }
        let m;
        CLIENT_ID_KEY_RE.lastIndex = 0;
        while ((m = CLIENT_ID_KEY_RE.exec(text)) !== null) {
            const start = m.index + m[0].length;
            const eol = text.indexOf('\n', start);
            const valueExpr = text.slice(start, eol === -1 ? undefined : eol);
            for (const lit of valueExpr.matchAll(STRING_LITERAL_RE)) {
                hits.push({ file: path.relative(BACKEND_ROOT, file), value: lit[2] });
            }
        }
    }
    return hits;
}

/** Files that contain the DTAM/ThaID sandbox shared-id prefix anywhere (defense in depth). */
function scanDtamPrefix() {
    const hits = [];
    for (const file of allSourceFiles()) {
        let text;
        try {
            text = fs.readFileSync(file, 'utf8');
        } catch {
            continue;
        }
        if (text.includes(DTAM_SHARED_ID_PREFIX)) {
            hits.push(path.relative(BACKEND_ROOT, file));
        }
    }
    return hits;
}

describe('OAuth client_id must come from env, never hardcoded (Law 3.3 + 3.5)', () => {
    test('no backend source assigns a UUID/long-hex/base64 client_id literal', () => {
        const suspicious = scanClientIdAssignments()
            .filter((h) => isSuspiciousClientId(h.value))
            .map((h) => `${h.file}: client_id = "${h.value}"`);
        // Any hit here = a real credential-shaped id was hardcoded. Move it to
        // an AUTH_*_CLIENT_ID env var read through getProviderConfig instead.
        expect(suspicious).toEqual([]);
    });

    test('the ThaID sandbox shared client_id prefix (019c324c) never appears in source', () => {
        // T-SBX p.19 public test credential — must live in .env only, never committed
        // (evidence/AUTH-01/manual-citations.md:158). Whole-file scan catches it even
        // inside an env-fallback or a manually built query string.
        expect(scanDtamPrefix()).toEqual([]);
    });
});

/**
 * Write a throwaway source tree OUTSIDE the repo, hand it to the real walker,
 * delete it again. Nothing is ever planted inside apps/backend: another suite
 * scanning the tree in a parallel jest worker must never see a planted
 * credential, and a crashed run must not leave one behind.
 */
function withPlantedTree(files, fn) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clientid-guard-'));
    try {
        for (const [rel, source] of Object.entries(files)) {
            const full = path.join(root, rel);
            fs.mkdirSync(path.dirname(full), { recursive: true });
            fs.writeFileSync(full, source, 'utf8');
        }
        return fn(root);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}

describe('sanity floor — the scanner and classifier are not silently broken', () => {
    test('planted specimen: walker + regexes + classifier catch a hardcoded client_id on disk', () => {
        // The floor that used to sit here asserted a specimen still existed in
        // production source ('gacp-mock-idp-client'). That specimen was deleted
        // with the mock IdP, and the only remaining real-tree hit is an env KEY
        // NAME — i.e. the guard would have kept reporting PASS with zero true
        // specimens (audit 2026-08-14, MAJOR). The specimen is now planted here,
        // so the pipeline is proven on a credential, every run, forever.
        const hits = withPlantedTree({
            'services/planted-adapter.js':
                "module.exports = { client_id: '019c324c-9b2a-7c31-8f4e-0a1b2c3d4e5f' };\n",
            'services/env-read.js':
                'module.exports = { clientId: process.env.AUTH_THAID_CLIENT_ID };\n',
            'services/planted-adapter.test.js':
                "const fixture = { client_id: '550e8400-e29b-41d4-a716-446655440000' };\n",
            'node_modules/dep/index.js':
                "module.exports = { client_id: '550e8400-e29b-41d4-a716-446655440000' };\n",
        }, (root) => scanClientIdAssignments(collectSourceFiles(root)));

        // exactly one hit: the planted source file. The pure process.env read has
        // no literal; the *.test.js file and node_modules are not walked.
        expect(hits.map((h) => h.value)).toEqual(['019c324c-9b2a-7c31-8f4e-0a1b2c3d4e5f']);
        expect(hits.every((h) => isSuspiciousClientId(h.value))).toBe(true);
    });

    test('the key+literal scan still matches real backend source (and finds no credential there)', () => {
        const literals = scanClientIdAssignments();
        // config/auth-providers.js:171 is `clientId: process.env[`${prefix}CLIENT_ID`]`.
        // Its captured literal is the env KEY NAME — proof the two regexes still
        // match real code, NOT a credential specimen. Never treat it as one.
        const files = literals.map((h) => h.file.replace(/\\/g, '/'));
        expect(files).toContain('config/auth-providers.js');
        // and nothing anywhere in the real tree is credential-shaped
        expect(literals.filter((h) => isSuspiciousClientId(h.value))).toEqual([]);
    });

    test('classifier flags credential-shaped ids and passes a readable seam value', () => {
        expect(isSuspiciousClientId('019c324c-9b2a-7c31-8f4e-0a1b2c3d4e5f')).toBe(true); // DTAM UUIDv7
        expect(isSuspiciousClientId('550e8400-e29b-41d4-a716-446655440000')).toBe(true); // UUIDv4
        expect(isSuspiciousClientId('a1b2c3d4e5f60718')).toBe(true);                       // 16 hex
        expect(isSuspiciousClientId('gacp-readable-seam-client')).toBe(false);             // readable seam
        expect(isSuspiciousClientId('')).toBe(false);
    });

    test('end-to-end: a synthetic hardcoded client_id is detected', () => {
        const synthetic = "const c = { client_id: '019c324c-9b2a-7c31-8f4e-0a1b2c3d4e5f' };";
        CLIENT_ID_KEY_RE.lastIndex = 0;
        const m = CLIENT_ID_KEY_RE.exec(synthetic);
        expect(m).not.toBeNull();
        const valueExpr = synthetic.slice(m.index + m[0].length);
        const lit = [...valueExpr.matchAll(STRING_LITERAL_RE)][0];
        expect(lit).toBeDefined();
        expect(isSuspiciousClientId(lit[2])).toBe(true);
    });
});

/**
 * QA #806 pins. The two evasions raised in review were closed in the guard, but
 * nothing here pinned either fix: the sanity floor above only exercises a
 * SINGLE-QUOTED literal, and nothing asserted which directories get walked. So
 * dropping the backtick from STRING_LITERAL_RE, or going back to a fixed
 * directory allow-list, would have left every test green.
 *
 * A closed hole with no test is a hole waiting to reopen quietly — the same
 * shape as the phantom guardrails this repo spent 2026-08-06 removing.
 */
describe('QA #806 — the closed evasions stay closed', () => {
    /** Run the real key+literal extraction over one line of synthetic source. */
    const literalsFor = (src) => {
        CLIENT_ID_KEY_RE.lastIndex = 0;
        const m = CLIENT_ID_KEY_RE.exec(src);
        if (!m) { return []; }
        return [...src.slice(m.index + m[0].length).matchAll(STRING_LITERAL_RE)].map((l) => l[2]);
    };

    test('a BACKTICK-quoted client_id is extracted and flagged, not just single quotes', () => {
        // eslint-disable-next-line no-template-curly-in-string
        const backticked = 'const c = { client_id: `019c324c-9b2a-7c31-8f4e-0a1b2c3d4e5f` };';
        const values = literalsFor(backticked);
        expect(values).toContain('019c324c-9b2a-7c31-8f4e-0a1b2c3d4e5f');
        expect(values.some(isSuspiciousClientId)).toBe(true);
    });

    test('a double-quoted client_id is extracted too (all three quote styles)', () => {
        const values = literalsFor('const c = { clientId: "550e8400-e29b-41d4-a716-446655440000" };');
        expect(values.some(isSuspiciousClientId)).toBe(true);
    });

    test('a long contiguous hex id is credential-shaped, a readable value is not', () => {
        expect(isSuspiciousClientId('a1b2c3d4e5f60718c9')).toBe(true);        // 18 hex
        expect(isSuspiciousClientId('gacp-readable-seam-client')).toBe(false); // readable seam
    });

    test('the scan walks the WHOLE backend tree, not a directory allow-list', () => {
        const rel = allSourceFiles().map((f) => path.relative(BACKEND_ROOT, f).replace(/\\/g, '/'));
        const topLevel = new Set(rel.map((f) => (f.includes('/') ? f.slice(0, f.indexOf('/')) : '<root>')));

        // Directories a services/config/routes allow-list would have missed. A
        // hardcoded id in any of them was invisible before the QA fix.
        for (const dir of ['scripts', 'middleware', 'utils', 'data', 'validation']) {
            expect(topLevel.has(dir)).toBe(true);
        }
        // Files sitting at the backend root, with no directory to allow-list at all.
        expect(topLevel.has('<root>')).toBe(true);
    });

    test('the scan still excludes node_modules and test files', () => {
        const rel = allSourceFiles().map((f) => path.relative(BACKEND_ROOT, f).replace(/\\/g, '/'));
        expect(rel.some((f) => f.includes('node_modules/'))).toBe(false);
        expect(rel.some((f) => f.includes('__tests__/'))).toBe(false);
        expect(rel.some((f) => f.endsWith('.test.js') || f.endsWith('.spec.js'))).toBe(false);
    });
});