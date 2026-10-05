/**
 * @module services/audit-onsite-service
 *
 * Iter 25 (B25-B) — onsite audit workflow service.
 *
 * Owns the auditor's "on-the-farm" execution path for a confirmed audit:
 *   1. startInspection({ auditId, auditorId, gpsLat, gpsLng, ... })
 *        — opens the inspection, writes a GpsVerificationLog start row,
 *          returns the GACP checklist template.
 *   2. submitChecklistItem({ auditId, itemCode, response, notes, photoIds })
 *        — persists one checklist item + links any photo evidence.
 *   3. uploadPhoto({ auditId, fileBuffer, gpsLat, gpsLng, capturedAt, caption })
 *        — SHA-256 hashes the bytes (tamper detection per slip-hash-integrity
 *          pattern), stores via attachment-service, writes a FarmAuditPhoto
 *          row tagged with GPS + timestamp + hash.
 *   4. submitDecision({ auditId, decision, summary, criticalFindings,
 *                       actorId })
 *        — atomically writes the Audit decision row + transitions the
 *          parent Application via writeApplicationStatus + fans out a
 *          notification to the applicant.
 *
 * GPS verification: verifyGpsAgainstFarm({ auditId, gpsLat, gpsLng })
 *   computes haversine distance from the auditor's coordinates to the
 *   farm registered on the parent Application. Default tolerance 500 m
 *   (configurable). Surfaces a `withinTolerance` flag so the route can
 *   block (or warn) when the auditor is not physically at the farm —
 *   the primary fraud-detection signal for the onsite path.
 *
 * Photo integrity: every uploaded photo is hashed with SHA-256 over its
 * bytes; the hash, GPS coordinates, and capturedAt timestamp are stored
 * on FarmAuditPhoto. Same bytes always yield the same hash; modified
 * bytes always yield a different hash — so the hash + the audit chain
 * around the photo row together satisfy Thai e-Transactions Act
 * B.E. 2544/2001 §12 (electronic record must demonstrate that its
 * integrity has been preserved) and ISO 27799:2016 §7.10
 * (cryptographic integrity controls bound to the audit trail).
 *
 * Photo provenance (2026-08-26): a hash proves the bytes have not changed
 * since upload. It says nothing about whether the photograph was taken at
 * this farm, during this visit, or of a different scene from the one beside
 * it — and counting DISTINCT hashes was defeated by one photograph re-saved
 * five times. So every upload also RECORDS three things it does not enforce:
 * how far the photo's own coordinates sat from the farm, whether its
 * timestamp falls inside the visit's window, and a perceptual hash of what
 * the frame looks like. capturePhotoProvenance() writes them;
 * reviewPhotoProvenance() reads them back for a human, turning every
 * unmeasured column into an explicit NOT_RECORDED rather than a blank that
 * would read as agreement. None of it refuses an upload and none of it is
 * read by onsite-evidence-gate.js — see the note on each function for why
 * gating on any of it would strand the careful auditor and stop nobody else.
 *
 * Decision matrix (GACP-PRD §6 onsite checklist):
 *   - PASS          → transition AUDIT_CONFIRMED → AUDIT_PASSED
 *                     (cert generation happens downstream).
 *   - FAIL          → transition AUDIT_CONFIRMED → CAR_PENDING
 *                     (Corrective Action Required loop).
 *   - NEEDS_REVIEW  → keeps the audit row open (status IN_PROGRESS, submittedAt
 *                     null) and performs no application transition; head-auditor
 *                     review is signalled by the NEEDS_REVIEW notification.
 *                     (FAIL/PASS details persist on the parent Application via
 *                     additionalData + the audit log — AuditChecklist has no
 *                     formData column.)
 *
 * Boundaries: this service does NOT touch refund-service, period-close,
 * journal-entry, audit-scheduling-service, application-status-writer
 * (caller of writeApplicationStatus), or notification-fanout-service
 * (caller of send()). It does NOT touch frontend code or RBAC.
 */

'use strict';

const crypto = require('crypto');
const { writeApplicationStatus } = require('./application-status-writer');
const { statusTransitionAuditHook } = require('../middleware/audit-logger');
// CAR 5-working-day SLA clock — the field-tool FAIL→CAR_PENDING path previously
// seeded neither carDueAt nor a RevisionDeadline row (the 2026-06-11 HIGH, fixed
// only on the Job Sheet handler), so onsite CARs never auto-expired. Mirror
// auditor-audit-decision-handler.js.
const { computeCarDueDate, seedCarRevisionDeadline } = require('./car-deadline-service');
// cert-integrity fix (Phase A2, 2026-08-16): the fail-closed evidence check
// is now a SHARED helper — certificate-service.generateCertificate calls the
// exact same function (the choke point every cert-mint path crosses). See
// services/onsite-evidence-gate.js and the change log.
const { assertOnsiteEvidenceSufficient } = require('./onsite-evidence-gate');
const { ONSITE_AUDIT } = require('../config/business-rules');
const { assertDecisionNotByReviewerAndInspector } = require('../shared/reviewer-inspector-separation');

// Lazy requires keep the module loadable from tests that stub these.
let _prismaModule = null;
function _resolvePrisma() {
    if (!_prismaModule) {
        try {
            _prismaModule = require('./prisma-database');
        } catch (_e) {
            _prismaModule = { prisma: null };
        }
    }
    return _prismaModule.prisma;
}

let _attachmentSvc = null;
function _resolveAttachmentService() {
    if (!_attachmentSvc) {
        _attachmentSvc = require('./attachment-service');
    }
    return _attachmentSvc;
}

let _fanoutSvc = null;
function _resolveFanoutService() {
    if (!_fanoutSvc) {
        _fanoutSvc = require('./notification-fanout-service');
    }
    return _fanoutSvc;
}

let _logger = null;
function _resolveLogger() {
    if (!_logger) {
        try {
            _logger = require('../shared/logger');
        } catch (_e) {
            _logger = { info: () => {}, warn: () => {}, error: () => {} };
        }
    }
    return _logger;
}

// ── Constants ──────────────────────────────────────────────────────────────

/**
 * Decision codes. PASS / FAIL / NEEDS_REVIEW match the GACP-PRD §6.4
 * matrix the auditor selects in the UI; the canonical workflow target
 * is derived in `_targetStateForDecision()`.
 */
const DECISIONS = Object.freeze({
    PASS: 'PASS',
    FAIL: 'FAIL',
    NEEDS_REVIEW: 'NEEDS_REVIEW',
});
const ALL_DECISIONS = Object.freeze([
    DECISIONS.PASS,
    DECISIONS.FAIL,
    DECISIONS.NEEDS_REVIEW,
]);

/**
 * GPS tolerance in metres. Anything beyond this distance from the
 * registered farm coordinates flips `withinTolerance` to false on the
 * verifyGpsAgainstFarm() result — the route surfaces that as a
 * fraud-warning to the auditor (and on submitDecision will refuse to
 * issue a PASS until the operator overrides).
 *
 * The default of 500 m comes from GACP-PRD §6.2 (auditor presence
 * verification) and aligns with the existing 500 m used in the legacy
 * farm-audit.js photo path.
 */
const DEFAULT_GPS_TOLERANCE_M = 500;

/**
 * Minimum number of photos that must be uploaded before a decision is
 * accepted. GACP-PRD §6.5 mandates "at least one photo per checklist
 * section" — with the canonical 5-section reduced template (cultivation,
 * post-harvest, storage, documentation, personnel hygiene) that floors
 * out at 5. Configurable per-call via submitDecision({ minPhotos }).
 */
const DEFAULT_MIN_PHOTOS = 5;

/**
 * GACP-PRD §6 checklist template (versioned).  Each item has:
 *   - itemCode    : stable identifier (e.g. '4.1' = cultivation practices)
 *   - section     : top-level section (matches farm-audit-checklist-service)
 *   - prompt      : Thai-language prompt shown to the auditor
 *   - isCritical  : a single FAIL on a critical item forces overall FAIL
 *   - maxPoints   : scoring weight (used by the upstream scoring service)
 *
 * The dataset below is the GACP-PRD §6 reduced template (24 items).
 * In production this is sourced from GcpChecklistTemplate (versioned
 * row in the DB); the local copy here is the fallback returned to the
 * auditor when the table is empty or unreachable.
 */
