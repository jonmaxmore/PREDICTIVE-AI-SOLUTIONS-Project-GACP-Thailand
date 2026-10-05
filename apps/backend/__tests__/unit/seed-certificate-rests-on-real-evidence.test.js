'use strict';

/**
 * The seed may not create what the product itself cannot.
 *
 * An adversarial review on 2026-08-26 enumerated every path in the repository that ends in a
 * Certificate row and found exactly two: certificate-service.generateCertificate, which sits
 * behind assertOnsiteEvidenceSufficient and which every route, hook, handler and script
 * funnels through — and prisma/seed-gacp.js, a direct `certificate.upsert` that passed no
 * gate at all. Signing that row (fixed earlier the same day) made it verifiable, not true:
 * it still asserted that a farm had passed an onsite audit nobody carried out, and in the
 * database and under a buyer's QR scanner it was indistinguishable from one that had.
 *
 * The seed now records the visit and asks the product for a certificate. This file proves
 * that, and proves it WITHOUT running the seed against a database, in two halves:
 *
 *   1. BEHAVIOUR — run the seed's own evidence step against an in-memory client and then ask
 *      the REAL gate (services/onsite-evidence-gate.js, not a copy of its rules) whether what
 *      the seed wrote is sufficient. Controls follow, each removing one property the seed
 *      supplies, and each must make the REAL gate refuse: that is what makes the green above
 *      mean something rather than mean the gate is asleep.
 *
 *   2. SOURCE — the seed has no second door. A behavioural test of one function cannot see a
 *      `certificate.upsert` somebody adds ten lines further down, so the file itself is read.
 *
 * Note what the photo assertions do and do not claim. The gate counts DISTINCT fileHash, so
 * the property under test is distinct BYTES. The seeded frames are not five photographs of a
 * farm and nothing here pretends they are — see the fixture comment in the seed and the
 * measurement recorded in services/crypto/perceptual-hash.js.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { seedOnsiteAuditEvidence, ONSITE_PHOTO_FIXTURES, buildOnsitePhotoJpeg } = require('../../prisma/seed-gacp');
const { assertOnsiteEvidenceSufficient } = require('../../services/onsite-evidence-gate');
const { CHECKLIST_TEMPLATE_2026, DEFAULT_MIN_PHOTOS, computePhotoHash } = require('../../services/audit-onsite-service');

const SEED_PATH = path.join(__dirname, '../../prisma/seed-gacp.js');

const APPLICATION_ID = '11111111-1111-4111-8111-111111111111';
const AUDITOR_ID = '22222222-2222-4222-8222-222222222222';
const ORG_ID = '33333333-3333-4333-8333-333333333333';

// ── An in-memory stand-in for the Prisma client ──────────────────────────────────────────
//
// Deliberately generic: it answers the delegate calls the real services make and knows
// nothing about audits. Every rule under test therefore lives in the production modules, not
// in here — a fake that "knows" a certificate needs five photos would prove only that the
// fake knows it.

function matchesValue(actual, expected) {
    if (expected && typeof expected === 'object' && !(expected instanceof Date) && !Array.isArray(expected)) {
        if (Array.isArray(expected.in)) { return expected.in.includes(actual); }
        if (Array.isArray(expected.notIn)) { return !expected.notIn.includes(actual); }
        if ('equals' in expected) {
            if (expected.mode === 'insensitive') {
                return String(actual).toLowerCase() === String(expected.equals).toLowerCase();
            }
            return actual === expected.equals;
        }
        throw new Error(`fake prisma: unsupported filter ${JSON.stringify(expected)}`);
    }
    return actual === expected;
}

function matchesWhere(row, where = {}) {
    return Object.entries(where).every(([key, expected]) => matchesValue(row[key], expected));
}

function makeDelegate(store, name) {
    let sequence = 0;
    const stamp = () => new Date(Date.UTC(2026, 7, 26, 0, 0, (sequence += 1)));
    const all = () => store[name];

    const sorted = (rows, orderBy) => {
        if (!orderBy || !orderBy.createdAt) { return rows; }
        const dir = orderBy.createdAt === 'desc' ? -1 : 1;
        return [...rows].sort((a, b) => dir * (new Date(a.createdAt) - new Date(b.createdAt)));
    };

    return {
        async create({ data }) {
            const row = { id: data.id || crypto.randomUUID(), createdAt: stamp(), isDeleted: false, ...data };
            all().push(row);
            return { ...row };
        },
        async findFirst({ where, orderBy } = {}) {
            const hit = sorted(all().filter((row) => matchesWhere(row, where)), orderBy)[0];
            return hit ? { ...hit } : null;
        },
        async findUnique({ where } = {}) {
            const hit = all().find((row) => matchesWhere(row, where));
            return hit ? { ...hit } : null;
        },
        async findMany({ where, orderBy } = {}) {
            return sorted(all().filter((row) => matchesWhere(row, where)), orderBy).map((row) => ({ ...row }));
        },
        async count({ where } = {}) {
            return all().filter((row) => matchesWhere(row, where)).length;
        },
        async update({ where, data }) {
            const hit = all().find((row) => matchesWhere(row, where));
            if (!hit) { throw new Error(`fake prisma: ${name}.update found no row`); }
            Object.assign(hit, data);
            return { ...hit };
        },
        async updateMany({ where, data }) {
            const hits = all().filter((row) => matchesWhere(row, where));
            hits.forEach((row) => Object.assign(row, data));
            return { count: hits.length };
        },
        async upsert({ where, create, update }) {
            // The only compound key any caller under test uses.
            const compound = where.auditId_itemCode;
            const flat = compound ? { auditId: compound.auditId, itemCode: compound.itemCode } : where;
            const hit = all().find((row) => matchesWhere(row, flat));
            if (hit) {
                Object.assign(hit, update);
                return { ...hit };
            }
            return this.create({ data: { ...flat, ...create } });
        },
    };
}

/**
 * Clone a store so a control test can remove one property without disturbing the others.
 * Hand-written rather than structuredClone (not in this project's eslint globals) or a JSON
 * round-trip (which would turn every Date column into a string).
 */
