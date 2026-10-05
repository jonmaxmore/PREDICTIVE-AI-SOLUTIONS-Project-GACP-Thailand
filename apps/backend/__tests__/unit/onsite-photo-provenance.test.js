/**
 * A photograph has to belong to the visit that took it (2026-08-26).
 *
 * The evidence minimum counts DISTINCT fileHash. An adversarial review defeated
 * that with no cleverness at all: one real photograph, re-saved by sharp at four
 * qualities plus a byte flip, is five distinct SHA-256 digests and one piece of
 * evidence — and this suite measures the same thing on the repo's real fixture,
 * where a q85 re-encode is a different file (different digest) and 5 bits away
 * perceptually, while a genuinely different scene is 23-28 bits away.
 *
 * So uploadPhoto now RECORDS three facts it does not enforce:
 *   A. how far the photograph's own coordinates sat from the farm,
 *   B. whether its timestamp falls inside the visit's window,
 *   C. what the frame looks like, as a perceptual hash.
 *
 * Every test below asserts that the fact is RECORDED and that the upload still
 * SUCCEEDS. That pairing is the point, not an oversight: a farm's registered
 * coordinates can be wrong, a large farm outruns any tolerance, a greenhouse
 * kills GPS, and an auditor photographing the same shed twice from the same
 * doorway legitimately produces near-identical frames. Refusing would strand the
 * careful auditor while the determined one edits the coordinates he sends. If a
 * future change makes any of this refuse, these tests are what should go red.
 */

'use strict';

// Same isolation the sibling onsite suites use: audit-onsite-service pulls the
// status writer / CAR deadline / audit-logger chain in at module load, none of
// which this file exercises.
jest.mock('../../services/application-status-writer', () => ({
    writeApplicationStatus: jest.fn(async () => ({ ok: true })),
}));
jest.mock('../../services/car-deadline-service', () => ({
    computeCarDueDate: jest.fn(() => new Date('2026-09-01T00:00:00.000Z')),
    seedCarRevisionDeadline: jest.fn(async () => ({})),
}));
jest.mock('../../middleware/audit-logger', () => ({
    statusTransitionAuditHook: () => (async () => {}),
}));
jest.mock('../../shared/logger', () => {
    const l = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    return Object.assign(l, { createLogger: () => l, default: l });
});

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const onsite = require('../../services/audit-onsite-service');
const { hammingDistance } = require('../../services/crypto/perceptual-hash');

const AUDITOR = 'auditor-A';
const ORG = 'org-1';

// The farm on record. Bangkok's centre, the same coordinates the sibling onsite
// suites use, so a distance computed here can be checked by hand.
const FARM = { latitude: 13.7563, longitude: 100.5018 };
// 0.045 degrees of latitude is ~5.0 km on any meridian, which makes this the one
// distance in the file that needs no trust in the haversine helper.
const FIVE_KM_NORTH = { latitude: FARM.latitude + 0.045, longitude: FARM.longitude };

const CHECK_IN = new Date('2026-08-26T02:00:00.000Z'); // 09:00 ICT
const DURING_VISIT = new Date('2026-08-26T03:30:00.000Z');
const THREE_WEEKS_EARLIER = new Date('2026-08-05T03:30:00.000Z');

const REAL_PHOTO = fs.readFileSync(path.join(__dirname, '../fixtures/onsite-farm-photo.jpg'));

const DIFFERENT_SCENE_SVG = '<svg width="640" height="480">'
    + '<rect width="640" height="480" fill="#fff"/>'
    + '<rect x="400" y="300" width="200" height="150" fill="#000"/></svg>';

/** The attack, verbatim: same photograph, re-saved, therefore a different file. */
const reencode = (quality) => sharp(REAL_PHOTO).jpeg({ quality }).toBuffer();

function makeAudit(overrides = {}) {
    return {
        id: 'audit-A',
        applicationId: 'app-A',
        auditorId: AUDITOR,
        organizationId: ORG,
        status: 'IN_PROGRESS',
        submittedAt: null,
        isDeleted: false,
        // verifyGpsAgainstFarm reads the farm's coordinates off the parent
        // Application's formData; it accepts an audit row carrying the include.
        application: { id: 'app-A', applicationNumber: 'APP-A', formData: { locationData: FARM } },
        ...overrides,
    };
}