const CHECKLIST_TEMPLATE_2026 = Object.freeze([
    // 1. Site selection (เลือกที่ตั้งฟาร์ม) — GACP-PRD §6.1
    { itemCode: '1.1', section: 'SITE_SELECTION', prompt: 'พื้นที่ปลอดจากแหล่งปนเปื้อน', isCritical: true, maxPoints: 5 },
    { itemCode: '1.2', section: 'SITE_SELECTION', prompt: 'แปลงปลูกห่างจากแหล่งน้ำเสีย', isCritical: false, maxPoints: 3 },
    // 2. Water source (แหล่งน้ำ) — GACP-PRD §6.2
    { itemCode: '2.1', section: 'WATER_SOURCE', prompt: 'แหล่งน้ำมีผลตรวจคุณภาพ', isCritical: true, maxPoints: 5 },
    { itemCode: '2.2', section: 'WATER_SOURCE', prompt: 'ระบบกรองน้ำได้รับการบำรุงรักษา', isCritical: false, maxPoints: 3 },
    // 3. Seed source (แหล่งพันธุ์) — GACP-PRD §6.3
    { itemCode: '3.1', section: 'SEED_SOURCE', prompt: 'แหล่งพันธุ์มีเอกสารรับรอง', isCritical: true, maxPoints: 5 },
    { itemCode: '3.2', section: 'SEED_SOURCE', prompt: 'มีการจดทะเบียน ภพ.4', isCritical: false, maxPoints: 3 },
    // 4. Cultivation practices (การปลูก) — GACP-PRD §6.4
    { itemCode: '4.1', section: 'CULTIVATION', prompt: 'มีบันทึกการปลูกตามรอบ', isCritical: true, maxPoints: 5 },
    { itemCode: '4.2', section: 'CULTIVATION', prompt: 'การจัดการศัตรูพืชเป็นไปตาม IPM', isCritical: false, maxPoints: 3 },
    { itemCode: '4.3', section: 'CULTIVATION', prompt: 'การใช้ปุ๋ยมีบันทึกครบถ้วน', isCritical: false, maxPoints: 3 },
    // 5. Harvesting (การเก็บเกี่ยว) — GACP-PRD §6.5
    { itemCode: '5.1', section: 'HARVESTING', prompt: 'การเก็บเกี่ยวเป็นไปตามมาตรฐาน', isCritical: true, maxPoints: 5 },
    { itemCode: '5.2', section: 'HARVESTING', prompt: 'เครื่องมือเก็บเกี่ยวสะอาด', isCritical: false, maxPoints: 3 },
    // 6. Post-harvest (หลังเก็บเกี่ยว) — GACP-PRD §6.6
    { itemCode: '6.1', section: 'POST_HARVEST', prompt: 'มีการตากแห้งในสภาพที่ควบคุม', isCritical: true, maxPoints: 5 },
    { itemCode: '6.2', section: 'POST_HARVEST', prompt: 'การคัดแยกตามคุณภาพ', isCritical: false, maxPoints: 3 },
    // 7. Storage (จัดเก็บ) — GACP-PRD §6.7
    { itemCode: '7.1', section: 'STORAGE', prompt: 'ห้องจัดเก็บแห้งและสะอาด', isCritical: true, maxPoints: 5 },
    { itemCode: '7.2', section: 'STORAGE', prompt: 'มีระบบควบคุมศัตรูพืชในที่จัดเก็บ', isCritical: false, maxPoints: 3 },
    // 8. Documentation (เอกสาร) — GACP-PRD §6.8
    { itemCode: '8.1', section: 'DOCUMENTATION', prompt: 'มีบันทึกการดำเนินงานครบถ้วน', isCritical: true, maxPoints: 5 },
    { itemCode: '8.2', section: 'DOCUMENTATION', prompt: 'เอกสารผ่านการตรวจสอบย้อนหลัง', isCritical: false, maxPoints: 3 },
    // 9. Personnel hygiene (สุขอนามัยบุคลากร) — GACP-PRD §6.9
    { itemCode: '9.1', section: 'PERSONNEL_HYGIENE', prompt: 'บุคลากรมีการฝึกอบรม', isCritical: true, maxPoints: 5 },
    { itemCode: '9.2', section: 'PERSONNEL_HYGIENE', prompt: 'ไม่มีการสูบบุหรี่ในแปลงปลูก', isCritical: false, maxPoints: 3 },
    // 10. Traceability (ตรวจสอบย้อนกลับ) — GACP-PRD §6.10
    { itemCode: '10.1', section: 'TRACEABILITY', prompt: 'รหัสติดตามล็อตผลิตชัดเจน', isCritical: true, maxPoints: 5 },
    { itemCode: '10.2', section: 'TRACEABILITY', prompt: 'มี QR หรือเลขอ้างอิงทุกชุดสินค้า', isCritical: false, maxPoints: 3 },
    // 11. Facilities (อาคารและสิ่งอำนวยความสะดวก) — GACP-PRD §6.11
    { itemCode: '11.1', section: 'FACILITIES', prompt: 'มีห้องน้ำและสุขาที่ถูกสุขลักษณะ', isCritical: false, maxPoints: 3 },
    { itemCode: '11.2', section: 'FACILITIES', prompt: 'จัดการของเสียอย่างเหมาะสม', isCritical: false, maxPoints: 3 },
    // 12. Training records (บันทึกฝึกอบรม) — GACP-PRD §6.12
    { itemCode: '12.1', section: 'TRAINING', prompt: 'มีบันทึกการฝึกอบรมประจำปี', isCritical: false, maxPoints: 3 },
]);

const TEMPLATE_VERSION = '2026-05';

// ── GPS / haversine ────────────────────────────────────────────────────────

/**
 * Compute great-circle distance between two GPS coordinate pairs in
 * metres. Pure function — no I/O, no logging, no allocations beyond the
 * trig scratch values. Same formula as the legacy farm-audit.js helper
 * but exported separately so the route layer + tests can call it
 * without going through the full verifyGpsAgainstFarm() path.
 *
 * @param {number} lat1
 * @param {number} lon1
 * @param {number} lat2
 * @param {number} lon2
 * @returns {number} metres
 */