function deepClone(value) {
    if (value instanceof Date) { return new Date(value.getTime()); }
    if (Array.isArray(value)) { return value.map(deepClone); }
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, deepClone(inner)]));
    }
    return value;
}

function makeFakePrisma(initialStore) {
    const store = initialStore || {
        application: [],
        auditChecklist: [],
        farmAuditChecklistItem: [],
        farmAuditPhoto: [],
        attachment: [],
        gpsVerificationLog: [],
    };
    const client = { store };
    for (const model of Object.keys(store)) {
        client[model] = makeDelegate(store, model);
    }
    client.$transaction = async (fn) => fn(client);
    return client;
}

async function seedEvidenceInto(db) {
    await db.application.create({
        data: { id: APPLICATION_ID, applicationNumber: 'APP-68-002', status: 'APPROVED', formData: {} },
    });
    return seedOnsiteAuditEvidence({
        prisma: db,
        applicationId: APPLICATION_ID,
        auditorId: AUDITOR_ID,
        organizationId: ORG_ID,
        visitedAt: new Date('2026-08-26T03:00:00.000Z'),
    });
}

describe('what the seed writes is real onsite evidence', () => {
    let db;
    let result;
    let pinnedAuditId;

    beforeAll(async () => {
        db = makeFakePrisma();
        result = await seedEvidenceInto(db);
        const app = await db.application.findUnique({ where: { id: APPLICATION_ID } });
        pinnedAuditId = app.formData.onsiteAuditId;
    }, 60000);

    it('arms exactly one audit, bound to the application, and pins it there', () => {
        expect(db.store.auditChecklist).toHaveLength(1);
        expect(db.store.auditChecklist[0]).toMatchObject({
            applicationId: APPLICATION_ID,
            auditorId: AUDITOR_ID,
            status: 'IN_PROGRESS',
        });
        // The pin is what makes the gate verify THIS application's audit rather than
        // re-resolving; a certificate minted off an unbound audit is the hole the
        // AUDIT_APPLICATION_MISMATCH refusal exists to close.
        expect(pinnedAuditId).toBe(result.auditId);
        expect(pinnedAuditId).toBe(db.store.auditChecklist[0].id);
    });

    it(`records ${DEFAULT_MIN_PHOTOS} photographs whose bytes genuinely differ`, () => {
        expect(ONSITE_PHOTO_FIXTURES).toHaveLength(DEFAULT_MIN_PHOTOS);
        expect(result.photosRecorded).toBe(DEFAULT_MIN_PHOTOS);
        const hashes = db.store.farmAuditPhoto.map((row) => row.fileHash);
        expect(hashes).toHaveLength(DEFAULT_MIN_PHOTOS);
        // Distinct hashes = distinct bytes. This is the property the gate counts and the
        // only one the seed claims: five renders of one frame would collapse to a set of 1.
        expect(new Set(hashes).size).toBe(DEFAULT_MIN_PHOTOS);
        expect(hashes.every((hash) => /^[0-9a-f]{64}$/.test(hash))).toBe(true);
    });

    it('answers every item of the canonical checklist with a recognised verdict', () => {
        expect(db.store.farmAuditChecklistItem).toHaveLength(CHECKLIST_TEMPLATE_2026.length);
        const answered = db.store.farmAuditChecklistItem.filter((row) => ['PASS', 'FAIL', 'NA'].includes(row.response));
        expect(answered).toHaveLength(CHECKLIST_TEMPLATE_2026.length);
        const codes = db.store.farmAuditChecklistItem.map((row) => row.itemCode).sort();
        expect(codes).toEqual(CHECKLIST_TEMPLATE_2026.map((item) => item.itemCode).sort());
    });

    it('links each photograph to the checklist item it was taken for', () => {
        for (const photo of db.store.farmAuditPhoto) {
            expect(photo.checklistItemId).toBeTruthy();
            const item = db.store.farmAuditChecklistItem.find((row) => row.id === photo.checklistItemId);
            expect(item).toBeDefined();
            expect(ONSITE_PHOTO_FIXTURES.map((f) => f.itemCode)).toContain(item.itemCode);
        }
    });

    it('THE REAL GATE accepts it — the same call generateCertificate makes before minting', async () => {
        const verdict = await assertOnsiteEvidenceSufficient({
            prisma: db,
            applicationId: APPLICATION_ID,
            auditId: pinnedAuditId,
        });
        expect(verdict).toEqual({
            auditId: pinnedAuditId,
            photoCount: DEFAULT_MIN_PHOTOS,
            itemCount: CHECKLIST_TEMPLATE_2026.length,
        });
    });

    it('is idempotent: a re-seed adds no sixth photograph and no second audit', async () => {
        const again = await seedOnsiteAuditEvidence({
            prisma: db,
            applicationId: APPLICATION_ID,
            auditorId: AUDITOR_ID,
            organizationId: ORG_ID,
            visitedAt: new Date('2026-08-27T03:00:00.000Z'),
        });
        expect(again.auditId).toBe(result.auditId);
        expect(again.photosAlreadyRecorded).toBe(DEFAULT_MIN_PHOTOS);
        expect(again.photosRecorded).toBe(0);
        expect(db.store.auditChecklist).toHaveLength(1);
        expect(db.store.farmAuditPhoto).toHaveLength(DEFAULT_MIN_PHOTOS);
    }, 60000);
});

