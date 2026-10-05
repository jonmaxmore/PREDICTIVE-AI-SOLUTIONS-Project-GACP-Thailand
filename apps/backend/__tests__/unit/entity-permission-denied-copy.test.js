'use strict';

/**
 * R2 Task 10 fix round 1 (review I1): the "workspace" concept is gone, so its copy goes too.
 *
 * Every 403 ENTITY_PERMISSION_DENIED door used to carry its own Thai literal, most of them
 * saying "...ในพื้นที่ทำงาน". The copy now has ONE source, the catalogue entry, and every door
 * reads it. Coordinator ruling 2026-10-03 on the wording (thai-ui-copy: คุณ register, cause
 * plus next action, no em dash, no emoji).
 */

const fs = require('fs');
const path = require('path');

const RULED_TH = 'คุณไม่มีสิทธิ์ทำรายการนี้ในนามของผู้ถือรายนี้ ขอให้เจ้าของมอบสิทธิ์ให้คุณก่อน แล้วลองอีกครั้ง';
const BACKEND = path.join(__dirname, '..', '..');
const RETIRED = /พื้นที่ทำงาน|เวิร์กสเปซ/;

/** The 403 doors that answered ENTITY_PERMISSION_DENIED with their own literal. */
const DENIAL_SITES = [
    'routes/api/cultivation/farms.js',
    'routes/api/cultivation/plots.js',
    'routes/api/cultivation/seed-sources.js',
    'routes/api/cultivation/controlled-environments.js',
    'routes/api/cultivation/fertilizer-records.js',
    'routes/api/cultivation/water-sources.js',
    'routes/api/cultivation/harvest-batches.js',
    'routes/api/cultivation/planting-cycles.js',
    'services/planting-cycle-service.js',
    'middleware/farm-ownership.js',
    'controllers/cultivation-log-controller.js',
];

function walk(dir, out = []) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { walk(p, out); } else if (e.name.endsWith('.js')) { out.push(p); }
    }
    return out;
}

/**
 * Every place in `src` that answers ENTITY_PERMISSION_DENIED with its own text instead of
 * the catalogue copy (shared/entity-permission-denied.js). The code may be written as the
 * literal, as ENTITY_PERMISSION_DENIED_CODE, or through a local const bound to the literal.
 * @param {string} src
 * @returns {string[]} "<line> <why>" per hit
 */
function ownDenialMessages(src) {
    const LIT = String.raw`['"\`]ENTITY_PERMISSION_DENIED['"\`]`;
    const STR = String.raw`['"\`]`;
    const consts = [...src.matchAll(new RegExp(String.raw`\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*` + LIT, 'g'))]
        .map((m) => m[1]);
    const codeRef = `(?:${[LIT, 'ENTITY_PERMISSION_DENIED_CODE', ...consts.map((c) => `\\b${c}\\b`)].join('|')})`;
    const rules = [
        // { code: 'ENTITY_PERMISSION_DENIED', ... } / { error: 'ENTITY_PERMISSION_DENIED', ... }
        [new RegExp(String.raw`\b(code|error)\s*:\s*` + LIT), 'hand-built body'],
        // { code: <constant>, ..., error|message|messageTh: '<text>' } within one object literal
        [new RegExp(String.raw`\bcode\s*:\s*` + codeRef + String.raw`[^{}]*?\b(?:error|message|messageTh)\s*:\s*` + STR), 'body with a literal message'],
        [new RegExp(String.raw`\b(?:error|message|messageTh)\s*:\s*` + STR + String.raw`[^{}]*?\bcode\s*:\s*` + codeRef), 'body with a literal message'],
        // makeError(<code>, '<text>') / holderDoorError(403, <code>, '<text>') / new SubmitGuardError(403, <code>, '<text>')
        [new RegExp(codeRef + String.raw`\s*,\s*` + STR), 'literal message argument'],
        // const err = new Error('<text>'); (up to two lines) err.code = <code>;
        [new RegExp(String.raw`new Error\(\s*` + STR + String.raw`[^\n]*\n(?:[^\n]*\n){0,2}[^\n]*\.code\s*=\s*` + codeRef), 'literal Error message'],
    ];
    const hits = [];
    for (const [re, why] of rules) {
        const m = src.match(re);
        if (m) { hits.push(`${src.slice(0, m.index).split('\n').length} ${why}`); }
    }
    return hits;
}