/**
 * In-memory stand-ins for every delegate the upload + review paths touch.
 * `inspectionStartAt: null` models an audit whose auditor never checked in.
 */
function makePrisma({ audit = makeAudit(), inspectionStartAt = CHECK_IN, scheduledDate = null } = {}) {
    const rows = [];
    let seq = 0;
    const prisma = {
        auditChecklist: {
            findFirst: jest.fn(async ({ where }) => (where.id === audit.id ? audit : null)),
        },
        application: {
            findUnique: jest.fn(async () => (scheduledDate ? { scheduledDate } : null)),
        },
        gpsVerificationLog: {
            findFirst: jest.fn(async () => (inspectionStartAt ? { verifiedAt: inspectionStartAt } : null)),
        },
        farmAuditPhoto: {
            findFirst: jest.fn(async ({ where }) => {
                const wanted = (where.fileHash && typeof where.fileHash === 'object')
                    ? where.fileHash.equals
                    : where.fileHash;
                const hit = rows.find((r) => r.auditId === where.auditId
                    && String(r.fileHash).toLowerCase() === String(wanted).toLowerCase());
                return hit ? { id: hit.id } : null;
            }),
            create: jest.fn(async ({ data }) => {
                seq += 1;
                const row = { id: `photo-${seq}`, createdAt: new Date(), ...data };
                rows.push(row);
                return row;
            }),
            findMany: jest.fn(async ({ where }) => rows.filter((r) => r.auditId === where.auditId)),
            update: jest.fn(async () => ({})),
        },
        farmAuditChecklistItem: { findFirst: jest.fn(async () => null) },
    };
    return { prisma, rows };
}

const attachmentStub = () => ({
    attach: jest.fn(async () => ({ id: `att-${Math.random()}`, fileUrl: '/uploads/audits/a/1.jpg' })),
});

async function upload(prisma, fileBuffer, overrides = {}) {
    return onsite.uploadPhoto({
        auditId: 'audit-A',
        fileBuffer,
        fileName: 'IMG_2041.jpg',
        gpsLat: FARM.latitude,
        gpsLng: FARM.longitude,
        capturedAt: DURING_VISIT,
        uploadedBy: AUDITOR,
        organizationId: ORG,
        prisma,
        attachmentService: attachmentStub(),
        ...overrides,
    });
}

describe('layer A — the photograph records where it was taken', () => {
    test('a photo at the farm and a photo 5 km away both upload, and the row says which is which', async () => {
        const { prisma, rows } = makePrisma();

        const atFarm = await upload(prisma, REAL_PHOTO);
        const faraway = await upload(prisma, await reencode(60), {
            gpsLat: FIVE_KM_NORTH.latitude,
            gpsLng: FIVE_KM_NORTH.longitude,
        });

        // Both stored. This is the assertion that must never be "fixed" into a
        // rejection: distance is a fact for a reviewer, not a door.
        expect(atFarm.photoId).toBeTruthy();
        expect(faraway.photoId).toBeTruthy();
        expect(rows).toHaveLength(2);

        const near = rows.find((r) => r.id === atFarm.photoId);
        const far = rows.find((r) => r.id === faraway.photoId);

        expect(near.farmDistanceStatus).toBe('MEASURED');
        expect(near.farmDistanceMeters).toBeLessThan(1);

        expect(far.farmDistanceStatus).toBe('MEASURED');
        expect(far.farmDistanceMeters).toBeGreaterThan(4900);
        expect(far.farmDistanceMeters).toBeLessThan(5100);
    });

    test('an unknown farm location records UNKNOWN, never "0 metres away"', async () => {
        // The farm has no coordinates on record. Writing 0 here would say the
        // auditor stood exactly on the farm, which is the strongest possible
        // claim built out of the weakest possible evidence: nothing.
        const { prisma, rows } = makePrisma({
            audit: makeAudit({ application: { id: 'app-A', applicationNumber: 'APP-A', formData: {} } }),
        });

        const result = await upload(prisma, REAL_PHOTO);

        expect(result.photoId).toBeTruthy();
        expect(rows[0].farmDistanceStatus).toBe('FARM_LOCATION_UNKNOWN');
        expect(rows[0].farmDistanceMeters).toBeNull();
        expect(rows[0].farmDistanceMeters).not.toBe(0);
    });

    test('a reviewer sees FARM_LOCATION_UNKNOWN as its own finding, not as "far from the farm"', async () => {
        const { prisma } = makePrisma({
            audit: makeAudit({ application: { id: 'app-A', applicationNumber: 'APP-A', formData: {} } }),
        });
        await upload(prisma, REAL_PHOTO);

        const review = await onsite.reviewPhotoProvenance({ auditId: 'audit-A', prisma });

        expect(review.photos[0].flags).toContain('PLACE_FARM_LOCATION_UNKNOWN');
        expect(review.photos[0].flags).not.toContain('PLACE_BEYOND_TOLERANCE');
        // Nothing was measured, so nothing can be inside or outside a tolerance.
        expect(review.photos[0].place.beyondTolerance).toBeNull();
    });

    test('beyond the tolerance is flagged for a human and still stored', async () => {
        const { prisma } = makePrisma();
        await upload(prisma, REAL_PHOTO, {
            gpsLat: FIVE_KM_NORTH.latitude,
            gpsLng: FIVE_KM_NORTH.longitude,
        });

        const review = await onsite.reviewPhotoProvenance({ auditId: 'audit-A', prisma });

        expect(review.photoCount).toBe(1);
        expect(review.photos[0].place.beyondTolerance).toBe(true);
        expect(review.photos[0].place.toleranceMeters).toBe(onsite.DEFAULT_GPS_TOLERANCE_M);
        expect(review.photos[0].flags).toContain('PLACE_BEYOND_TOLERANCE');
    });
});