describe('the gate is what accepted it (remove a property, it refuses)', () => {
    let baseStore;
    let auditId;

    beforeAll(async () => {
        const db = makeFakePrisma();
        const seeded = await seedEvidenceInto(db);
        auditId = seeded.auditId;
        baseStore = db.store;
    }, 60000);

    const gateOn = (store) => assertOnsiteEvidenceSufficient({
        prisma: makeFakePrisma(store),
        applicationId: APPLICATION_ID,
        auditId,
    });

    it('four photographs short → INSUFFICIENT_PHOTOS', async () => {
        const store = deepClone(baseStore);
        store.farmAuditPhoto = store.farmAuditPhoto.slice(0, 1);
        await expect(gateOn(store)).rejects.toMatchObject({ code: 'INSUFFICIENT_PHOTOS' });
    });

    it('five copies of ONE photograph would never have passed', async () => {
        const store = deepClone(baseStore);
        const [first] = store.farmAuditPhoto;
        store.farmAuditPhoto = store.farmAuditPhoto.map((row) => ({ ...row, fileHash: first.fileHash }));
        expect(store.farmAuditPhoto).toHaveLength(DEFAULT_MIN_PHOTOS);
        await expect(gateOn(store)).rejects.toMatchObject({ code: 'INSUFFICIENT_PHOTOS' });
    });

    it('one unanswered checklist item → INCOMPLETE_CHECKLIST', async () => {
        const store = deepClone(baseStore);
        store.farmAuditChecklistItem[3].response = 'PENDING';
        await expect(gateOn(store)).rejects.toMatchObject({ code: 'INCOMPLETE_CHECKLIST' });
    });

    it('a critical item recorded FAIL → CRITICAL_CHECKLIST_FAILURE', async () => {
        const store = deepClone(baseStore);
        const criticalCode = CHECKLIST_TEMPLATE_2026.find((item) => item.isCritical === true).itemCode;
        store.farmAuditChecklistItem.find((row) => row.itemCode === criticalCode).response = 'FAIL';
        await expect(gateOn(store)).rejects.toMatchObject({ code: 'CRITICAL_CHECKLIST_FAILURE' });
    });

    it('no audit at all → NO_ONSITE_AUDIT', async () => {
        const store = deepClone(baseStore);
        store.auditChecklist = [];
        store.farmAuditPhoto = [];
        store.farmAuditChecklistItem = [];
        await expect(assertOnsiteEvidenceSufficient({
            prisma: makeFakePrisma(store),
            applicationId: APPLICATION_ID,
        })).rejects.toMatchObject({ code: 'NO_ONSITE_AUDIT' });
    });
});