function haversineDistanceMeters(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // earth radius in metres
    const toRad = (deg) => (deg * Math.PI) / 180;
    const phi1 = toRad(lat1);
    const phi2 = toRad(lat2);
    const dPhi = toRad(lat2 - lat1);
    const dLambda = toRad(lon2 - lon1);

    const a = Math.sin(dPhi / 2) * Math.sin(dPhi / 2) +
        Math.cos(phi1) * Math.cos(phi2) *
        Math.sin(dLambda / 2) * Math.sin(dLambda / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

/**
 * Verify the auditor's reported GPS against the farm registered on the
 * parent Application. Returns a result object the caller can decide on:
 *
 *   - withinTolerance: boolean — true if distanceMeters <= toleranceMeters.
 *   - distanceMeters : number  — haversine distance, or null when the
 *                                farm has no recorded coordinates (in
 *                                which case `unknownFarmLocation: true`).
 *   - farmLatitude   : number|null — the farm's registered latitude.
 *   - farmLongitude  : number|null — the farm's registered longitude.
 *
 * Caller responsibility: the route is expected to refuse a PASS decision
 * (or to require an explicit override) when `withinTolerance` is false.
 * This service does not auto-throw because GPS can legitimately drift
 * during inclement weather; the operator's judgment matters.
 *
 * @param {object} args
 * @param {string} args.auditId
 * @param {number} args.gpsLat
 * @param {number} args.gpsLng
 * @param {number} [args.toleranceMeters=DEFAULT_GPS_TOLERANCE_M]
 * @param {object} [args.prisma]    — injectable for tests
 * @returns {Promise<{ withinTolerance: boolean, distanceMeters: number|null,
 *                    farmLatitude: number|null, farmLongitude: number|null,
 *                    toleranceMeters: number, unknownFarmLocation: boolean }>}
 */
async function verifyGpsAgainstFarm(args) {
    if (!args || typeof args !== 'object') {
        throw new TypeError('verifyGpsAgainstFarm: args required');
    }
    const {
        auditId,
        gpsLat,
        gpsLng,
        toleranceMeters = DEFAULT_GPS_TOLERANCE_M,
        prisma = _resolvePrisma(),
    } = args;

    if (!auditId) {
        throw new TypeError('verifyGpsAgainstFarm: auditId required');
    }
    // Task 10 (carried Ruling 8, fixes B8): the route does `Number(req.query.lat)` —
    // a missing/malformed query param yields NaN, and `typeof NaN === 'number'` is
    // true, so the old `typeof` guard let NaN sail through to the haversine calc
    // and silently returned `distanceMeters: NaN` instead of rejecting. Same fix
    // as startInspection (Task 8) and uploadPhoto (Task 9).
    if (!Number.isFinite(gpsLat) || !Number.isFinite(gpsLng)) {
        throw new TypeError('verifyGpsAgainstFarm: gpsLat + gpsLng (finite numbers) required');
    }
    if (!prisma) {
        throw new Error('verifyGpsAgainstFarm: prisma client unavailable');
    }

    // Resolve the audit -> application -> farm coordinates.  We accept two
    // shapes the parent stack uses today:
    //   (a) AuditChecklist row (system.prisma model) whose applicationId
    //       points to an Application whose formData.locationData.farmId
    //       resolves to a Farm.
    //   (b) Test-injected stub where audit.farm.{latitude,longitude} is
    //       returned directly.
    const audit = await prisma.auditChecklist.findFirst({
        where: { id: auditId },
        include: {
            application: {
                select: {
                    id: true,
                    applicationNumber: true,
                    formData: true,
                },
            },
        },
    });
    if (!audit) {
        // Carry a code so the route maps not-found → 404 (mirrors the sibling
        // /start, /checklist, /decision handlers); without it the route's catch
        // blanket-500'd a missing auditId.
        const err = new Error(`verifyGpsAgainstFarm: audit ${auditId} not found`);
        err.code = 'AUDIT_NOT_FOUND';
        throw err;
    }

    let farmLatitude = null;
    let farmLongitude = null;
    let farmId = null;

    const formData = audit.application?.formData;
    if (formData && typeof formData === 'object') {
        const loc = formData.locationData || formData.location || {};
        farmId = loc.farmId || null;
        if (typeof loc.latitude === 'number') {farmLatitude = loc.latitude;}
        if (typeof loc.longitude === 'number') {farmLongitude = loc.longitude;}
    }

    // If we don't yet have coordinates from formData, fall back to a
    // Farm.findUnique (tests inject this via the prisma stub).
    if ((farmLatitude === null || farmLongitude === null) && farmId && prisma.farm?.findUnique) {
        const farm = await prisma.farm.findUnique({
            where: { id: farmId },
            select: { latitude: true, longitude: true },
        });
        if (farm) {
            farmLatitude = typeof farm.latitude === 'number' ? farm.latitude : farmLatitude;
            farmLongitude = typeof farm.longitude === 'number' ? farm.longitude : farmLongitude;
        }
    }

    if (farmLatitude === null || farmLongitude === null) {
        return {
            withinTolerance: false,
            distanceMeters: null,
            farmLatitude,
            farmLongitude,
            toleranceMeters,
            unknownFarmLocation: true,
        };
    }

    const distanceMeters = haversineDistanceMeters(
        gpsLat, gpsLng, farmLatitude, farmLongitude,
    );

    return {
        withinTolerance: distanceMeters <= toleranceMeters,
        distanceMeters,
        farmLatitude,
        farmLongitude,
        toleranceMeters,
        unknownFarmLocation: false,
    };
}

// ── Audit lifecycle helpers ────────────────────────────────────────────────

function _ensureAuditStatusEligible(audit, expectedStatuses) {
    if (!audit) {
        const err = new Error('Audit not found');
        err.code = 'AUDIT_NOT_FOUND';
        throw err;
    }
    if (!expectedStatuses.includes(audit.status)) {
        const err = new Error(
            `Audit ${audit.id} status is ${audit.status}; expected one of ${expectedStatuses.join(', ')}`,
        );
        err.code = 'AUDIT_STATUS_INVALID';
        throw err;
    }
}

function _ensureAuditorMatches(audit, auditorId) {
    if (audit.auditorId && auditorId && audit.auditorId !== auditorId) {
        const err = new Error(
            `Audit ${audit.id} is assigned to a different auditor`,
        );
        err.code = 'AUDIT_AUDITOR_MISMATCH';
        throw err;
    }
}

/**
 * Compute SHA-256 hex digest over a Buffer. Same algorithm as
 * services/slip-hash-integrity.js so the tamper-detection guarantee
 * lines up across photo evidence and slip evidence.
 *
 * @param {Buffer} buffer
 * @returns {string} 64-char lowercase hex digest
 */
function computePhotoHash(buffer) {
    if (!Buffer.isBuffer(buffer)) {
        throw new TypeError('computePhotoHash: Buffer required');
    }
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

// ── Photo provenance: place, time, appearance ──────────────────────────────
//
// Counting DISTINCT fileHash answers "are these different files?", which is not
// the question. One photograph re-saved at four JPEG qualities plus one byte
// flip is five different files and one piece of evidence — and re-encoding
// strips EXIF, so the copies arrive looking cleaner than the original.
//
// The industry does not answer this with duplicate detection, and cannot: an
// auditor photographing the same shed twice from the same doorway legitimately
// produces near-identical frames, so a threshold tight enough to catch reuse
// also catches honest work, while anyone actually trying just changes the
// angle. The answer is provenance — bind the capture to a place and a time,
// record what the frame looks like, and put all three in front of a human.
//
// EVERY function below RECORDS. None of them refuses an upload, none of them is
// read by onsite-evidence-gate.js, and none of them may become a gate later
// without the operator deciding to strand the auditor whose farm coordinates
// are wrong, whose farm is bigger than any tolerance, or who is standing in a
// greenhouse. They also swallow their own failures: capturing evidence must
// never fail because reading metadata about it did.

/**
 * Algorithm tag stored beside every perceptual hash. Two hashes are only
 * comparable when this string matches on both — a Hamming distance across two
 * different algorithms is noise wearing the shape of a number.
 */
const PERCEPTUAL_HASH_ALGORITHM = 'dhash-64-v1';

/** Lazy so a deployment whose native `sharp` binding is broken can still load
 *  this module and still accept photographs — see capturePhotoProvenance. */
let _perceptualHashModule = null;
function _resolvePerceptualHash() {
    if (_perceptualHashModule === null) {
        try {
            _perceptualHashModule = require('./crypto/perceptual-hash');
        } catch (_e) {
            _perceptualHashModule = false;
        }
    }
    return _perceptualHashModule || null;
}

/** Same lazy treatment: utils/working-days pulls in the holiday tables, and a
 *  photograph must not fail to upload because a calendar module moved. */
let _zonedParts = null;
function _resolveGetZonedParts() {
    if (_zonedParts === null) {
        try {
            _zonedParts = require('../utils/working-days').getZonedParts;
        } catch (_e) {
            _zonedParts = false;
        }
    }
    return _zonedParts || null;
}

/**
 * The Asia/Bangkok calendar day that `date` falls in, as a half-open
 * [start, end) pair of instants.
 *
 * ICT is UTC+7 with no daylight saving, so the offset can be written literally
 * once the DAY is known. The day comes from utils/working-days.getZonedParts —
 * the repo's single Intl-based zoning helper — rather than from `getDate()`,
 * which is UTC-relative and would file an 06:30 ICT photograph under the
 * previous day.
 *
 * @returns {{ start: Date, end: Date }|null} null when the zoning helper is
 *   unavailable, which the caller reports as "no window" rather than guessing.
 */
function _bangkokDayWindow(date) {
    const getZonedParts = _resolveGetZonedParts();
    if (!getZonedParts) { return null; }
    const { isoDate } = getZonedParts(date, 'Asia/Bangkok');
    const start = new Date(`${isoDate}T00:00:00.000+07:00`);
    if (!Number.isFinite(start.getTime())) { return null; }
    return { start, end: new Date(start.getTime() + (24 * 60 * 60 * 1000)) };
}

/**
 * The window during which a photograph of THIS visit could have been taken.
 *
 * Three clocks exist and they are not equally good, so they are tried in order
 * of how much each one actually observed:
 *
 *   1. INSPECTION_START — the GpsVerificationLog row that startInspection
 *      writes when the auditor checks in. The only OBSERVED event of the three:
 *      someone was at a device, at a coordinate, at a moment. The window runs
 *      from that instant to `audit.submittedAt` when the decision has already
 *      gone in, and otherwise to the moment these bytes arrived — not to an
 *      invented duration. A photograph cannot postdate its own upload, so that
 *      end is a physical bound, not a business rule somebody would have to
 *      defend. It follows that an open inspection accepts anything captured
 *      since check-in, which is correct and is also the limit of this layer:
 *      what it catches is the photograph that predates the visit.
 *   2. SCHEDULED_DATE — Application.scheduledDate, taken as its whole calendar
 *      day in Asia/Bangkok. Weaker, because it is an intention rather than an
 *      observation and a visit really can be rearranged on the morning. It
 *      still catches the photograph taken three weeks earlier.
 *   3. NONE — neither exists. Say so. Falling back to "today" would make every
 *      upload trivially inside a window that was never established, which is
 *      the exact failure this whole change exists to stop.
 *
 * AuditChecklist carries no scheduled date of its own (prisma/schema/
 * system.prisma:295-350 — createdAt, status, submittedAt and nothing else),
 * which is why the planned date is read off the parent Application.
 *
 * @returns {Promise<{ source: 'INSPECTION_START'|'SCHEDULED_DATE'|'NONE',
 *                     start: Date|null, end: Date|null }>}
 */
async function _resolveCaptureWindow({ auditId, audit, prisma, receivedAt }) {
    if (typeof prisma?.gpsVerificationLog?.findFirst === 'function') {
        try {
            const startRow = await prisma.gpsVerificationLog.findFirst({
                where: { entityType: 'AUDIT_INSPECTION_START', entityId: auditId },
                orderBy: { verifiedAt: 'asc' },
                select: { verifiedAt: true },
            });
            const startedAt = startRow?.verifiedAt ? new Date(startRow.verifiedAt) : null;
            if (startedAt && Number.isFinite(startedAt.getTime())) {
                const submitted = audit?.submittedAt ? new Date(audit.submittedAt) : null;
                const rawEnd = (submitted && Number.isFinite(submitted.getTime()))
                    ? submitted
                    : receivedAt;
                // A submittedAt earlier than the check-in is corrupt data, not a
                // window. Collapsing to [start, start] keeps the comparison
                // meaningful instead of producing a negative-length window in
                // which nothing could ever be INSIDE.
                const end = rawEnd.getTime() < startedAt.getTime() ? startedAt : rawEnd;
                return { source: 'INSPECTION_START', start: startedAt, end };
            }
        } catch (_e) { /* fall through to the planned date */ }
    }

    if (audit?.applicationId && typeof prisma?.application?.findUnique === 'function') {
        try {
            const application = await prisma.application.findUnique({
                where: { id: audit.applicationId },
                select: { scheduledDate: true },
            });
            const scheduled = application?.scheduledDate ? new Date(application.scheduledDate) : null;
            if (scheduled && Number.isFinite(scheduled.getTime())) {
                const day = _bangkokDayWindow(scheduled);
                if (day) { return { source: 'SCHEDULED_DATE', start: day.start, end: day.end }; }
            }
        } catch (_e) { /* fall through to NONE */ }
    }

    return { source: 'NONE', start: null, end: null };
}

/**
 * Where `capturedAt` sits relative to a window.
 *
 * The offset is signed on purpose. A positive number — captured after the
 * window closed — is usually a slow upload or a skewed device clock. A NEGATIVE
 * number is the one a reviewer needs to see, because it says the photograph
 * existed before the auditor arrived.
 *
 * @returns {{ status: 'INSIDE'|'OUTSIDE'|'WINDOW_UNKNOWN'|'CAPTURE_TIME_UNKNOWN',
 *             offsetSec: number|null }}
 */
function _classifyCaptureWindow(capturedAt, window) {
    if (!(capturedAt instanceof Date) || !Number.isFinite(capturedAt.getTime())) {
        return { status: 'CAPTURE_TIME_UNKNOWN', offsetSec: null };
    }
    if (!window || window.source === 'NONE' || !window.start || !window.end) {
        return { status: 'WINDOW_UNKNOWN', offsetSec: null };
    }
    const t = capturedAt.getTime();
    if (t < window.start.getTime()) {
        return { status: 'OUTSIDE', offsetSec: Math.round((t - window.start.getTime()) / 1000) };
    }
    if (t > window.end.getTime()) {
        return { status: 'OUTSIDE', offsetSec: Math.round((t - window.end.getTime()) / 1000) };
    }
    return { status: 'INSIDE', offsetSec: 0 };
}

/**
 * Compute everything that will let a reviewer decide, later, whether this
 * photograph belongs to this visit.
 *
 * Returns ONLY the new provenance columns, so the caller spreads them into its
 * existing create payload and this function stays ignorant of the rest of the
 * row.
 *
 * Contract: it never throws. Each layer is guarded on its own, and a layer that
 * cannot answer says so in its own status column instead of taking the upload
 * down with it. An auditor standing in a field on one bar of signal must not
 * lose a photograph because a metadata lookup failed.
 *
 * @param {object} args
 * @param {string} args.auditId
 * @param {object} args.audit         — the already-fetched AuditChecklist row
 * @param {number} args.gpsLat        — THIS photograph's coordinates, not the
 *                                      check-in's
 * @param {number} args.gpsLng
 * @param {Date}   args.capturedAt    — as it will be stored on the row
 * @param {boolean} args.capturedAtSupplied — did a timestamp arrive with the
 *                                      request, or is capturedAt our own clock?
 * @param {Buffer} args.fileBuffer
 * @param {Date}   args.receivedAt
 * @param {object} args.prisma
 * @returns {Promise<object>} the provenance columns, ready to spread
 */
async function capturePhotoProvenance(args) {
    const {
        auditId, audit, gpsLat, gpsLng, capturedAt, capturedAtSupplied,
        fileBuffer, receivedAt, prisma,
    } = args || {};

    // ── Layer A: place ────────────────────────────────────────────────────
    // Reuses verifyGpsAgainstFarm rather than re-deriving the farm's
    // coordinates, so the per-photo distance and the check-in distance can
    // never disagree about where the farm is. Its `withinTolerance` flag is
    // deliberately NOT stored: that flag is also false when the farm has no
    // coordinates at all, so persisting it would turn "we do not know where the
    // farm is" into "the auditor was not at the farm".
    let farmDistanceMeters = null;
    let farmDistanceStatus = 'UNAVAILABLE';
    try {
        const gps = await verifyGpsAgainstFarm({ auditId, gpsLat, gpsLng, prisma });
        if (gps.unknownFarmLocation) {
            farmDistanceStatus = 'FARM_LOCATION_UNKNOWN';
        } else if (Number.isFinite(gps.distanceMeters)) {
            farmDistanceMeters = gps.distanceMeters;
            farmDistanceStatus = 'MEASURED';
        }
    } catch (_e) {
        // Stays UNAVAILABLE, which reads as "nobody measured this" — exactly
        // what happened.
    }

    // ── Layer B: time ─────────────────────────────────────────────────────
    let captureWindowSource = 'NONE';
    let captureWindowStatus = 'WINDOW_UNKNOWN';
    let captureWindowOffsetSec = null;
    try {
        const window = await _resolveCaptureWindow({ auditId, audit, prisma, receivedAt });
        captureWindowSource = window.source;
        const verdict = _classifyCaptureWindow(capturedAt, window);
        captureWindowStatus = verdict.status;
        captureWindowOffsetSec = verdict.offsetSec;
    } catch (_e) { /* stays NONE / WINDOW_UNKNOWN */ }

    // ── Layer C: appearance ───────────────────────────────────────────────
    // Undecodable bytes are already refused upstream by the route's content
    // guard (services/upload-content-guard.inspectOnsitePhotoUpload), so a
    // throw here means the decoder is unavailable, not that the file is junk.
    // Either way the columns stay NULL and the photograph is still stored: this
    // layer flags near-duplicates for a human and authorises nothing.
    let perceptualHashHex = null;
    let perceptualHashAlgo = null;
    const phashModule = _resolvePerceptualHash();
    if (phashModule && Buffer.isBuffer(fileBuffer)) {
        try {
            perceptualHashHex = await phashModule.perceptualHash(fileBuffer);
            perceptualHashAlgo = PERCEPTUAL_HASH_ALGORITHM;
        } catch (e) {
            perceptualHashHex = null;
            perceptualHashAlgo = null;
            _resolveLogger().warn('[audit-onsite] perceptual hash unavailable for photo', {
                auditId, error: e.message,
            });
        }
    }

    return {
        farmDistanceMeters,
        farmDistanceStatus,
        // The weakest TRUE statement about where this timestamp came from. The
        // route substitutes its own clock when the client sends none, and no
        // EXIF parser exists in this tree, so "supplied" never means "shutter".
        captureTimeSource: capturedAtSupplied ? 'CALLER_SUPPLIED_UNVERIFIED' : 'SERVER_RECEIPT',
        captureWindowSource,
        captureWindowStatus,
        captureWindowOffsetSec,
        perceptualHash: perceptualHashHex,
        perceptualHashAlgo,
    };
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Open the onsite inspection. Validates that the audit exists, is
 * assigned to the auditor, and is currently in IN_PROGRESS-eligible
 * status. Writes a GpsVerificationLog "start" row so the audit chain
 * can prove when (and from where) the auditor checked in, and returns
 * the checklist template the auditor will fill in.
 *
 * Pre-conditions enforced:
 *   - audit row exists
 *   - audit.auditorId matches the caller (or is null = unclaimed)
 *   - audit.status === 'IN_PROGRESS' (the workflow target after
 *     AUDIT_CONFIRMED on the parent Application maps to IN_PROGRESS on
 *     the audit row)
 *
 * @param {object} args
 * @param {string} args.auditId
 * @param {string} args.auditorId
 * @param {number} args.gpsLat
 * @param {number} args.gpsLng
 * @param {number} [args.gpsAccuracy]
 * @param {object} [args.prisma]
 * @returns {Promise<{ audit: object, gpsLog: object, checklistTemplate: object[],
 *                    templateVersion: string }>}
 */
async function startInspection(args) {
    if (!args || typeof args !== 'object') {
        throw new TypeError('startInspection: args required');
    }
    const {
        auditId,
        auditorId,
        gpsLat,
        gpsLng,
        gpsAccuracy = null,
        prisma = _resolvePrisma(),
    } = args;

    if (!auditId) {throw new TypeError('startInspection: auditId required');}
    if (!auditorId) {throw new TypeError('startInspection: auditorId required');}
    if (!Number.isFinite(gpsLat) || !Number.isFinite(gpsLng)) {
        throw new TypeError('startInspection: gpsLat + gpsLng (finite numbers) required');
    }
    if (!prisma) {throw new Error('startInspection: prisma client unavailable');}

    const audit = await prisma.auditChecklist.findFirst({ where: { id: auditId } });

    // The auditor opens an inspection that is either still IN_PROGRESS
    // (the canonical state after the scheduler confirms) or COMPLETED
    // (re-entering to amend; rare but the UI supports it). SUBMITTED
    // means the decision has already gone in and is not editable.
    _ensureAuditStatusEligible(audit, ['IN_PROGRESS']);
    _ensureAuditorMatches(audit, auditorId);

    // Pilot-descope guard: the onsite GPS/photo models (GpsVerificationLog,
    // FarmAuditPhoto, FarmAuditChecklistItem) are NOT provisioned in this
    // deployment (no Prisma model/table). Referencing them threw and blocked the
    // entire onsite flow — so the inspection couldn't even open and a PASS could
    // never transition AUDIT_CONFIRMED→AUDIT_PASSED. Guard every reference: the
    // inspection opens (gpsLog null), and submitDecision's evidence gates are
    // skipped, so the single-auditor cert auto-issue still works via this path.
    // When the 3 models + migration are added, these guards become no-ops.
    const gpsLog = (typeof prisma.gpsVerificationLog?.create === 'function')
        ? await prisma.gpsVerificationLog.create({
            data: {
                entityType: 'AUDIT_INSPECTION_START',
                entityId: auditId,
                reportedLatitude: gpsLat,
                reportedLongitude: gpsLng,
                gpsAccuracy,
                verifiedBy: auditorId,
                verifiedAt: new Date(),
                verificationMethod: 'GPS_DEVICE',
                isVerified: false, // computed on read against the parent farm
                organizationId: audit.organizationId,
            },
        })
        : null;

    return {
        audit,
        gpsLog,
        checklistTemplate: CHECKLIST_TEMPLATE_2026,
        templateVersion: TEMPLATE_VERSION,
    };
}

/**
 * Persist one checklist item. Atomic write: the FarmAuditChecklists row
 * for (auditId, itemCode) is upserted, and any photoIds referenced are
 * linked back via FarmAuditPhotos.checklistItemId. If the item does not
 * exist in the canonical template we refuse the write — the route layer
 * should never call us with a free-text itemCode.
 *
 * @param {object} args
 * @param {string} args.auditId
 * @param {string} args.itemCode      — must match an entry in CHECKLIST_TEMPLATE_2026
 * @param {'PASS'|'FAIL'|'NA'} args.response
 * @param {string} [args.notes]
 * @param {string[]} [args.photoIds]  — FarmAuditPhoto.id values to link
 * @param {string} [args.actorId]
 * @param {object} [args.prisma]
 * @returns {Promise<object>} the persisted checklist row
 */
async function submitChecklistItem(args) {
    if (!args || typeof args !== 'object') {
        throw new TypeError('submitChecklistItem: args required');
    }
    const {
        auditId,
        itemCode,
        response,
        notes = null,
        photoIds = [],
        actorId = null,
        prisma = _resolvePrisma(),
    } = args;

    if (!auditId) {throw new TypeError('submitChecklistItem: auditId required');}
    if (!itemCode) {throw new TypeError('submitChecklistItem: itemCode required');}
    if (!response) {throw new TypeError('submitChecklistItem: response required');}
    if (!['PASS', 'FAIL', 'NA'].includes(response)) {
        throw new TypeError(`submitChecklistItem: response must be PASS|FAIL|NA (got ${response})`);
    }
    if (!prisma) {throw new Error('submitChecklistItem: prisma client unavailable');}

    const templateItem = CHECKLIST_TEMPLATE_2026.find((t) => t.itemCode === itemCode);
    if (!templateItem) {
        const err = new Error(`submitChecklistItem: unknown itemCode ${itemCode}`);
        err.code = 'CHECKLIST_ITEM_UNKNOWN';
        throw err;
    }

    const audit = await prisma.auditChecklist.findFirst({ where: { id: auditId } });
    _ensureAuditStatusEligible(audit, ['IN_PROGRESS']);
    // AUDIT-009: only the assigned auditor may record checklist items.
    _ensureAuditorMatches(audit, actorId);

    return prisma.$transaction(async (tx) => {
        const row = await tx.farmAuditChecklistItem.upsert({
            where: { auditId_itemCode: { auditId, itemCode } },
            create: {
                auditId,
                itemCode,
                section: templateItem.section,
                response,
                notes,
                isCritical: templateItem.isCritical,
                maxPoints: templateItem.maxPoints,
                recordedBy: actorId,
                recordedAt: new Date(),
            },
            update: {
                response,
                notes,
                recordedBy: actorId,
                recordedAt: new Date(),
            },
        });

        if (Array.isArray(photoIds) && photoIds.length > 0) {
            await tx.farmAuditPhoto.updateMany({
                where: { id: { in: photoIds }, auditId },
                data: { checklistItemId: row.id },
            });
        }

        return row;
    });
}

/**
 * Upload a photo for the onsite audit. Computes the SHA-256 hash over
 * the bytes (so future tamper checks compare expected vs actual hash),
 * stores the file via attachment-service, and writes a FarmAuditPhoto
 * row with the GPS + timestamp metadata required by GACP-PRD §6.2 (geo
 * traceability of evidence).
 *
 * @param {object} args
 * @param {string} args.auditId
 * @param {Buffer} args.fileBuffer
 * @param {string} args.fileName
 * @param {string} [args.mimeType='image/jpeg']
 * @param {number} args.gpsLat
 * @param {number} args.gpsLng
 * @param {Date|string} args.capturedAt
 * @param {string} [args.caption]
 * @param {string} [args.checklistItemCode] — checklist itemCode this photo was
 *   taken for; when a FarmAuditChecklistItem already exists for
 *   (auditId, itemCode), that row's id is linked onto the photo (best-effort,
 *   non-fatal — see Task 9 / B7).
 * @param {string} args.uploadedBy
 * @param {string} args.organizationId
 * @param {object} [args.prisma]
 * @param {object} [args.attachmentService]
 * @returns {Promise<{ photoId: string, fileHash: string, attachmentId: string,
 *                    url: string, photo: object, provenance: object }>}
 *   `provenance` carries the place/time/appearance measurements written onto
 *   the row. It is reported, never enforced — by the time a caller can read it
 *   the photograph is already stored.
 * @throws {Error} code DUPLICATE_PHOTO (statusCode 409) when these exact bytes
 *   are already recorded on this audit — the evidence minimum counts distinct
 *   photographs, so a re-upload would add a row that is not evidence.
 */
async function uploadPhoto(args) {
    if (!args || typeof args !== 'object') {
        throw new TypeError('uploadPhoto: args required');
    }
    const {
        auditId,
        fileBuffer,
        fileName,
        mimeType = 'image/jpeg',
        gpsLat,
        gpsLng,
        capturedAt,
        caption = null,
        checklistItemCode = null,
        uploadedBy,
        organizationId,
        prisma = _resolvePrisma(),
        attachmentService = _resolveAttachmentService(),
    } = args;

    if (!auditId) {throw new TypeError('uploadPhoto: auditId required');}
    if (!Buffer.isBuffer(fileBuffer)) {
        throw new TypeError('uploadPhoto: fileBuffer (Buffer) required');
    }
    if (!fileName) {throw new TypeError('uploadPhoto: fileName required');}
    if (!Number.isFinite(gpsLat) || !Number.isFinite(gpsLng)) {
        // A photograph without a position is a CLIENT input problem, and the auditor is
        // standing in a field with one hand on a phone: they need to be told to allow
        // location, not shown "server error". This used to be a bare TypeError, which the
        // route could only map to HTTP 500 ONSITE_PHOTO_FAILED — and the pressed walk on
        // 2026-08-27 hit exactly that on every photograph of a RESUMED visit, because the
        // field app only acquires a GPS fix when the start button is pressed and a resume
        // skips the start. The 500 hid a real defect behind a generic failure.
        const err = new TypeError(
            'ยังไม่มีตำแหน่งของรูปนี้ คุณต้องอนุญาตให้แอปเข้าถึงตำแหน่งก่อน แล้วลองแนบรูปอีกครั้ง '
            + '(uploadPhoto: gpsLat + gpsLng required)',
        );
        err.code = 'PHOTO_GPS_REQUIRED';
        err.statusCode = 400;
        throw err;
    }
    if (!uploadedBy) {throw new TypeError('uploadPhoto: uploadedBy required');}
    if (!organizationId) {throw new TypeError('uploadPhoto: organizationId required');}
    if (!prisma) {throw new Error('uploadPhoto: prisma client unavailable');}

    // AUDIT-009: only the assigned auditor may upload photo evidence — fetch the
    // audit + enforce ownership BEFORE the file is stored (this path had no audit
    // lookup at all, so a different auditor could attach photos to any audit).
    //
    // Ruling 6b (Task 9): a not-found audit used to SKIP the ownership check
    // below (`if (audit) { ... }`) and fall through to attach+create against a
    // non-existent auditId — an FK violation on real Postgres, masked only
    // because this model wasn't provisioned when that guard was written.
    // Reject up front, before any write.
    const audit = await prisma.auditChecklist.findFirst({ where: { id: auditId } });
    if (!audit) {
        const err = new Error(`uploadPhoto: audit ${auditId} not found`);
        err.code = 'NO_ONSITE_AUDIT';
        err.statusCode = 404;
        throw err;
    }
    _ensureAuditorMatches(audit, uploadedBy);

    const fileHash = computePhotoHash(fileBuffer);

    // The moment the bytes landed. Not the shutter, and never presented as it:
    // it is the upper bound on when this photograph could have been taken, and
    // that is the only claim it can support.
    const receivedAt = new Date();
    const capturedAtSupplied = Boolean(capturedAt);
    const capturedAtValue = capturedAtSupplied ? new Date(capturedAt) : receivedAt;

    // Evidence-integrity fix (2026-08-26): refuse the same bytes twice on one
    // audit. onsite-evidence-gate now counts DISTINCT fileHash, so a re-upload
    // of an existing photo can never count toward the minimum — writing the row
    // anyway would leave the auditor believing they had captured evidence they
    // do not have. Refusing here turns that into feedback at the moment it
    // happens; the message is written for a double-tap on the shutter, which is
    // what a duplicate almost always is, not for a fraud attempt.
    //
    // Scope is (auditId, fileHash) and deliberately NOT
    // (auditId, checklistItemId, fileHash): FarmAuditPhoto.checklistItemId is a
    // single nullable FK, so one photo row already belongs to at most one
    // checklist item, and GACP-PRD §6.5 asks for a photograph OF each section —
    // one image of one place cannot be evidence of two. When a photo genuinely
    // applies to another item the answer is to LINK the existing row
    // (submitChecklistItem's photoIds), not to store the bytes a second time.
    //
    // Checked BEFORE attachmentService.attach so a duplicate leaves no stored
    // file and no orphan Attachment row behind. `mode: 'insensitive'` matches
    // the gate's canonicalisation (computePhotoHash emits lower-case hex, but a
    // row written in upper case is still the same photograph). The typeof guard
    // mirrors the pilot-descope guards below: a delegate without findFirst is a
    // stub, never a deployment, and the gate remains the authority on issuance.
    if (typeof prisma.farmAuditPhoto?.findFirst === 'function') {
        const duplicate = await prisma.farmAuditPhoto.findFirst({
            where: { auditId, fileHash: { equals: fileHash, mode: 'insensitive' } },
            select: { id: true },
        });
        if (duplicate) {
            // The English tail is not decoration: shared/api-response.js
            // safeErrorMessage() replaces any message that carries no
            // known-safe English phrase with a generic English fallback, which
            // would swallow the Thai sentence before it reached the field app.
            const err = new Error(
                'รูปนี้ถูกอัปโหลดไว้แล้วในการตรวจครั้งนี้ คุณไม่ต้องอัปโหลดซ้ำ หากต้องการหลักฐานเพิ่ม กรุณาถ่ายรูปใหม่ (photo already exists)',
            );
            err.code = 'DUPLICATE_PHOTO';
            err.statusCode = 409;
            err.existingPhotoId = duplicate.id;
            throw err;
        }
    }

    // Persist the file. The attachment-service is the single boundary for
    // file storage; we let it pick the storage backend (filesystem / S3).
    const attachment = await attachmentService.attach({
        prisma,
        resModel: 'FarmAuditPhoto',
        resId: auditId,
        field: 'photo',
        fileName,
        fileUrl: `/uploads/audits/${auditId}/${Date.now()}-${fileName}`,
        fileSize: fileBuffer.length,
        mimeType,
        fileHash,
        uploadedBy,
        organizationId,
    });

    if (typeof prisma.farmAuditPhoto?.create !== 'function') {
        // Pilot-descope: onsite photo-evidence model not provisioned. Fail with a
        // clean 501 instead of a raw TypeError (this path is unused in the pilot).
        const e = new Error('Onsite photo capture is not available in this deployment');
        e.code = 'ONSITE_NOT_AVAILABLE';
        e.statusCode = 501;
        throw e;
    }
    // Provenance is computed BEFORE the create so it lands in the same row as
    // the bytes it describes — a second UPDATE could fail on its own and leave
    // a photograph whose provenance columns are NULL, which is the shape that
    // reads as "not recorded" and would be indistinguishable from an old row.
    // capturePhotoProvenance never throws; a layer that cannot answer writes its
    // own "we do not know" instead of losing the photograph.
    const provenance = await capturePhotoProvenance({
        auditId,
        audit,
        gpsLat,
        gpsLng,
        capturedAt: capturedAtValue,
        capturedAtSupplied,
        fileBuffer,
        receivedAt,
        prisma,
    });

    const photo = await prisma.farmAuditPhoto.create({
        data: {
            auditId,
            attachmentId: attachment.id,
            fileHash,
            gpsLatitude: gpsLat,
            gpsLongitude: gpsLng,
            capturedAt: capturedAtValue,
            caption,
            uploadedBy,
            organizationId,
            ...provenance,
        },
    });

    // Best-effort link to the checklist item this photo was taken for, IF that
    // item row already exists. The primary/authoritative linkage remains
    // submitChecklistItem's updateMany(photoIds) — this just upgrades the case
    // where the checklist item was saved before the photo.
    if (checklistItemCode && typeof prisma.farmAuditChecklistItem?.findFirst === 'function') {
        try {
            const item = await prisma.farmAuditChecklistItem.findFirst({
                where: { auditId, itemCode: checklistItemCode },
                select: { id: true },
            });
            if (item) {
                await prisma.farmAuditPhoto.update({ where: { id: photo.id }, data: { checklistItemId: item.id } });
            }
        } catch (_e) { /* non-fatal — the checklist submit will link it */ }
    }

    return {
        photoId: photo.id,
        fileHash,
        attachmentId: attachment.id,
        url: attachment.fileUrl,
        photo,
        // Returned so a caller can echo the measurement back without a second
        // read. It is information, not a verdict: no field on it authorises or
        // refuses anything, which is why the upload has already succeeded by
        // the time anyone can look at it.
        provenance,
    };
}

/**
 * Read one audit's photographs back as provenance a human can judge.
 *
 * This is the canonical READER of the columns capturePhotoProvenance writes,
 * and it exists because of what NULL means in them. NULL means the fact was
 * never established — the row predates the provenance migration, or the
 * measurement could not run. Rendered as a blank cell beside rows reading
 * MEASURED and INSIDE, a NULL reads as agreement, which is the precise way a
 * missing check turns into a passed one. So every NULL here becomes an explicit
 * NOT_RECORDED flag with the same weight as any other finding, and the counts
 * at the end say how much of this audit was never measured at all.
 *
 * It DECIDES NOTHING. Every field is a measurement and every flag is an
 * invitation to look; onsite-evidence-gate.js does not call this function and
 * must not, for the reason stated wherever these three layers appear: gate on
 * distance and the auditor whose farm has wrong coordinates cannot work, while
 * the one person willing to cheat edits the coordinates he sends.
 *
 * @param {object} args
 * @param {string} args.auditId
 * @param {object} [args.prisma]
 * @param {number} [args.toleranceMeters=DEFAULT_GPS_TOLERANCE_M] — compared at
 *   READ time, not stored, so a later change of tolerance re-reads old rows
 *   correctly instead of freezing yesterday's judgment into the record.
 * @param {number} [args.nearDuplicateMaxDistance] — defaults to the perceptual
 *   hash module's own PROVISIONAL threshold; read that module's header before
 *   trusting the number, because this repo owns no real farm photographs to
 *   calibrate it against.
 * @returns {Promise<object>}
 * @throws {Error} code ONSITE_NOT_AVAILABLE when the photo model is not
 *   provisioned — refusing loudly, because returning an empty list would read
 *   as "this audit has nothing to worry about".
 */
async function reviewPhotoProvenance(args) {
    if (!args || typeof args !== 'object') {
        throw new TypeError('reviewPhotoProvenance: args required');
    }
    const {
        auditId,
        prisma = _resolvePrisma(),
        toleranceMeters = DEFAULT_GPS_TOLERANCE_M,
        nearDuplicateMaxDistance,
    } = args;

    if (!auditId) { throw new TypeError('reviewPhotoProvenance: auditId required'); }
    if (!prisma) { throw new Error('reviewPhotoProvenance: prisma client unavailable'); }
    if (typeof prisma.farmAuditPhoto?.findMany !== 'function') {
        const e = new Error('Onsite photo evidence is not available in this deployment');
        e.code = 'ONSITE_NOT_AVAILABLE';
        e.statusCode = 501;
        throw e;
    }

    const rows = await prisma.farmAuditPhoto.findMany({
        where: { auditId },
        orderBy: { createdAt: 'asc' },
        select: {
            id: true, createdAt: true, capturedAt: true, uploadedBy: true,
            fileHash: true, gpsLatitude: true, gpsLongitude: true,
            farmDistanceMeters: true, farmDistanceStatus: true,
            captureTimeSource: true, captureWindowSource: true,
            captureWindowStatus: true, captureWindowOffsetSec: true,
            perceptualHash: true, perceptualHashAlgo: true,
        },
    });

    const phashModule = _resolvePerceptualHash();
    const maxDistance = Number.isFinite(nearDuplicateMaxDistance)
        ? nearDuplicateMaxDistance
        : phashModule?.NEAR_DUPLICATE_MAX_DISTANCE ?? null;

    const photos = rows.map((row) => {
        const flags = [];

        // ── place ────────────────────────────────────────────────────────
        let beyondTolerance = null;
        if (!row.farmDistanceStatus) {
            flags.push('PLACE_NOT_RECORDED');
        } else if (row.farmDistanceStatus === 'FARM_LOCATION_UNKNOWN') {
            // Deliberately its own flag, not "far away": the farm has no
            // coordinates on record. That is a gap in OUR data and reads on a
            // reviewer's screen as a job for whoever maintains the farm
            // register, never as a finding against the auditor.
            flags.push('PLACE_FARM_LOCATION_UNKNOWN');
        } else if (row.farmDistanceStatus === 'MEASURED' && Number.isFinite(row.farmDistanceMeters)) {
            beyondTolerance = row.farmDistanceMeters > toleranceMeters;
            if (beyondTolerance) { flags.push('PLACE_BEYOND_TOLERANCE'); }
        } else {
            flags.push('PLACE_NOT_RECORDED');
        }

        // ── time ─────────────────────────────────────────────────────────
        if (!row.captureWindowStatus) {
            flags.push('TIME_NOT_RECORDED');
        } else if (row.captureWindowStatus === 'OUTSIDE') {
            flags.push('TIME_OUTSIDE_WINDOW');
        } else if (row.captureWindowStatus !== 'INSIDE') {
            // WINDOW_UNKNOWN / CAPTURE_TIME_UNKNOWN — the comparison was
            // attempted and could not be made. Distinct from NOT_RECORDED
            // because the reason is knowable and fixable.
            flags.push(`TIME_${row.captureWindowStatus}`);
        }

        // ── appearance ───────────────────────────────────────────────────
        if (!row.perceptualHash) { flags.push('APPEARANCE_NOT_RECORDED'); }

        return {
            photoId: row.id,
            uploadedBy: row.uploadedBy,
            uploadedAt: row.createdAt,
            capturedAt: row.capturedAt,
            fileHash: row.fileHash,
            gps: { latitude: row.gpsLatitude, longitude: row.gpsLongitude },
            place: {
                status: row.farmDistanceStatus || 'NOT_RECORDED',
                distanceMeters: row.farmDistanceMeters ?? null,
                toleranceMeters,
                beyondTolerance,
            },
            time: {
                // "supplied" is not "shutter" — see the column comment. Passed
                // through verbatim so a screen can say so out loud.
                capturedAtSource: row.captureTimeSource || 'NOT_RECORDED',
                windowSource: row.captureWindowSource || 'NOT_RECORDED',
                status: row.captureWindowStatus || 'NOT_RECORDED',
                offsetSeconds: row.captureWindowOffsetSec ?? null,
            },
            appearance: {
                perceptualHash: row.perceptualHash || null,
                algorithm: row.perceptualHashAlgo || null,
            },
            flags,
        };
    });

    // ── near duplicates ──────────────────────────────────────────────────
    // Every pair, because N is the number of photographs in one farm visit and
    // an index would not help anyway: near-duplicates differ in their bits by
    // definition, which is the whole reason a perceptual hash is not looked up
    // by equality. Pairs are only compared when BOTH rows name the same
    // algorithm — a Hamming distance across two different hash functions is
    // noise that would print as a number and be believed.
    const nearDuplicatePairs = [];
    if (phashModule && Number.isFinite(maxDistance)) {
        const hashed = photos
            .map((p, i) => ({ p, row: rows[i] }))
            .filter(({ row }) => row.perceptualHash && row.perceptualHashAlgo);
        for (let i = 0; i < hashed.length; i += 1) {
            for (let j = i + 1; j < hashed.length; j += 1) {
                const a = hashed[i];
                const b = hashed[j];
                if (a.row.perceptualHashAlgo !== b.row.perceptualHashAlgo) { continue; }
                let bits;
                try {
                    bits = phashModule.hammingDistance(a.row.perceptualHash, b.row.perceptualHash);
                } catch (_e) {
                    // A malformed stored hash is not a match and not a crash.
                    continue;
                }
                if (bits <= maxDistance) {
                    nearDuplicatePairs.push({
                        photoIds: [a.p.photoId, b.p.photoId],
                        distanceBits: bits,
                        // Same bytes twice cannot happen — uploadPhoto refuses a
                        // repeated fileHash — so an identical LOOK with different
                        // bytes is the re-encode, and worth saying plainly.
                        sameFileHash: a.row.fileHash === b.row.fileHash,
                        algorithm: a.row.perceptualHashAlgo,
                    });
                    if (!a.p.flags.includes('NEAR_DUPLICATE')) { a.p.flags.push('NEAR_DUPLICATE'); }
                    if (!b.p.flags.includes('NEAR_DUPLICATE')) { b.p.flags.push('NEAR_DUPLICATE'); }
                }
            }
        }
    }

    const count = (flag) => photos.filter((p) => p.flags.includes(flag)).length;

    return {
        auditId,
        photoCount: photos.length,
        photos,
        nearDuplicatePairs,
        // Repeated in the output so a report never has to guess which threshold
        // produced these pairs, and so a recalibration is visible in the record.
        nearDuplicateMaxDistance: Number.isFinite(maxDistance) ? maxDistance : null,
        toleranceMeters,
        // The headline a reviewer needs first: how much of this audit was never
        // measured. A zero here is meaningful; a missing number is not.
        notRecorded: {
            place: count('PLACE_NOT_RECORDED'),
            time: count('TIME_NOT_RECORDED'),
            appearance: count('APPEARANCE_NOT_RECORDED'),
        },
        needsAttention: photos.filter((p) => p.flags.length > 0).length,
    };
}

/**
 * Map decision -> target Application workflow state per the decision
 * matrix documented at the top of the file.
 *
 *   PASS         → AUDIT_PASSED
 *   FAIL         → CAR_PENDING   (Corrective Action Required loop)
 *   NEEDS_REVIEW → null          (stays in AUDIT_CONFIRMED; head-auditor review)
 *
 * @param {'PASS'|'FAIL'|'NEEDS_REVIEW'} decision
 * @returns {string|null}
 */
function _targetStateForDecision(decision) {
    if (decision === DECISIONS.PASS) {return 'AUDIT_PASSED';}
    if (decision === DECISIONS.FAIL) {return 'CAR_PENDING';}
    return null; // NEEDS_REVIEW — no transition
}

/**
 * Notify type per decision. The fanout layer routes IN_APP / EMAIL /
 * SMS independently; we just hand over the type + payload.
 */
function _notifyTypeForDecision(decision) {
    if (decision === DECISIONS.PASS) {return 'AUDIT_RESULT_PASSED';}
    if (decision === DECISIONS.FAIL) {return 'AUDIT_RESULT_CAR';}
    return 'AUDIT_RESULT_NEEDS_REVIEW';
}

/**
 * Submit the auditor's decision. Atomic transaction:
 *   1. Validate audit + checklist + photo minimums.
 *   2. Update the AuditChecklist row status/submittedAt/actor (the row has no
 *      formData column; decision details persist on the parent Application).
 *   3. If PASS  → transition parent Application AUDIT_CONFIRMED → AUDIT_PASSED.
 *      If FAIL  → transition parent Application AUDIT_CONFIRMED → CAR_PENDING,
 *                 recording auditResult/auditNotes on the Application via
 *                 additionalData (FAIL requires a non-empty summary — C2-02).
 *      If NEEDS_REVIEW → no parent transition; the audit row stays IN_PROGRESS
 *                 and the applicant/head-auditor are notified.
 *   4. Fan out a notification to the applicant.
 *
 * @param {object} args
 * @param {string} args.auditId
 * @param {'PASS'|'FAIL'|'NEEDS_REVIEW'} args.decision
 * @param {string} [args.summary]
 * @param {string[]} [args.criticalFindings]
 * @param {string} args.actorId
 * @param {string} [args.actorRole='AUDITOR']
 * @param {number} [args.minPhotos=DEFAULT_MIN_PHOTOS]
 * @param {object} [args.prisma]
 * @param {object} [args.fanoutService]
 * @returns {Promise<{ audit: object, transition: object|null, notify: object|null }>}
 */
async function submitDecision(args) {
    if (!args || typeof args !== 'object') {
        throw new TypeError('submitDecision: args required');
    }
    const {
        auditId,
        decision,
        summary = null,
        criticalFindings = [],
        actorId,
        actorRole = 'AUDITOR',
        minPhotos = DEFAULT_MIN_PHOTOS,
        prisma = _resolvePrisma(),
        fanoutService = _resolveFanoutService(),
    } = args;

    if (!auditId) {throw new TypeError('submitDecision: auditId required');}
    if (!ALL_DECISIONS.includes(decision)) {
        throw new TypeError(
            `submitDecision: decision must be ${ALL_DECISIONS.join('|')} (got ${decision})`,
        );
    }
    if (!actorId) {throw new TypeError('submitDecision: actorId required');}
    if (!prisma) {throw new Error('submitDecision: prisma client unavailable');}

    // C2-02 (audit 2026-06-10): a FAIL decision transitions the application to
    // CAR_PENDING, which starts the applicant's 5-working-day corrective-action
    // clock. The canonical workflow REQUIRES a comment on any →CAR_PENDING
    // transition, but this path writes via writeApplicationStatus (edge+role only),
    // bypassing buildTransitionUpdate's REQUIRES_COMMENT gate — so enforce the
    // corrective-action summary here, otherwise the applicant gets a CAR with no
    // text describing what to fix.
    if (decision === DECISIONS.FAIL && !String(summary || '').trim()) {
        const err = new Error('submitDecision: summary (corrective-action notes) is required when decision is FAIL (CAR_PENDING)');
        err.code = 'CAR_COMMENT_REQUIRED';
        throw err;
    }

    const audit = await prisma.auditChecklist.findFirst({
        where: { id: auditId },
        include: {
            application: { select: { id: true, status: true, applicationNumber: true, healthId: true, formData: true, reviewerId: true, auditorId: true } },
        },
    });
    _ensureAuditStatusEligible(audit, ['IN_PROGRESS']);
    // AUDIT-009: only the assigned auditor may record the decision — mirror the
    // ownership gate startInspection already enforces (null auditorId = unclaimed passes).
    _ensureAuditorMatches(audit, actorId);
    // Separation of duties (operator ruling 2026-10-05): whoever read this application's
    // papers does not also decide its inspection.
    assertDecisionNotByReviewerAndInspector({
        actorId,
        reviewerId: audit.application && audit.application.reviewerId,
        auditorId: (audit.application && audit.application.auditorId) || audit.auditorId,
    });

    // GACP-PRD §6.4/§6.5 onsite evidence enforcement — a certificate must never
    // issue on unverifiable evidence, so this gate ONLY applies to PASS (a FAIL
    // goes to CAR_PENDING and needs no evidence) and is FAIL-CLOSED.
    //
    // cert-integrity fix (Phase A, 2026-08-16 → Phase A2, 2026-08-16): Phase A
    // replaced the old `typeof prisma.farmAuditPhoto?.count === 'function'`
    // skip-when-unprovisioned guard (FarmAuditPhoto/FarmAuditChecklistItem do
    // not exist in the Prisma schema, so a PASS minted a certificate with ZERO
    // photos/checklist items) with an inline fail-closed check. Phase A2
    // extracted that check into onsite-evidence-gate.js — the SAME function
    // certificate-service.generateCertificate now calls, since submitDecision
    // was only ONE of four paths that could reach a cert mint with no
    // evidence. See the change log for the verified-Critical writeup.
    if (decision === DECISIONS.PASS) {
        await assertOnsiteEvidenceSufficient({
            prisma,
            applicationId: audit.application.id,
            auditId,
            minPhotos,
        });

    }

    const targetState = _targetStateForDecision(decision);
    // CAR SLA clock: on FAIL→CAR_PENDING compute the 5-working-day (Thai-holiday-aware)
    // due date so it can be stamped into the parent formData (the applicant-facing CAR
    // enforcement reads formData.carDueAt) and a RevisionDeadline row seeded after the tx
    // (the auto-expiry cron). Supplying formData skips the writer's workflowState
    // auto-sync, so carFormData carries workflowState forward explicitly.
    const carDueAt = targetState === 'CAR_PENDING' ? computeCarDueDate(new Date()) : null;
    const baseFormData = (audit.application && typeof audit.application.formData === 'object' && audit.application.formData)
        ? audit.application.formData
        : {};
    // Task 3 (pin the decided auditId, 2026-08-17): stamp formData.onsiteAuditId
    // on BOTH the PASS and FAIL/CAR_PENDING writes so the in-tx auto-mint's
    // generateCertificate (fired from inside writeApplicationStatus's
    // AUDIT_PASSED hook, below) verifies THE SAME AuditChecklist row this
    // decision was made against — not whatever resolveCurrentOnsiteAuditId
    // would re-resolve if a newer/duplicate row appeared in the meantime.
    //
    // The FAIL branch pins deliberately, not by copy-paste: CAR_REVIEWING ->
    // AUDIT_PASSED is a legal edge (workflow-transition-service.js), so a
    // corrective action closed on paper mints a certificate resting on the
    // photographs of the visit that recorded the FAIL, and those are the only
    // onsite evidence that exists for it.
    //
    // What that pin must NOT do is outlive its audit into the next one. Until
    // 2026-08-26 nothing ever moved it, so a FAIL followed by a re-schedule
    // left issuance verifying the failed visit's photos. The pin is now
    // re-pointed at arming time, in services/audit/arm-onsite-evidence.js — the
    // single place an AuditChecklist row is created — rather than by another
    // copy of this stamp in each of the four decision handlers.
    const carFormData = carDueAt
        ? {
            ...baseFormData,
            workflowState: targetState,
            carDueAt: carDueAt.toISOString(),
            car_due_at: carDueAt.toISOString(),
            onsiteAuditId: auditId,
        }
        : null;
    const passFormData = (decision === DECISIONS.PASS)
        ? { ...baseFormData, onsiteAuditId: auditId }
        : null;
    const result = {
        audit: null,
        transition: null,
        notify: null,
    };

    await prisma.$transaction(async (tx) => {
        // 1. Flip the audit row's status. AuditChecklist has NO `formData`
        //    column (only status/submittedAt/sections[]/score/…) — writing
        //    `formData` threw PrismaClientValidationError and rolled back the
        //    ENTIRE decision tx (on-farm PASS/FAIL/NEEDS_REVIEW 100% failed).
        //    The decision DETAILS are persisted on the parent Application
        //    (auditResult/auditNotes below), recorded immutably in the audit
        //    log (onAudit metadata), and delivered to the applicant
        //    notification — so the audit row only needs its status here.
        result.audit = await tx.auditChecklist.update({
            where: { id: auditId },
            data: {
                status: decision === DECISIONS.NEEDS_REVIEW ? 'IN_PROGRESS' : 'COMPLETED',
                submittedAt: decision === DECISIONS.NEEDS_REVIEW ? null : new Date(),
                updatedBy: actorId,
            },
        });

        // 2. Transition the parent Application via the canonical writer.
        if (targetState && audit.application) {
            result.transition = await writeApplicationStatus({
                prisma: tx,
                applicationId: audit.application.id,
                fromStatus: audit.application.status,
                toStatus: targetState,
                actorId,
                actorRole,
                reason: `ONSITE_AUDIT_${decision}`,
                // Bug 6.1: gate the transition on the PARENT-application edge, not only
                // the AuditChecklist row status. Without this a re-PASS onto an already
                // AUDIT_PASSED/APPROVED/CERTIFIED record — or a bogus FAIL→CAR_PENDING
                // 5-working-day clock on a past-audit app — was silently writable. The
                // legal onsite edges (AUDIT_CONFIRMED/CAR_REVIEWING → AUDIT_PASSED|
                // CAR_PENDING) remain permitted for the AUDITOR role (verified against
                // ROLE_TRANSITIONS), so this does NOT block the real audit flow. An
                // illegal edge now throws "illegal transition" → mapped to 422 at the
                // route. Mirrors /audits/:id/result + auditor-audit-decision-handler.js.
                assertTransition: true,
                // WF-F8: record the status transition in the AuditLog (atomic with tx).
                onAudit: statusTransitionAuditHook({ tx, metadata: { auditId, decision, criticalFindings, decidedBy: actorId } }),
                additionalData: {
                    auditResult: decision,
                    auditNotes: summary,
                    // carFormData (FAIL → CAR_PENDING, carries the CAR due date +
                    // workflowState) or passFormData (PASS) — either way formData
                    // carries the pinned onsiteAuditId (Task 3) alongside whatever
                    // else was stamped above.
                    ...(carFormData
                        ? { formData: carFormData }
                        : (passFormData ? { formData: passFormData } : {})),
                },
            });
        }
    }, {
        // P2028 (Phase 0 walk-2 2026-08-19): this tx also runs the cert-auto-gen
        // hook via writeApplicationStatus; over Supabase latency it exceeded
        // Prisma's 5s default and the whole fully-evidenced PASS rolled back.
        // Explicit timeout, same remedy as the settle tx (business-rules.js).
        timeout: ONSITE_AUDIT.DECISION_TX_TIMEOUT_MS,
        maxWait: ONSITE_AUDIT.DECISION_TX_MAX_WAIT_MS,
    });

    // CAR SLA clock: seed the RevisionDeadline row the hourly revision-deadline-checker
    // cron scans (the tx above committed). Best-effort — a seed failure must not undo a
    // recorded decision, but it is logged (it is the corrective-action window's clock).
    if (carDueAt && audit.application) {
        try {
            await seedCarRevisionDeadline({ applicationId: audit.application.id, dueAt: carDueAt, actorId });
        } catch (deadlineErr) {
            _resolveLogger().error(`[audit-onsite-service] CAR deadline seed failed for ${audit.application.id}: ${deadlineErr?.message}`);
        }
    }

    // 3. Fire the applicant notification. Fire-and-forget — a fanout
    //    hiccup must NOT block the decision write (it is best-effort by
    //    contract with notification-fanout-service).
    if (audit.application?.healthId) {
        try {
            const notify = await fanoutService.send({
                userId: audit.application.healthId,
                type: _notifyTypeForDecision(decision),
                payload: {
                    applicationId: audit.application.id,
                    applicationNumber: audit.application.applicationNumber,
                    decision,
                    summary: summary || '',
                    criticalFindings,
                },
            });
            result.notify = notify;
        } catch (err) {
            _resolveLogger().warn(
                `[audit-onsite-service] fanout send failed (non-fatal): ${err?.message}`,
            );
            result.notify = { ok: false, error: err?.message };
        }
    }

    return result;
}

module.exports = {
    // Constants
    DECISIONS,
    ALL_DECISIONS,
    DEFAULT_GPS_TOLERANCE_M,
    DEFAULT_MIN_PHOTOS,
    CHECKLIST_TEMPLATE_2026,
    TEMPLATE_VERSION,

    // GPS helpers
    haversineDistanceMeters,
    verifyGpsAgainstFarm,

    // Photo integrity
    computePhotoHash,

    // Photo provenance (place / time / appearance) — recorded, never enforced
    PERCEPTUAL_HASH_ALGORITHM,
    capturePhotoProvenance,
    reviewPhotoProvenance,

    // Lifecycle
    startInspection,
    submitChecklistItem,
    uploadPhoto,
    submitDecision,
};