describe('layer B — the photograph records when it was taken', () => {
    test('a photo captured after the auditor checked in is INSIDE the visit window', async () => {
        const { prisma, rows } = makePrisma({ inspectionStartAt: CHECK_IN });

        await upload(prisma, REAL_PHOTO, { capturedAt: DURING_VISIT });

        expect(rows[0].captureWindowSource).toBe('INSPECTION_START');
        expect(rows[0].captureWindowStatus).toBe('INSIDE');
        expect(rows[0].captureWindowOffsetSec).toBe(0);
    });

    test('a photo taken three weeks before the visit is recorded OUTSIDE, with a negative offset, and still uploads', async () => {
        const { prisma, rows } = makePrisma({ inspectionStartAt: CHECK_IN });

        const result = await upload(prisma, REAL_PHOTO, { capturedAt: THREE_WEEKS_EARLIER });

        expect(result.photoId).toBeTruthy();
        expect(rows[0].captureWindowStatus).toBe('OUTSIDE');
        // Negative = taken before the window opened, which is the reading that
        // matters: the photograph existed before the auditor arrived.
        expect(rows[0].captureWindowOffsetSec).toBeLessThan(0);
        expect(rows[0].captureWindowOffsetSec)
            .toBe(Math.round((THREE_WEEKS_EARLIER.getTime() - CHECK_IN.getTime()) / 1000));
    });

    test('with no check-in row the planned visit day is used, in Asia/Bangkok', async () => {
        const { prisma, rows } = makePrisma({
            inspectionStartAt: null,
            scheduledDate: new Date('2026-08-26T03:00:00.000Z'), // 10:00 ICT on 26 Aug
        });

        // 23:30 ICT on 26 August. In UTC this is 16:30 on the 26th, but a naive
        // UTC day boundary would still be the wrong test — 17:30 UTC would be
        // 00:30 ICT on the 27th and must fall OUTSIDE.
        await upload(prisma, REAL_PHOTO, { capturedAt: new Date('2026-08-26T16:30:00.000Z') });
        await upload(prisma, await reencode(70), { capturedAt: new Date('2026-08-26T17:30:00.000Z') });

        expect(rows[0].captureWindowSource).toBe('SCHEDULED_DATE');
        expect(rows[0].captureWindowStatus).toBe('INSIDE');
        expect(rows[1].captureWindowStatus).toBe('OUTSIDE');
    });

    test('with neither a check-in nor a planned date the window is UNKNOWN, not "today"', async () => {
        // Falling back to "now" would put every upload inside a window nobody
        // ever established — the exact shape of failure this layer exists to
        // stop, wearing a green tick.
        const { prisma, rows } = makePrisma({ inspectionStartAt: null, scheduledDate: null });

        await upload(prisma, REAL_PHOTO);

        expect(rows[0].captureWindowSource).toBe('NONE');
        expect(rows[0].captureWindowStatus).toBe('WINDOW_UNKNOWN');
        expect(rows[0].captureWindowOffsetSec).toBeNull();
    });

    test('the stored capture time never claims to be the shutter', async () => {
        const { prisma, rows } = makePrisma();

        await upload(prisma, REAL_PHOTO, { capturedAt: DURING_VISIT });
        await upload(prisma, await reencode(75), { capturedAt: undefined });

        // A timestamp arrived with the request. That is all anyone can say: the
        // route substitutes its own clock when the client sends none, and no
        // EXIF parser exists in this tree.
        expect(rows[0].captureTimeSource).toBe('CALLER_SUPPLIED_UNVERIFIED');
        // None arrived, so the row holds the moment the bytes landed.
        expect(rows[1].captureTimeSource).toBe('SERVER_RECEIPT');
    });
});

