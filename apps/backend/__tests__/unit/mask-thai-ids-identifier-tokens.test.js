/**
 * A national-ID masker must never rewrite an identifier.
 *
 * Defect (2026-10-03, on main a0ee3b68): THAI_ID_RUN_IN_TEXT accepts hyphens
 * between digits, so 13 digits spread over the groups of a UUID matched:
 *   c82d4715-4c75-4994-8945-880ab07c5ded → c82d4715-4c7-XXXX-XXXX-X-5880ab07c5ded
 * The audit logger runs every metadata string through it, so about 1 in 90
 * UUIDs written to audit_logs.metadata lost its digits for good. The same
 * happens to bare hex ids (32/64-char hashes) bounded by hex letters.
 *
 * The sample is generated from a fixed seed, so every run checks the same ids.
 */

'use strict';

const { maskThaiIdsInText, maskThaiId } = require('../../utils/field-encryption');

// xorshift32, fixed seed — the same 50,000 ids on every run.
function makeRandom(seed) {
    let s = seed >>> 0;
    return () => {
        s ^= s << 13; s >>>= 0;
        s ^= s >>> 17;
        s ^= s << 5; s >>>= 0;
        return s;
    };
}
function makeIds(seed) {
    const rnd = makeRandom(seed);
    const hex = (n) => { let o = ''; for (let i = 0; i < n; i++) { o += '0123456789abcdef'[rnd() & 15]; } return o; };
    const uuid = () => {
        const h = hex(32);
        return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${'89ab'[rnd() & 3]}${h.slice(17, 20)}-${h.slice(20)}`;
    };
    return { hex, uuid };
}

const SAMPLE = 50000;

function corrupted(gen, mask) {
    const bad = [];
    for (let i = 0; i < SAMPLE; i++) {
        const id = gen();
        if (mask(id) !== id) { bad.push(id); }
    }
    return bad;
}

const REPORTED_UUID = 'c82d4715-4c75-4994-8945-880ab07c5ded';
const ID = '1100000000008';
const MASKED = maskThaiId(ID); // 1-XXXX-XXXX-X-0008
const RUN_13 = /(?<!\d)\d{13}(?!\d)/;

describe('maskThaiIdsInText leaves identifiers intact', () => {
    it(`corrupts 0 of ${SAMPLE} fixed-seed UUIDs`, () => {
        const { uuid } = makeIds(0x12345678);
        const bad = corrupted(uuid, maskThaiIdsInText);
        expect({ corrupted: bad.length, first: bad.slice(0, 3) }).toEqual({ corrupted: 0, first: [] });
    });

    it(`corrupts 0 of ${SAMPLE} fixed-seed UUIDs written in upper case`, () => {
        const { uuid } = makeIds(0x0badc0de);
        const bad = corrupted(() => uuid().toUpperCase(), maskThaiIdsInText);
        expect(bad.length).toBe(0);
    });

    // A hex id holding a digit run main would mask (13 bounded) IS still masked (a national ID
    // glued to hex letters must never leak); every other hex id stays intact.
    it.each([[32], [64]])(`corrupts 0 of ${SAMPLE} fixed-seed %i-char hex ids without a 13-15 digit run (main behaviour kept)`, (len) => {
        const { hex } = makeIds(0x9e3779b9 + len);
        const MASKABLE = /(?<!\d)\d{13,15}(?!\d)/;
        const gen = () => { let h; do { h = hex(len); } while (MASKABLE.test(h)); return h; };
        const bad = corrupted(gen, maskThaiIdsInText);
        expect(bad.length).toBe(0);
    });

    it('leaves the reported UUID as it was, alone and inside text/JSON/URL', () => {
        expect(maskThaiIdsInText(REPORTED_UUID)).toBe(REPORTED_UUID);
        for (const text of [
            `application ${REPORTED_UUID} submitted`,
            `/api/applications/${REPORTED_UUID}/documents`,
            JSON.stringify({ entityId: REPORTED_UUID }),
            `ใบคำขอ${REPORTED_UUID}ถูกส่ง`,
        ]) {
            expect(maskThaiIdsInText(text)).toBe(text);
        }
    });

    it('leaves a cuid, an ObjectId and a sha-256 hash alone (no 13-digit run inside)', () => {
        for (const id of [
            'c123456789012abcdefghijkl',
            '5f1d7c2e9a123456789012bb',
            'ab123456789012cd' + 'e'.repeat(48),
        ]) {
            expect(maskThaiIdsInText(`id ${id} done`)).toBe(`id ${id} done`);
        }
    });
});

describe('maskThaiIdsInText still masks a real ID beside a UUID', () => {
    it.each([
        ['space', `${ID} ${REPORTED_UUID}`],
        ['hyphen', `${ID}-${REPORTED_UUID}`],
        ['UUID first', `${REPORTED_UUID}-${ID}`],
        ['Thai prose', `ผู้ยื่น ${ID} คำขอ ${REPORTED_UUID}`],
        ['JSON', JSON.stringify({ q: ID, applicationId: REPORTED_UUID })],
        ['URL', `/api/applications/${REPORTED_UUID}?q=${ID}`],
        ['dashed ID', `1-1000-00000-00-8 ${REPORTED_UUID}`],
    ])('%s', (_label, text) => {
        const out = maskThaiIdsInText(text);
        expect(out).toContain(REPORTED_UUID);
        expect(out).toContain(MASKED);
        expect(out).not.toMatch(RUN_13);
        expect(out.replace(REPORTED_UUID, '')).not.toContain('1000-00000');
    });

    it.each([
        ['bare', ID],
        ['hyphen', '1-1000-00000-00-8'],
        ['space', '1 1000 00000 00 8'],
        ['dot', '1.1000.00000.00.8'],
        ['slash', '1/1000/00000/00/8'],
        ['comma', '1,1000,00000,00,8'],
        ['en-dash', ['1', '1000', '00000', '00', '8'].join('–')],
        ['NBSP', ['1', '1000', '00000', '00', '8'].join(' ')],
        ['doubled', '1--1000--00000--00--8'],
        ['glued to a word', `ID${ID}`],
        ['glued to hex letters', `abc${ID}fee`],
        ['glued in front of a UUID', `${ID}${REPORTED_UUID}`],
        ['glued to Thai', `เลขบัตร${ID}ซ้ำ`],
    ])('masks the %s form', (_label, raw) => {
        const out = maskThaiIdsInText(`x ${raw} y`);
        expect(out).toContain(MASKED);
        expect(out.replace(/[^0-9]/g, '')).not.toContain(ID);
    });
});

describe('the audit logger stores ids untouched (the reported path)', () => {
    function loadLogger() {
        jest.resetModules();
        const prismaMock = {
            auditLog: { findFirst: jest.fn(), create: jest.fn(), findMany: jest.fn() },
            organization: { findUnique: jest.fn().mockResolvedValue({ id: 'default-org-id' }) },
            $executeRaw: jest.fn(), $transaction: jest.fn(), $disconnect: jest.fn(),
        };
        jest.doMock('../../services/prisma-database', () => ({ prisma: prismaMock }));
        return require('../../middleware/audit-logger').auditLogger;
    }

    it('metadata keeps the UUID and masks the ID next to it', () => {
        const auditLogger = loadLogger();
        const { data } = auditLogger._buildAuditRow({
            event: {
                category: 'APPLICATION', action: 'VIEW', actorId: 'u-1',
                resourceType: 'APPLICATION', resourceId: REPORTED_UUID,
                metadata: { entityId: REPORTED_UUID, query: { q: ID }, ids: [REPORTED_UUID] },
            },
            resolvedOrgId: 'org-1', previousHash: 'PARENT-HASH', sequenceNumber: 5,
        });
        const stored = JSON.parse(data.metadata);
        expect(stored.entityId).toBe(REPORTED_UUID);
        expect(stored.ids).toEqual([REPORTED_UUID]);
        expect(stored.query.q).toBe(MASKED);
    });
});