describe('ENTITY_PERMISSION_DENIED copy has one source and no workspace wording', () => {
    const { ERROR_CODES } = require('../../shared/error-codes');
    const { ENTITY_PERMISSION_DENIED_TH } = require('../../shared/entity-permission-denied');

    it('the catalogue carries the ruled Thai copy', () => {
        expect(ERROR_CODES.ENTITY_PERMISSION_DENIED.messageTh).toBe(RULED_TH);
        expect(ENTITY_PERMISSION_DENIED_TH).toBe(RULED_TH);
    });

    it('the copy follows thai-ui-copy: no em dash, no emoji', () => {
        expect(RULED_TH).not.toMatch(/—/);
        expect(RULED_TH).not.toMatch(/\p{Extended_Pictographic}/u);
    });

    it.each(DENIAL_SITES)('%s reads the catalogue copy instead of a literal', (rel) => {
        const src = fs.readFileSync(path.join(BACKEND, rel), 'utf8');
        expect(src).toMatch(/entityPermissionDeniedBody|ENTITY_PERMISSION_DENIED_TH/);
        expect(src).not.toMatch(/'คุณไม่มีสิทธิ์[^']*'/);
    });

    // Round 2 (review I1a): not a list of files. Every runtime file is read, so a new
    // door cannot build an ENTITY_PERMISSION_DENIED answer with its own text.
    // Round 3: also the shapes that name the code through a constant.
    it('no runtime backend file builds an ENTITY_PERMISSION_DENIED answer with its own message', () => {
        const OWNER = path.join('shared', 'entity-permission-denied.js');
        const CATALOGUE = path.join('shared', 'error-codes.js'); // the entry itself: `code: 'ENTITY_PERMISSION_DENIED'`
        const dirs = ['routes', 'services', 'middleware', 'controllers', 'shared', 'config', 'validation', 'utils', 'jobs', 'modules']
            .map((d) => path.join(BACKEND, d)).filter((d) => fs.existsSync(d));
        const hits = [];
        for (const file of dirs.flatMap((d) => walk(d))) {
            const rel = path.relative(BACKEND, file);
            if (rel === OWNER || rel === CATALOGUE || rel.includes(`${path.sep}__tests__${path.sep}`)) { continue; }
            hits.push(...ownDenialMessages(fs.readFileSync(file, 'utf8')).map((h) => `${rel}:${h}`));
        }
        expect(hits).toEqual([]);
    });

    // The guard proves itself: each sample is a way a door could write its own text.
    it.each([
        ['literal code body', "res.status(403).json({ success: false, code: 'ENTITY_PERMISSION_DENIED', error: 'x' });"],
        ['literal code in error', "res.json({ error: 'ENTITY_PERMISSION_DENIED', message: 'x' });"],
        ['constant code + literal error', "res.json({ code: ENTITY_PERMISSION_DENIED_CODE, error: 'ไม่มีสิทธิ์' });"],
        ['constant code + literal messageTh', "res.json({ success: false, code: ENTITY_PERMISSION_DENIED_CODE, permission: p, messageTh: `ไม่มีสิทธิ์` });"],
        ['local const code + literal message',
            "const DENIED = 'ENTITY_PERMISSION_DENIED';\nres.status(403).json({ code: DENIED, message: 'no' });"],
        ['local const code + literal message (multi-line body)',
            "const DENIED = \"ENTITY_PERMISSION_DENIED\";\nreturn res.status(403).json({\n  success: false,\n  code: DENIED,\n  error: 'คุณไม่มีสิทธิ์',\n});"],
        ['literal message argument', "throw makeError('ENTITY_PERMISSION_DENIED', 'ไม่มีสิทธิ์', 403);"],
        ['constant code + literal message argument', "throw makeError(ENTITY_PERMISSION_DENIED_CODE, 'no', 403);"],
        ['local const + literal message argument', "const PERMISSION_DENIED = 'ENTITY_PERMISSION_DENIED';\nthrow new SubmitGuardError(403, PERMISSION_DENIED, 'x');"],
        ['literal Error then code', "const err = new Error('no');\nerr.statusCode = 403;\nerr.code = 'ENTITY_PERMISSION_DENIED';"],
    ])('the guard flags a door that writes its own text: %s', (_label, sample) => {
        expect(ownDenialMessages(sample)).not.toEqual([]);
    });

    it.each([
        ['the helper', 'res.status(403).json(entityPermissionDeniedBody(permission));'],
        ['catalogue constants', "throw makeError(ENTITY_PERMISSION_DENIED_CODE, ENTITY_PERMISSION_DENIED_EN, 403);"],
        ['a local const with catalogue text', "const PERMISSION_DENIED = 'ENTITY_PERMISSION_DENIED';\nthrow new SubmitGuardError(403, PERMISSION_DENIED, ENTITY_PERMISSION_DENIED_EN);"],
        ['reading the code', "if (err?.code === 'ENTITY_PERMISSION_DENIED') { return deny(); }"],
    ])('the guard lets the single-source shapes through: %s', (_label, sample) => {
        expect(ownDenialMessages(sample)).toEqual([]);
    });

    it('the one body shape: code, the catalogue copy as error and messageTh, a generic English message', () => {
        const { entityPermissionDeniedBody, ENTITY_PERMISSION_DENIED_EN } = require('../../shared/entity-permission-denied');
        expect(ENTITY_PERMISSION_DENIED_EN).toBe(ERROR_CODES.ENTITY_PERMISSION_DENIED.messageEn);
        expect(entityPermissionDeniedBody('FARM_CREATE')).toEqual({
            success: false,
            code: 'ENTITY_PERMISSION_DENIED',
            permission: 'FARM_CREATE',
            error: RULED_TH,
            message: ERROR_CODES.ENTITY_PERMISSION_DENIED.messageEn,
            messageTh: RULED_TH,
        });
        expect(entityPermissionDeniedBody()).not.toHaveProperty('permission');
    });

    it('sendErrorResponse answers ENTITY_PERMISSION_DENIED with the catalogue copy whatever the thrower wrote', () => {
        const { sendErrorResponse } = require('../../shared/api-response');
        const res = { status: jest.fn().mockReturnThis(), json: jest.fn((b) => b) };
        const body = sendErrorResponse(res, { headers: {} }, {
            status: 403, code: 'ENTITY_PERMISSION_DENIED',
            message: 'Workspace member lacks permission SUBMIT_APPLICATION', messageTh: 'ไม่มีสิทธิ์ยื่นคำขอในนามนิติบุคคลนี้',
        });
        expect(res.status).toHaveBeenCalledWith(403);
        expect(body).toMatchObject({
            success: false,
            code: 'ENTITY_PERMISSION_DENIED',
            error: RULED_TH,
            message: ERROR_CODES.ENTITY_PERMISSION_DENIED.messageEn,
            messageTh: RULED_TH,
        });
    });

    it('no runtime backend file carries the retired workspace wording', () => {
        const dirs = ['routes', 'services', 'middleware', 'controllers', 'shared', 'config', 'validation', 'utils', 'jobs']
            .map((d) => path.join(BACKEND, d)).filter((d) => fs.existsSync(d));
        const hits = dirs.flatMap((d) => walk(d))
            .flatMap((file) => fs.readFileSync(file, 'utf8').split('\n')
                .map((line, i) => (RETIRED.test(line) ? `${path.relative(BACKEND, file)}:${i + 1}` : null))
                .filter(Boolean));
        expect(hits).toEqual([]);
    });
});