describe('layer C — the photograph records what it looks like', () => {
    test('a re-encoded copy is a different FILE and is recorded as the same PHOTOGRAPH', async () => {
        const { prisma, rows } = makePrisma();

        const original = await upload(prisma, REAL_PHOTO);
        const reSaved = await upload(prisma, await reencode(85));

        // The attack, confirmed rather than assumed: distinct bytes, distinct
        // SHA-256, so the duplicate-bytes door never sees it.
        expect(reSaved.fileHash).not.toBe(original.fileHash);
        expect(rows).toHaveLength(2);

        const bits = hammingDistance(rows[0].perceptualHash, rows[1].perceptualHash);
        expect(bits).toBeLessThanOrEqual(10);

        const review = await onsite.reviewPhotoProvenance({ auditId: 'audit-A', prisma });
        expect(review.nearDuplicatePairs).toHaveLength(1);
        expect(review.nearDuplicatePairs[0].photoIds.sort())
            .toEqual([original.photoId, reSaved.photoId].sort());
        expect(review.nearDuplicatePairs[0].distanceBits).toBe(bits);
        expect(review.nearDuplicatePairs[0].sameFileHash).toBe(false);
        expect(review.photos.every((p) => p.flags.includes('NEAR_DUPLICATE'))).toBe(true);
    });

    test('a genuinely different photograph is NOT reported as a near duplicate', async () => {
        const { prisma, rows } = makePrisma();
        const otherScene = await sharp(Buffer.from(DIFFERENT_SCENE_SVG)).jpeg({ quality: 90 }).toBuffer();

        await upload(prisma, REAL_PHOTO);
        await upload(prisma, otherScene);

        expect(hammingDistance(rows[0].perceptualHash, rows[1].perceptualHash))
            .toBeGreaterThan(10);

        const review = await onsite.reviewPhotoProvenance({ auditId: 'audit-A', prisma });
        expect(review.nearDuplicatePairs).toHaveLength(0);
        expect(review.photos.some((p) => p.flags.includes('NEAR_DUPLICATE'))).toBe(false);
    });

    test('a near duplicate is FLAGGED and never refused', async () => {
        // The whole reason a perceptual hash may not gate: an auditor
        // photographing the same shed twice from the same doorway produces
        // exactly this, honestly.
        const { prisma } = makePrisma();

        await upload(prisma, REAL_PHOTO);
        const second = await upload(prisma, await reencode(88));

        expect(second.photoId).toBeTruthy();
        expect(second.provenance.perceptualHash).toMatch(/^[0-9a-f]{16}$/);
        expect(second.provenance.perceptualHashAlgo).toBe(onsite.PERCEPTUAL_HASH_ALGORITHM);
    });

    test('hashes from different algorithms are never compared', async () => {
        // A Hamming distance across two different hash functions is noise that
        // would print as a number and be believed.
        const { prisma, rows } = makePrisma();
        await upload(prisma, REAL_PHOTO);
        await upload(prisma, await reencode(85));
        rows[1].perceptualHashAlgo = 'some-future-hash-v2';

        const review = await onsite.reviewPhotoProvenance({ auditId: 'audit-A', prisma });

        expect(review.nearDuplicatePairs).toHaveLength(0);
    });
});