describe('the photographs are what the audit rows say they are', () => {
    it('each stored fileHash is the SHA-256 of the bytes that fixture renders', async () => {
        // Re-render outside the seed and recompute with the service's own hasher: a row whose
        // hash does not belong to any real file would satisfy a distinct-count while standing
        // for nothing.
        const db = makeFakePrisma();
        await seedEvidenceInto(db);
        const stored = new Set(db.store.farmAuditPhoto.map((row) => row.fileHash));
        for (const fixture of ONSITE_PHOTO_FIXTURES) {
            const bytes = await buildOnsitePhotoJpeg(fixture);
            expect(Buffer.isBuffer(bytes)).toBe(true);
            // JPEG SOI marker: an openable file, not an invented blob.
            expect(bytes.subarray(0, 2).toString('hex')).toBe('ffd8');
            expect(stored.has(computePhotoHash(bytes))).toBe(true);
        }
    }, 60000);
});

describe('the seed has no second door to a Certificate row', () => {
    // Full-line comments only: the seed DESCRIBES the retired upsert in prose, and a scan that
    // could not tell prose from code would either fail on the explanation or force it to be
    // deleted — which is how a file loses the record of why it is shaped as it is.
    const source = fs.readFileSync(SEED_PATH, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((line) => !/^\s*(\/\/|\*)/.test(line))
        .join('\n');

    it.each([
        ['a certificate row', /\bcertificate\s*\.\s*(create|createMany|upsert)\s*\(/],
        ['an audit row', /\bauditChecklist\s*\.\s*(create|createMany|upsert)\s*\(/],
        ['a photo row', /\bfarmAuditPhoto\s*\.\s*(create|createMany|upsert)\s*\(/],
        ['a checklist-item row', /\bfarmAuditChecklistItem\s*\.\s*(create|createMany|upsert)\s*\(/],
    ])('never writes %s directly', (_label, pattern) => {
        expect(source).not.toMatch(pattern);
    });

    it.each([
        ['issues through the certificate service', /certificateService\.generateCertificate\s*\(/],
        ['arms the evidence chain through the one function allowed to', /armOnsiteEvidence\s*\(\s*client/],
        ['answers the checklist through the auditor service', /onsiteService\.submitChecklistItem\s*\(/],
        ['uploads photographs through the auditor service', /onsiteService\.uploadPhoto\s*\(/],
    ])('%s', (_label, pattern) => {
        expect(source).toMatch(pattern);
    });

    it('still refuses to seed when it is merely required', () => {
        // Proven twice: this file has required the seed at the top and no rows were written
        // anywhere, and the guard is still in the source.
        expect(source).toMatch(/if\s*\(\s*require\.main\s*===\s*module\s*\)/);
    });
});