describe('what a NULL means to whoever reads it', () => {
    test('a row written before any of this existed reads as NOT_RECORDED, never as verified', async () => {
        const { prisma, rows } = makePrisma();
        await upload(prisma, REAL_PHOTO);
        // Exactly the shape `prisma migrate deploy` leaves behind on every row
        // that already existed: the columns are there and every one is NULL.
        Object.assign(rows[0], {
            farmDistanceMeters: null, farmDistanceStatus: null,
            captureTimeSource: null, captureWindowSource: null,
            captureWindowStatus: null, captureWindowOffsetSec: null,
            perceptualHash: null, perceptualHashAlgo: null,
        });

        const review = await onsite.reviewPhotoProvenance({ auditId: 'audit-A', prisma });
        const photo = review.photos[0];

        expect(photo.flags).toEqual(expect.arrayContaining([
            'PLACE_NOT_RECORDED', 'TIME_NOT_RECORDED', 'APPEARANCE_NOT_RECORDED',
        ]));
        // Not a blank cell beside rows reading MEASURED and INSIDE — a blank
        // next to a tick reads as agreement.
        expect(photo.place.status).toBe('NOT_RECORDED');
        expect(photo.time.status).toBe('NOT_RECORDED');
        expect(photo.time.capturedAtSource).toBe('NOT_RECORDED');
        expect(review.notRecorded).toEqual({ place: 1, time: 1, appearance: 1 });
        expect(review.needsAttention).toBe(1);
    });

    test('a fully measured, unremarkable photograph raises nothing', async () => {
        // The counterweight: if every photograph always carried a flag, the
        // flags would mean nothing and a reviewer would stop reading them.
        const { prisma } = makePrisma();
        await upload(prisma, REAL_PHOTO);

        const review = await onsite.reviewPhotoProvenance({ auditId: 'audit-A', prisma });

        expect(review.photos[0].flags).toEqual([]);
        expect(review.needsAttention).toBe(0);
        expect(review.notRecorded).toEqual({ place: 0, time: 0, appearance: 0 });
    });

    test('an unprovisioned photo model refuses to answer instead of reporting an empty, clean audit', async () => {
        const { prisma } = makePrisma();
        delete prisma.farmAuditPhoto.findMany;

        await expect(onsite.reviewPhotoProvenance({ auditId: 'audit-A', prisma }))
            .rejects.toMatchObject({ code: 'ONSITE_NOT_AVAILABLE' });
    });
});

describe('provenance never costs a photograph', () => {
    test('a failing metadata lookup still stores the evidence', async () => {
        // An auditor standing in a field on one bar of signal must not lose a
        // photograph because a lookup about it fell over.
        const { prisma, rows } = makePrisma();
        prisma.gpsVerificationLog.findFirst = jest.fn(async () => { throw new Error('connection reset'); });
        prisma.application.findUnique = jest.fn(async () => { throw new Error('connection reset'); });

        const result = await upload(prisma, REAL_PHOTO);

        expect(result.photoId).toBeTruthy();
        expect(rows[0].captureWindowStatus).toBe('WINDOW_UNKNOWN');
        // The layers are independent: place and appearance still answered.
        expect(rows[0].farmDistanceStatus).toBe('MEASURED');
        expect(rows[0].perceptualHash).toMatch(/^[0-9a-f]{16}$/);
    });

    test('bytes that cannot be decoded leave the hash NULL and still store the row', async () => {
        // The route's content guard refuses undecodable uploads before this
        // point, so reaching here means the decoder is unavailable, not that the
        // file is junk. Either way the photograph is kept.
        const { prisma, rows } = makePrisma();

        const result = await upload(prisma, Buffer.from('not an image at all'));

        expect(result.photoId).toBeTruthy();
        expect(rows[0].perceptualHash).toBeNull();
        expect(rows[0].perceptualHashAlgo).toBeNull();
    });
});
