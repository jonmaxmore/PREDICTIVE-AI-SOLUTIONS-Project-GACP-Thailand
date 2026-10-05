const { prisma } = require('./prisma-database');
const { toCanonicalCertificateNumber } = require('./certificate-number-display');
const { CERTIFICATE } = require('../config/business-rules');
const crypto = require('crypto');
const logger = require('../shared/logger');
const { AREA_UNIT, storedAreaToSqm } = require('../shared/area-utils');
const { coordinatePairFrom } = require('../shared/coordinates');
const { readFilingSite } = require('./application-service/application-farm-materialization');
const { submittedAreaSqm } = require('./certificate/submitted-area');
const { applicationCultivationMethod } = require('../shared/cultivation-method');
const cacheService = require('./cache-service');
const { buildCertVerifyUrl } = require('./certificate-verify-url');
const { allocateCertificateNumber } = require('./certificate-number-allocator');
const { computeLookupHmac } = require('../utils/field-encryption');
// cert-integrity fix (Phase A2, 2026-08-16): every cert-mint path — the
// AUDIT_PASSED auto-issue hook, the audit-result route, the provider
// auditor-decision handler, and the final-approvals direct call — funnels
// through generateCertificate, so the fail-closed evidence check belongs
// here, not only in audit-onsite-service.submitDecision (Phase A). See
// services/onsite-evidence-gate.js and the change log.
const { assertOnsiteEvidenceSufficient } = require('./onsite-evidence-gate');
// F-G4-58: the plant a certificate names comes from the plant_species master,
// resolved from the wizard's formData.plantId (slug) or a master code — the one
// resolver in services/plant-species-service.js. Never a literal.
const { resolvePlantSpecies, plantDisplayName } = require('./plant-species-service');
// thaiYear is the SSOT for the Buddhist-era year stamped into the certificate
// number (GACP-TH-2569-...). buildBatchNumber was imported here too until
// F-G4-22 deleted the auto-seeded first harvest batch — a harvest batch number
// is now minted only where a farmer records a real harvest.
const { thaiYear } = require('../shared/harvest-identifiers');
const { addLocalYears } = require('../utils/working-days');

// holder-access is required lazily: it pulls farm-access and the permission
// engine, which this widely-required module must not load at require time.
const holderAccess = () => require('./holder-access');
const isHolderScope = (scope) => Boolean(scope) && typeof scope === 'object' && Array.isArray(scope.readIds);

// CERT-01: key namespace for the certificate PKI signature. signWithLocalKey
// uses a per-namespace key when provisioned (INT-11) and otherwise the default
// key — so the cert is signed either way. Issued by the certifying authority.
const CERT_KEY_NAMESPACE = 'rsa:gacp-certificate';
const CERT_SIGNATURE_ALGORITHM = 'RSA-SHA256';

/**
 * BE-#4 — content-integrity hash for an issued GACP certificate.
 *
 * Signs over the CANONICAL certificate DATA (not the PDF bytes — the PDF is
 * regenerated on-demand from this data, so the data is the legally-binding
 * artifact). A stored documentHash lets the public verify endpoint detect any
 * post-issuance tampering of the row: recompute from the live fields and compare.
 *
 * Deterministic field order + JSON.stringify so the same cert always hashes the
 * same. Dates are normalised to ISO so a Date vs string round-trip can't drift.
 *
 * @param {object} c  the fields about to be persisted (or a loaded cert row)
 * @returns {string}  `hmac-sha256:<hex>` (keyed — see below)
 */
const CERT_HASH_PREFIX = 'hmac-sha256:';

/**
 * Canonical, deterministic JSON of the legally-binding cert fields (stable field
 * order; dates normalised to ISO so a Date-vs-string round-trip can't drift).
 * Shared by the hash builder and the verifier.
 */
function certificateCanonicalJson(c) {
    const toIso = (d) => (d ? new Date(d).toISOString() : null);
    return JSON.stringify({
        certificateNumber: c.certificateNumber,
        verificationCode: c.verificationCode,
        applicationId: c.applicationId,
        userId: c.userId,
        farmId: c.farmId,
        farmName: c.farmName,
        applicantName: c.applicantName,
        cropType: c.cropType,
        farmSize: c.farmSize,
        province: c.province,
        district: c.district,
        subDistrict: c.subDistrict,
        standardName: c.standardName,
        standardId: c.standardId,
        validityYears: c.validityYears,
        issuedDate: toIso(c.issuedDate),
        expiryDate: toIso(c.expiryDate),
        issuedBy: c.issuedBy,
    });
}

const CERT_HMAC_DOMAIN = 'gacp-cert-integrity:v1:';

// Both spellings live in the column (canonical lowercase; legacy/interop rows
// carry uppercase). revokeCertificate refuses a re-stamp on either.
const REVOKED_STATUSES = Object.freeze(['revoked', 'REVOKED']);

/**
 * BE-#4 / #619 fix — KEYED content-integrity hash for a GACP certificate.
 * Returns a versioned `hmac-sha256:<hex>`. Post-issuance tampering can no longer
 * be hidden by recomputing the hash: an attacker who edits the DB row lacks the
 * server key, so verifyDocumentIntegrity's recompute stops matching. (Previously
 * an UNKEYED SHA-256 that anyone could recompute — #619.) Certs issued before the
 * cutover carry a bare-hex hash; verifyDocumentIntegrity now reads them UNSIGNED
 * (the legacy verify path is dropped — a bare-hex hash proves nothing under #619).
 *
 * Keyed via the crypto SSOT (field-encryption.computeLookupHmac → keyed by
 * AUTH_LOOKUP_HMAC_KEY / ENCRYPTION_KEY), domain-separated so it is never the same
 * digest as a national-ID lookup HMAC. No process.env read here (env-direct SSOT).
 *
 * NOTE: the RSA signature over documentHash remains the PRIMARY anti-forgery
 * control. The #619 downgrade is now closed here (a non-keyed hash → UNSIGNED,
 * never VALID); the remaining follow-up (issue #804) is a data backfill of the
 * existing legacy rows to the keyed form so genuine legacy certs read VALID again.
 */
function buildCertificateDocumentHash(c) {
    const mac = computeLookupHmac(`${CERT_HMAC_DOMAIN}${certificateCanonicalJson(c)}`);
    return `${CERT_HASH_PREFIX}${mac}`;
}

/**
 * #16 (integrity-audit 2026-07-06) — is this certificate row REVOKED?
 *
 * buildCertificateDocumentHash deliberately OMITS mutable lifecycle columns
 * (status / isDeleted / revokedAt) so a legitimate revoke/suspend does not read
 * as TAMPERED. The trade-off: a DB-level status flip is invisible to the hash,
 * so a revoked cert whose row is otherwise intact recomputes to VALID and an
 * attacker un-revoking (isDeleted→false / status→active) keeps the green
 * integrity chip. Changing the hash formula would break EVERY existing signed
 * cert (their stored hash + RSA signature were computed over the old field
 * list), so the verify path independently inspects the LIVE revocation state
 * instead — see verifyDocumentIntegrity.
 *
 * A revocation MARKER is any of: status 'revoked', isDeleted:true, or the
 * forensic revokedAt/revokedBy fields being set. This catches the common
 * un-revoke (attacker flips status/isDeleted but leaves the revocation
 * metadata). Residual (deferred to a hash-formula change): a FULLY-scrubbed
 * un-revoke that also clears revokedAt/revokedBy.
 *
 * Pure + module-level (NOT a method) so verifyDocumentIntegrity keeps working
 * when destructured off the singleton (`const { verifyDocumentIntegrity } = ...`).
 *
 * @param {object} cert  a loaded Certificate row
 * @returns {boolean}
 */
function isCertificateRevoked(cert) {
    if (!cert) { return false; }
    if (String(cert.status || '').toLowerCase() === 'revoked') { return true; }
    if (cert.isDeleted === true) { return true; }
    if (cert.revokedAt || cert.revokedBy) { return true; }
    return false;
}

async function bustAnalyticsCacheBestEffort(reason) {
    try {
        await cacheService.invalidateAnalyticsCache();
    } catch (error) {
        logger.warn('[certificate-service] analytics cache invalidation failed (non-fatal)', {
            reason,
            error: error?.message,
        });
    }
}

function normalizeText(value) {
    return String(value || '').trim();
}

// F-G4-52 (2026-08-27): the location a certificate certifies. Every column is
// NOT NULL on Farm (farm.prisma:29-33) and province/district/subDistrict are
// NOT NULL on Certificate (certification.prisma:41-43). Until this fix a
// missing answer became the literal 'Unknown' / '-' on the certificate and
// 'Unknown' / '00000' on a freshly created Farm, and the public verifier
// printed 'Unknown' to whoever scanned the QR — all three demo certificates
// read that way while the wizard had stored เชียงใหม่ / เมืองเชียงใหม่ / สุเทพ.
// A certificate is a government register: a missing fact is a refusal, never
// a stand-in.
const FARM_LOCATION_LABELS = Object.freeze({
    address: 'ที่อยู่',
    province: 'จังหวัด',
    district: 'อำเภอ',
    subDistrict: 'ตำบล',
    postalCode: 'รหัสไปรษณีย์',
});
// A Farm row cannot be born without all five (NOT NULL, no defaults).
const FARM_CREATE_LOCATION_FIELDS = Object.freeze(['address', 'province', 'district', 'subDistrict', 'postalCode']);
// What a certificate must be able to say about where its farm is: the three
// Certificate columns that are NOT NULL and folded into certificateCanonicalJson,
// so a blank in any of them would be signed as fact.
const CERTIFICATE_LOCATION_FIELDS = Object.freeze(['province', 'district', 'subDistrict']);
// ฉบับแก้ไขภายใต้เลขเดิม (spec design note 2026-08-27-certificate-revision-design):
// the certificate columns a revision may correct. The three NOT NULL register
// location columns plus the nullable address line come from the Farm row only;
// cropType (F-G4-58) comes from the plant_species master through the
// application's wizard answer. The admin never types a register value.
const CERTIFICATE_REVISION_FIELDS = Object.freeze(['province', 'district', 'subDistrict', 'address', 'cropType']);
// The only reason a revision can carry today. The code is what the row stores
// and what the public verifier maps to its Thai label; the admin's free text
// (reasonText) never leaves the archive. The one code is stamped whichever of
// CERTIFICATE_REVISION_FIELDS moved (a location fix, a plant-name fix, or
// both), so its label names the source the correction was taken from, never
// one field: a plant-only revision must not be published as a farm-location
// correction that did not happen (which fields moved is on the archived
// row's correctedFields).
const REVISION_REASON_CODES = Object.freeze({ SYSTEM_DATA_CORRECTION: 'SYSTEM_DATA_CORRECTION' });
const REVISION_REASON_LABELS_TH = Object.freeze({
    SYSTEM_DATA_CORRECTION: 'แก้ไขข้อมูลบนใบรับรองให้ตรงกับบันทึกต้นทาง (ความผิดพลาดของระบบ)',
});

/**
 * A unique violation is only the revision race if it names the archive key
 * `certificate_revisions (certificateId, revisionNo)`. Prisma reports the
 * columns in `meta.target` (an array on Postgres; a string on other engines,
 * matched by the same names). Any other P2002 — a duplicate id, say — is the
 * caller's problem and must surface as itself (same idiom as
 * plot-code-extension.js isPlotCodeCollision).
 *
 * @param {*} error
 * @returns {boolean}
 */
function isRevisionKeyCollision(error) {
    if (!error || error.code !== 'P2002') {
        return false;
    }
    const target = error.meta && error.meta.target;
    const named = Array.isArray(target) ? target.join(',') : String(target || '');
    return named.includes('certificateId') && named.includes('revisionNo');
}
// The literals the retired path wrote in place of a missing answer: 'Unknown'
// on address/province/district/subDistrict and '00000' on postalCode of a
// freshly created Farm, 'Unknown' / '-' on a certificate. A Farm row born
// before this fix can still carry them, and a certificate that reuses such a
// row must read them as the missing facts they stand for — not as a place.
const RETIRED_LOCATION_STAND_INS = Object.freeze(new Set(['Unknown', '-', '00000']));
// The same idea for the farm's NAME. 'Certified Farm' was written by the pre-2026-09-07
// create path onto every farm born at issuance; it was never a name anybody chose, so a
// row still carrying it is unnamed, not named — and the filing's own site name may fill
// it. Without this the literal outlives its own removal on every existing row, and the
// public scan keeps calling a Thai farm by an English placeholder.
const RETIRED_FARM_NAME_STAND_INS = Object.freeze(new Set(['Certified Farm', 'Unknown', '-']));

function isRetiredFarmNameStandIn(value) {
    return RETIRED_FARM_NAME_STAND_INS.has(normalizeText(value));
}

function isRetiredLocationStandIn(value) {
    return RETIRED_LOCATION_STAND_INS.has(normalizeText(value));
}

/** Blank, or one of the retired stand-ins: either way, nobody has said it. */
function isLocationFactMissing(value) {
    const text = normalizeText(value);
    return text === '' || RETIRED_LOCATION_STAND_INS.has(text);
}

function missingLocationFields(location, fields) {
    return fields.filter((field) => isLocationFactMissing(location?.[field]));
}

/**
 * Same fail-closed shape as signCertificateDataOrThrow's refuse(): log the
 * operator-facing reason, return a coded error, and let the caller throw it
 * before anything is written.
 */
function refuseFarmLocation(missing, { applicationId, farmId, action = 'issuance' }) {
    const labels = missing.map((field) => FARM_LOCATION_LABELS[field]).join(', ');
    logger.error(
        `[Certificate] Farm location incomplete for application ${applicationId} — ${action} REFUSED `
        + `(fail-closed): missing ${missing.join(', ')}`,
        { applicationId, farmId: farmId || null },
    );
    const err = new Error(
        `ไม่สามารถออกใบรับรองได้ เนื่องจากข้อมูลที่ตั้งฟาร์มไม่ครบถ้วน (ขาด ${labels}) `
        + 'กรุณาแก้ไขข้อมูลที่ตั้งฟาร์มในคำขอให้ครบถ้วนก่อนออกใบรับรอง',
    );
    err.code = 'CERTIFICATE_FARM_LOCATION_MISSING';
    err.statusCode = 422;
    err.missingFields = missing;
    return err;
}

/**
 * The farm's NAME is a fact of the same kind as its address, and it was the one that
 * escaped the F-G4-52 rule two lines below: the create branch used to fall back to the
 * literal 'Certified Farm'. That literal was then written into Farm.farmName and printed
 * by every door afterwards — the certificate, both public scan pages, the COA — as the
 * name of a real Thai farm that nobody had ever given that name. Found by the operator
 * reading a live scan page on 2026-09-07.
 *
 * Refuse instead, in the same fail-closed shape and in Thai, because the person who has
 * to fix the filing reads Thai.
 */
function refuseFarmName({ applicationId, action = 'issuance' }) {
    logger.error(
        `[Certificate] Application ${applicationId} names no farm — ${action} REFUSED (fail-closed)`,
        { applicationId },
    );
    const err = new Error(
        'ไม่สามารถออกใบรับรองได้ เนื่องจากคำขอไม่ได้ระบุชื่อฟาร์ม '
        + 'กรุณากรอกชื่อสถานที่ปลูกในคำขอให้ครบถ้วนก่อนออกใบรับรอง',
    );
    err.code = 'CERTIFICATE_FARM_NAME_MISSING';
    err.statusCode = 422;
    err.missingFields = ['farmName'];
    return err;
}

// F-G4-58 (2026-08-27): the plant a certificate certifies. cropType is a
// canonical field (certificateCanonicalJson above), so whatever is written here
// is signed as fact. Until this fix the issuance path read formData.plantName,
// a key the wizard never writes (it stores formData.plantId, the FE slug), and
// stamped the literal 'Herb' — all three demo certificates carry it inside
// their signed JSON. The register name lives in the plant_species master
// (nameTH); an application whose plant the master does not know is refused
// before any write, the same way a missing farm location is.

/** The wizard's plant answer: the slug in plantId; plantName only for a row that predates it. */
function plantReferenceOf(formData) {
    return formData?.plantId ?? formData?.plantName ?? null;
}

/**
 * Same fail-closed shape as refuseFarmLocation: log the operator-facing reason,
 * return a coded error, and let the caller throw it before anything is written.
 * The Thai message names the plant reference the application carried (or says
 * it carried none) and the next action.
 */
function refusePlantUnknown(ref, { applicationId, action = 'issuance' }) {
    const named = typeof ref === 'string' ? ref.trim() : '';
    logger.error(
        `[Certificate] Plant ${named ? `"${named}"` : '(none stated)'} is not in the plant master for `
        + `application ${applicationId} — ${action} REFUSED (fail-closed)`,
        { applicationId, plantReference: named || null },
    );
    const verb = action === 'revision' ? 'ออกฉบับแก้ไขของใบรับรอง' : 'ออกใบรับรอง';
    const reason = named
        ? `ไม่พบชนิดพืช "${named}" ในทะเบียนชนิดพืชของระบบ`
        : 'คำขอไม่ได้ระบุชนิดพืช';
    const next = action === 'revision' ? 'แล้วออกฉบับแก้ไขอีกครั้ง' : 'แล้วบันทึกผลการตรวจอีกครั้ง';
    const err = new Error(
        `ไม่สามารถ${verb}ได้ เนื่องจาก${reason} `
        + `กรุณาเลือกชนิดพืชในคำขอจากรายการที่ระบบกำหนด ${next}`,
    );
    err.code = 'CERTIFICATE_PLANT_UNKNOWN';
    err.statusCode = 422;
    err.plantReference = named || null;
    return err;
}

/**
 * The register name of the application's plant, from the master, or a refusal.
 * Reads through the caller's client so a transaction (or an injected fake) is
 * honoured.
 *
 * @param {object|null|undefined} formData  the application's formData
 * @param {{ applicationId: string, action?: string, client: object }} ctx
 * @returns {Promise<string>} nameTH (nameEN when nameTH is blank); never a placeholder
 * @throws {Error} code CERTIFICATE_PLANT_UNKNOWN, statusCode 422
 */
async function resolveCertificatePlantName(formData, { applicationId, action = 'issuance', client }) {
    const ref = plantReferenceOf(formData);
    const name = plantDisplayName(await resolvePlantSpecies(ref, { client }));
    if (!name) {
        throw refusePlantUnknown(ref, { applicationId, action });
    }
    return name;
}

function toNumber(value, fallback = 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
        return parsed;
    }
    return fallback;
}

function toPositiveNumber(value, fallback = 0) {
    const parsed = toNumber(value, fallback);
    if (parsed > 0) {
        return parsed;
    }
    return fallback;
}

function mapAreaTypeToSolarSystem(value) {
    const normalized = normalizeText(value).toUpperCase();
    if (normalized === 'GREENHOUSE') {
        return 'GREENHOUSE';
    }
    if (normalized === 'INDOOR' || normalized === 'INDOOR_CONTROLLED') {
        return 'INDOOR';
    }
    return 'OUTDOOR';
}

function extractPlotSeedsFromApplication(app) {
    const rows = Array.isArray(app?.formData?.plots) ? app.formData.plots : [];
    return rows
        .map((row, index) => {
            const name = normalizeText(row?.name) || `แปลง ${index + 1}`;
            // Converted here, once. What gets stored is square metres and says
            // so; the submitted unit only decides how to read the number.
            const area = submittedAreaSqm(
                toPositiveNumber(row?.areaSize, 0),
                row?.areaUnit,
                `plots[${index}].areaSize`,
            );
            const solarSystem = mapAreaTypeToSolarSystem(row?.solarSystem || row?.cultivationMethod || app?.areaType);
            return {
                name,
                area,
                areaUnit: AREA_UNIT,
                solarSystem,
            };
        })
        .filter((row) => row.area > 0);
}

/**
 * Certificate Service
 * Handles generation and management of GACP Certificates.
 */
class CertificateService {

    /**
     * Generate a new Certificate for an approved Application
     * @param {string} applicationId 
     * @param {string} providerId 
     */
    async generateCertificate(applicationId, providerId, options = {}) {
        logger.info(`[Certificate] Generating for App: ${applicationId}`);
        const opts = options && typeof options === 'object' ? options : {};
        // F-G4-22: `opts.skipInitialAssets` is accepted and ignored. Issuing a
        // certificate no longer writes any cultivation row, so there is nothing
        // left to skip; callers that still pass it are harmless.
        // BE-T1: when the caller hands us a transaction handle, every write in the
        // issuance chain (farm → plots → cert) runs through it so a failure rolls
        // the whole thing — and the caller's status flip — back together. A bare
        // client (the default / legacy + seed + e2e paths) commits per write.
        const client = opts.prisma || prisma;

        // 6.4: the dedupe is STATUS-aware, not just isDeleted-aware. A REVOKED
        // cert must NEVER block a valid replacement — and revoked certs are kept
        // isDeleted:false (MF-1: so they stay visible as REVOKED on public verify),
        // so the `status notIn ['revoked','REVOKED']` filter is what frees the
        // re-pass to mint a fresh cert. Do not rely on isDeleted here.
        const existingCertificate = await client.certificate.findFirst({
            where: {
                applicationId,
                isDeleted: false,
                status: { notIn: ['revoked', 'REVOKED'] },
            },
            orderBy: { createdAt: 'desc' },
        });
        if (existingCertificate) {
            logger.info(`[Certificate] Existing certificate reused for App: ${applicationId}`);
            return existingCertificate;
        }

        // 1. Fetch Application with HEALTH_USER details
        const app = await client.application.findUnique({
            where: { id: applicationId },
            // M1: entity rides along — the holder resolver reads it (D1 priority 1).
            include: { applicant: true, entity: true },
        });

        if (!app) { throw new Error('Application not found'); }
        if (!app.applicant?.id) { throw new Error('Application owner not found'); }
        const appStatus = String(app.status || '').toUpperCase();
        const workflowState = String(app.formData?.workflowState || '').toUpperCase();

        // PR-1.3: gate certificate issuance on the actual audit-pass *event*,
        // not just the current application status. There are two equally
        // valid sources for the audit-pass record because the codebase has
        // two parallel write paths:
        //   • column path — Application.auditResult ('PASS') is set by
        //     seed-approve.js, force_certify.js, e2e-controller.js
        //   • JSON path — formData.auditResult ('PASS') + formData.auditedAt
        //     are set by apps/backend/routes/api/audit/audits.js:454-457
        //     (the canonical auditor-driven endpoint)
        // Either is acceptable as proof of a passing audit. The JSON path
        // is preferred (timestamp + checklist + notes) but the column path
        // is the older convention and still in active use.
        //
        // Any code path that flips status to APPROVED without writing
        // EITHER source will fail this gate.
        const formAuditResult = String(app.formData?.auditResult || '').toUpperCase();
        const formAuditedAt = app.formData?.auditedAt;
        const colAuditResult = String(app.auditResult || '').toUpperCase();
        const formPathOk = formAuditResult === 'PASS' && Boolean(formAuditedAt);
        const colPathOk = colAuditResult === 'PASS';
        const hasPassRecord = formPathOk || colPathOk;
        if (!hasPassRecord) {
            const err = new Error(
                'Refusing to issue certificate: no PASSING audit record found. '
                + 'Either set Application.auditResult="PASS" or '
                + 'formData.auditResult="PASS" + formData.auditedAt. '
                + 'The canonical path is POST /api/audits/:id/result.',
            );
            err.code = 'CERT_REQUIRES_AUDIT_PASS';
            throw err;
        }

        // Belt-and-suspenders: also require the application to be in a
        // post-audit state. AUDIT_PASSED is the immediate post-audit state
        // (set by audits.js:437). APPROVED / CERTIFIED are downstream.
        if (
            appStatus !== 'AUDIT_PASSED'
            && appStatus !== 'APPROVED'
            && appStatus !== 'CERTIFIED'
            && workflowState !== 'APPROVED'
            && workflowState !== 'CERTIFIED'
        ) {
            throw new Error('Application must be in a post-audit state (AUDIT_PASSED / APPROVED / CERTIFIED) before issuing certificate');
        }

        // cert-integrity fix (Phase A2, 2026-08-16) — THE CHOKE POINT.
        // Phase A gated audit-onsite-service.submitDecision alone; adversarial
        // review found the audit-result route, the provider auditor-decision
        // handler, and this method's own direct callers (final-approvals) could
        // all reach here with ZERO onsite evidence recorded. Every path that
        // mints a certificate calls generateCertificate, so refusing HERE —
        // before any mint/DB write — closes all of them at once. Fail-closed:
        // no onsite audit row, or the photo/checklist models unprovisioned
        // (even partially), refuses rather than skips. See
        // services/onsite-evidence-gate.js + the change log.
        //
        // Task 3 (pin the decided auditId, 2026-08-17): when submitDecision
        // recorded a PASS/FAIL it stamped formData.onsiteAuditId with the exact
        // AuditChecklist row it acted on (`app` was fetched above at :234, so
        // this read sees that pin — including the in-tx auto-mint case, since
        // the fetch above runs on the SAME tx client as the write that stamped
        // it). Forwarding it makes the gate verify THAT row instead of
        // re-resolving, closing the temporal-divergence gap where a
        // newer/duplicate AuditChecklist could otherwise diverge decision from
        // mint. Absent (legacy/other callers, or no formData) → the gate
        // resolves as before (unchanged, Task 2's fallback).
        await assertOnsiteEvidenceSufficient({
            prisma: client,
            applicationId,
            auditId: app.formData?.onsiteAuditId,
        });

        // 2. Check overlap? (Skip for now, assume valid)

        // F-G4-58: the plant this certificate names, from the master. Resolved
        // BEFORE the farm resolver so a refusal leaves nothing written — the
        // resolver below creates or updates the Farm row.
        const cropType = await resolveCertificatePlantName(app.formData, { applicationId, client });

        // Resolve farm from application context. Reuse existing farm first to avoid
        // creating duplicate "Certified Farm" records without plots.
        const farm = await this.resolveFarmForCertificate(app, providerId, client);
        // F-G4-52: a certificate names where its farm is. The resolver refuses
        // before its own writes; this asks the same question of whatever it
        // returned, before the plot write below and the certificate write further
        // down, so no caller can reach certificate.create with a blank location.
        const farmLocationMissing = missingLocationFields(farm, CERTIFICATE_LOCATION_FIELDS);
        if (farmLocationMissing.length > 0) {
            throw refuseFarmLocation(farmLocationMissing, { applicationId, farmId: farm.id });
        }
        await this.ensurePlotsForFarm(farm, app, client);

        // 3. Generate Certificate Number
        // The stored number is the printed number, in the real DTAM style
        // `TH-GACP {n}/{ปี พ.ศ.}` (operator 2026-10-05): n is a running number
        // that restarts at 1 each Buddhist year, drawn from the ReceiptSequence
        // series under a row lock (services/certificate-number-allocator.js).
        // The old random hex suffix existed so the register could not be walked
        // by counting; that protection now rests on the rate-limited public verify
        // door and the per-certificate verification code, not on the number.
        // certificate.certificateNumber has @unique, so a duplicate can never land.
        // The issue instant is taken once, here: the number year and the printed
        // issue date both read it, in Bangkok, so the year in the number can never
        // name a different year from the date on the certificate (operator 2026-09-26).
        const issuedDate = new Date();
        const certNumber = await allocateCertificateNumber({ client, issuedDate });

        // 4. Calculate Dates (issuedDate is taken above, with the number year)
        // อายุใบรับรองอยู่ที่ config/business-rules.js CERTIFICATE.VALIDITY_YEARS
        // (operator 2026-09-11: ตั้ง 1 ปีก่อน รอยืนยัน) · เดิมเป็นเลข 3 ฝังตรงนี้พร้อม
        // คอมเมนต์ "Standard GACP" ที่ไม่มีเอกสารกรมฉบับใดรองรับ
        const validYears = CERTIFICATE.VALIDITY_YEARS;
        // The same Bangkok wall-clock time N calendar years on.
        const expiryDate = addLocalYears(issuedDate, validYears);

        // 5. Generate Verification Code (8 chars alphanumeric)
        const verificationCode = crypto.randomBytes(4).toString('hex').toUpperCase();

        // 6. Create Certificate Record
        const certData = {
            certificateNumber: certNumber,
            verificationCode: verificationCode,
            qrData: buildCertVerifyUrl(certNumber), // canonical public verify URL (see certificate-verify-url.js)

            applicationId: app.id,
            userId: app.applicant.id,

            // ADR-014 (hardening-iter3 fix): Certificate is a TENANT_SCOPED model —
            // `organizationId` is a REQUIRED FK with no default. cert-service set
            // the scalar applicationId/userId/farmId but OMITTED organizationId, so
            // certificate.create demanded the relations and threw
            // ("Argument `application` is missing" — Prisma's misleading progressive
            // validation when a required scalar FK is absent). #392 org-scoped the
            // Farm/Plot creates in this same issuance chain but missed the Certificate
            // row itself. This path was never hit on the canonical single-auditor
            // auto-issue flow until #397 made AUDIT_PASSED reachable via the API
            // (certs to date came only from seed/force-certify). Resolve from the
            // application (farm fallback — both carry the app's org).
            organizationId: app.organizationId || farm.organizationId,

            // Farm Info (Linked to the new Farm)
            farmId: farm.id,
            farmName: farm.farmName,
            applicantName: `${app.applicant.firstName} ${app.applicant.lastName}`,

            // M1: the farm holds the certificate, the person merely submits.
            // userId/applicantName above stay frozen history (expand-only).
            // Not in the canonical hash field list — see plan D11.
            ...resolveHolderForIssuance(app, farm),
            // The master's nameTH for the wizard's plantId — resolved above,
            // before any write. This used to be `formData.plantName || 'Herb'`.
            cropType,
            // Square metres. `farm.cultivationArea` is in the farm row's own
            // unit, which for a farm created before the switch is rai.
            // farm.areaUnit || AREA_UNIT stays a DEFENSIVE fallback, not a
            // silent-default violation: the Farm table always writes an
            // explicit unit (:611/:679/below), the column carries
            // `@default("sqm")` (farm.prisma:42), and a live read-only probe
            // 2026-08-20 found 0 rows with a NULL/empty areaUnit out of every
            // row in the table (evidence/farm-areaunit-default-task1/
            // live-probe.txt) — there is no unit-less Farm row for this to
            // ever actually catch. farm-areaunit-default fix, Task 3.
            farmSize: storedAreaToSqm(farm.cultivationArea, farm.areaUnit || AREA_UNIT),

            // Location — the resolved farm's, which is what this certificate
            // certifies. F-G4-52: this used to read formData.locationData.*, a
            // key the wizard fills with nothing but farmId
            // (application-draft-query-methods.js:84), and stamp 'Unknown' / '-'
            // when it was empty — while the farm row, built from farmData by
            // resolveFarmForCertificate, already held the real values. Blank
            // province/district/subDistrict was refused above, before any write.
            province: farm.province,
            district: farm.district,
            subDistrict: farm.subDistrict,
            // Certificate.address is nullable: a farm row with no address text,
            // or one still carrying the retired 'Unknown', yields null here,
            // not a stand-in.
            address: isLocationFactMissing(farm.address) ? null : normalizeText(farm.address),

            // Standard
            standardName: 'GACP Thailand',
            standardId: 'GACP-TH', // Legacy

            // Dates
            validityYears: validYears,
            issuedDate: issuedDate,
            expiryDate: expiryDate,
            issuedBy: providerId || 'SYSTEM',
            status: 'active',
        };

        // BE-#4: stamp the content-integrity hash + signing metadata over the
        // exact fields being persisted, so the public verifier can later detect
        // any tampering of the row. Hash-level integrity (no RSA key needed).
        certData.documentHash = buildCertificateDocumentHash(certData);
        certData.signedBy = providerId || 'SYSTEM';
        certData.signedAt = issuedDate;

        // CERT-01 + RULING 2 (2026-08-22): PKI digital signature over the
        // documentHash. This used to be BEST-EFFORT — a signing failure was
        // logged as "issuing with hash-only integrity" and the certificate was
        // minted with `signature = null`.
        //
        // That is retired. A government e-certificate without its signature is
        // not a weaker certificate, it is an unverifiable one: the SHA-256
        // documentHash proves only that the row agrees with itself, and anyone
        // who can rewrite the row can rewrite the hash with it. The operator
        // ruling is explicit that the signature is required.
        //
        // The fallback was not theoretical either. A read-only query of the demo
        // database on 2026-08-22 found 3 certificates — created 2026-08-16,
        // 08-18 and 08-20, all AFTER CERT-01 shipped on 2026-06-07 — and
        // `signature IS NULL` on every one. The dev key on that box was
        // encrypted under a process-scoped passphrase that no later process
        // could reproduce, so every issuance hit bad-decrypt and took this
        // branch in silence.
        //
        // Fail-closed placement matters: this runs BEFORE `certificate.create`,
        // so nothing half-issued exists. Callers mint inside a transaction
        // (application-status-writer's AUDIT_PASSED hook, routes/api/audit/
        // audits.js), so the throw rolls the status flip back with it and the
        // auditor retries once the key is mounted. See W5 report for the state
        // machine walk-through.
        await this.signCertificateDataOrThrow(certData, certNumber);

        const certificate = await client.certificate.create({ data: certData });


        logger.info(`[Certificate] Created: ${certNumber}`);

        // F-G4-22 (2026-08-26): issuing a certificate no longer invents CULTIVATION
        // ACTIVITY — no planting cycle, no harvest batch. Read that precisely: it is
        // not "issuance writes nothing". ensurePlotsForFarm (:327 → :760) still runs
        // above, and on an application that carries no plot geometry it creates a
        // fallback plot called "แปลงหลัก" sized from farm.cultivationArea. That row is
        // deliberate and load-bearing — a farm with no plot cannot hold a cycle at all
        // (harvest-capacity-operations.js refuses one), so a certificate without a plot
        // would certify ground the system cannot then record anything against. It is
        // still an invented row, and if the wizard is ever made to guarantee plot
        // geometry it should go the same way as the rows below. What went away here was
        // a PlantingCycle named
        // "Featured Cycle 1/<year>" — English in a Thai product, bound to no
        // plot, starting on the issue date rather than on anything the farmer
        // planted — plus a HarvestBatch with freshWeight 0 and a public QR for
        // it. All three described cultivation that never happened, and they
        // appeared in the farmer's own cycle and batch lists next to the rows
        // they had created (G4 walk, 12:51:22 — ledger F-G4-22). A cycle exists
        // because a farmer pressed the button that creates cycles; a harvest
        // batch because they recorded a real harvest with a real weight, which
        // the schema requires (harvest.prisma:37). Do not re-add a bootstrap
        // here: certificate-no-cultivation-auto-seed.test.js pins the absence.

        await bustAnalyticsCacheBestEffort('certificate-issue');
        return certificate;
    }

    /**
     * M1.5 H3 — one farm lookup, two legs, in this order:
     *   1. the ENTITY leg (`entityId: app.entityId`) — the workspace owns the
     *      farm, so an application submitted by a member who did not create it
     *      still lands on it instead of minting a VERIFIED ghost farm.
     *   2. the legacy `ownerId` leg — probed per lookup (NOT gated on
     *      `app.entityId == null`), because a farm row the entity backfill has
     *      not reached still has `entityId: null` and would otherwise be
     *      duplicated by exactly the application that should have found it.
     * A legacy-leg hit whose `entityId` is set and differs from the
     * application's belongs to another organisation — refused, never reused.
     * Every leg rides `include: { entity: true }` (M1 D1 priority 2).
     *
     * @returns {Promise<object|null>} the farm, or null for the caller to try
     *          the next identifier (or create).
     */
    async lookupFarmForApplication(app, where, client, extra = {}) {
        const appEntityId = app?.entityId ?? null;
        const query = { ...extra, include: { entity: true } };

        if (appEntityId) {
            const byEntity = await client.farm.findFirst({
                ...query,
                where: { ...where, entityId: appEntityId, isDeleted: false },
            });
            if (byEntity) {
                return byEntity;
            }
        }

        const byOwner = await client.farm.findFirst({
            ...query,
            where: { ...where, ownerId: app.applicant.id, isDeleted: false },
        });
        if (!byOwner) {
            return null;
        }
        if (byOwner.entityId && byOwner.entityId !== appEntityId) {
            return null;
        }
        // Drain metric for the ownerId rows still out there (spec H3: every time
        // the legacy leg is the one that answers, it is on the record).
        logger.warn('[Certificate] farm resolved via legacy ownerId', {
            farmId: byOwner.id,
            applicationId: app.id,
        });
        return byOwner;
    }

    async resolveFarmForCertificate(app, providerId, client = prisma) {
        const farmData = app?.formData?.farmData || {};
        const locationData = app?.formData?.locationData || {};
        const productionData = app?.formData?.productionData || {};

        const requestedFarmId = normalizeText(
            app?.formData?.farmId
            || app?.formData?.farm?.id
            || app?.formData?.farm?.farmId,
        );
        const requestedFarmName = normalizeText(
            readFilingSite(app?.formData || {}).farmName
            || app?.formData?.farmName
            || app?.formData?.plantName,
        );

        let farm = null;
        if (requestedFarmId) {
            // M1: every return path of this resolver must carry the entity — the
            // holder resolver falls back to it (D1 priority 2). lookupFarmForApplication
            // rides it on both legs.
            farm = await this.lookupFarmForApplication(app, { id: requestedFarmId }, client);
        }

        if (!farm && requestedFarmName) {
            farm = await this.lookupFarmForApplication(
                app,
                { farmName: requestedFarmName },
                client,
                { orderBy: { createdAt: 'asc' } },
            );
        }

        // Square metres. This number goes into Farm.totalArea, and the farm's
        // areaUnit is written explicitly below — it used to be left to Prisma's
        // column default of "rai", so 1,600 ตร.ม. entered in the wizard became
        // a certified farm of 1,600 rai.
        //
        // farm-areaunit-default fix (Task 3): the unit argument used to read
        // `farmData.totalAreaUnit || productionData.areaUnit || AREA_UNIT` —
        // the same ×1,600 silent-default class the plot path (submittedAreaSqm
        // at :176-180) already refuses to guess at. `productionData.areaUnit`
        // was checked and found dead: no frontend ProductionData type
        // declares it and no backend write path ever sets it — the only two
        // references in the tree were this read and a test fixture built to
        // feed it — so it was not a real alternative carrier and is dropped
        // along with the unconditional AREA_UNIT guess, not kept as a
        // legitimate fallback between two real sources. The sole source is
        // now the farm's own submitted unit; absent, submittedAreaSqm throws
        // (same mechanism as the plot path), surfacing as CERT_AUTO_GEN_FAILED
        // with a rolled-back tx when reached via the status-writer auto-issue
        // hook. T1 healed the 19 legacy unit-less rows live before this
        // deployed; T2 requires the unit at both submit doors going forward.
        //
        // Task 3 fix round 1 (reviewer finding): this used to run eagerly,
        // right here, before the create/reuse branch below even exists — so a
        // REUSE of an existing farm whose OWN totalArea is already good threw
        // over an unrelated submission's ambiguous unit, even though that
        // number was never going to be written. Made lazy: the strict read
        // only happens where the result is actually about to be WRITTEN — the
        // create branch (below), or a reuse whose farm.totalArea is itself
        // blank (the trio guard below that). A reuse with real farm data
        // never pays for a legacy in-flight submission's unit ambiguity.
        // `farmData.areaSqm` is what the six-step wizard actually writes, and its unit is
        // in its name. It was missing from this list while readFilingSite has read it all
        // along (application-farm-materialization.js:126) — so every farm materialised at
        // issuance from a v2 filing was born with totalArea 0, and its fallback plot with
        // the 1 m² floor below. Measured on staging 2026-09-07: a filing stating 1,200 m²
        // produced farm.totalArea 0 and plot "แปลงหลัก" at 1 m², and the farmer's first
        // planting cycle was then refused for exceeding the plot.
        // อ่านที่ตั้งและพื้นที่ที่คำขอแจ้งไว้ครั้งเดียว แล้วใช้ร่วมกันทั้งบล็อกนี้ —
        // เดิมประกาศไว้ใต้จุดนี้ จึงใช้กับการคิดพื้นที่ไม่ได้
        const filingSite = readFilingSite(app?.formData || {});
        const rawTotalAreaAmount = toPositiveNumber(
            productionData.growingArea
            || farmData.areaSqm
            || farmData.totalAreaSize
            || farmData.totalArea
            || app?.formData?.totalArea,
            0,
        );
        // The unit follows the value that ANSWERED. `areaSqm` states its unit in its own
        // name, so a filing that declared through it has declared the unit too. Every
        // other key has not: a unit-less totalAreaSize must still reach the strict read
        // and throw, rather than be quietly minted as square metres.
        const answeredByAreaSqm = !productionData.growingArea
            && toPositiveNumber(farmData.areaSqm, 0) > 0;
        const rawTotalAreaUnit = answeredByAreaSqm ? AREA_UNIT : farmData.totalAreaUnit;
        // The refusal must name the key that actually answered, or the farmer is sent to
        // fix a field they never filled.
        const rawTotalAreaField = answeredByAreaSqm ? 'farmData.areaSqm' : 'farmData.totalAreaSize';
        const computeBaseArea = () => submittedAreaSqm(
            rawTotalAreaAmount,
            rawTotalAreaUnit,
            rawTotalAreaField,
        );
        // What the application actually states, or null. This used to run
        // through mapAreaTypeToSolarSystem, which answered 'OUTDOOR' for
        // anything it did not recognise — including nothing at all — and the
        // web wizard never set locationType, so every certified farm was
        // recorded as outdoor regardless of how it grows.
        const statedCultivationMethod = applicationCultivationMethod(app);
        if (!statedCultivationMethod) {
            logger.warn(
                `[Certificate] Application ${app?.applicationNumber || app?.id} states no cultivation `
                + 'method. Leaving the farm\'s own value alone rather than recording OUTDOOR.',
            );
        }

        // F-QA-06 heal. The six-step wizard writes siteAddress/siteName; the older filings
        // write address/farmName. Reading only the old spelling refused a certificate to a
        // filing whose address was sitting in it the whole time — the same defect the submit
        // path just fixed, one step later in the line. ONE map for both eras, shared with
        // application-farm-materialization, so the two can never drift again. locationData
        // stays the last rung for filings that carry neither.
        const requestedAddress = normalizeText(filingSite.address || locationData.address);
        const requestedProvince = normalizeText(filingSite.province || locationData.province);
        const requestedDistrict = normalizeText(filingSite.district || locationData.district);
        const requestedSubDistrict = normalizeText(filingSite.subDistrict || locationData.subDistrict);
        const requestedPostalCode = normalizeText(filingSite.postalCode || locationData.zipCode);
        // The farmer's coordinates from the wizard (farmData.gpsLat/gpsLng), or the older
        // locationData spelling. Both halves or neither — see shared/coordinates.js. Until
        // 2026-08-27 this path never carried them at all, so a farm whose position was
        // recorded in the application was minted with latitude/longitude NULL (F-G4-33) —
        // and a certified farm with no location cannot have a single photograph bound to
        // it, which is the entire point of the evidence provenance layer.
        const requestedCoordinates = coordinatePairFrom({
            gpsLat: farmData.gpsLat,
            gpsLng: farmData.gpsLng,
            latitude: locationData.latitude,
            longitude: locationData.longitude,
        });

        if (!farm && requestedAddress) {
            const locationWhere = { address: requestedAddress };
            if (requestedProvince) {
                locationWhere.province = requestedProvince;
            }
            if (requestedDistrict) {
                locationWhere.district = requestedDistrict;
            }

            farm = await this.lookupFarmForApplication(
                app,
                locationWhere,
                client,
                { orderBy: { createdAt: 'asc' } },
            );
        }

        const farmPayload = {
            ownerId: app.applicant.id,
            // No stand-in. A blank here is refused below (refuseFarmName), never filled.
            farmName: requestedFarmName,
            farmType: 'CULTIVATION',
            // F-G4-52: no literal stand-ins ('Unknown' / '00000'). Every one of
            // these is NOT NULL on Farm, so the create branch below refuses when
            // any is blank instead of inventing a value the register would then
            // print as fact.
            address: requestedAddress,
            province: requestedProvince,
            district: requestedDistrict,
            subDistrict: requestedSubDistrict,
            postalCode: requestedPostalCode,
            // totalArea/cultivationArea/areaUnit intentionally NOT included
            // here — the strict read that produces them can throw, so it is
            // only performed where about to be written (see computeBaseArea
            // callers below), not baked into a payload shared by a path that
            // may never write it.
            // Only written when the application says something. Overwriting a
            // farm's real method with a guess is worse than leaving it; on
            // create, Prisma's own column default applies.
            ...(statedCultivationMethod ? { cultivationMethod: statedCultivationMethod } : {}),
            status: 'VERIFIED',
            // NULL when the wizard has none — never 0 (see shared/coordinates.js).
            latitude: requestedCoordinates.latitude,
            longitude: requestedCoordinates.longitude,
            verifiedAt: new Date(),
            verifiedBy: providerId,
        };

        if (!farm) {
            // About to birth a brand-new Farm row — the area trio is always
            // written here, so the strict read always runs (and may throw).
            const baseArea = computeBaseArea();
            // F-G4-52: the row about to be born must know where it is. Refused
            // here, before farm.create, with nothing written.
            const locationMissing = missingLocationFields(farmPayload, FARM_CREATE_LOCATION_FIELDS);
            if (locationMissing.length > 0) {
                throw refuseFarmLocation(locationMissing, { applicationId: app.id });
            }
            // …and it must know its own NAME. Same rule, same place, same refusal —
            // this is the field that used to be filled with 'Certified Farm'.
            if (normalizeText(farmPayload.farmName) === '') {
                throw refuseFarmName({ applicationId: app.id });
            }
            // Farm.organizationId is a required FK (farm.prisma:93, no default) — must
            // be set on create or Prisma throws PrismaClientValidationError, which the
            // auto-issue hook's outer catch turns into a rolled-back AUDIT_PASSED (no
            // cert). Resolve from the application (Application.organizationId is required
            // and always loaded). Only on create — never mutate an existing farm's org.
            //
            // Wave A fix M3 (adversarial-verify 2026-07-02): stamp the workspace
            // dimension too. This hook runs under the AUDITOR's provider context, so
            // the ALS entity context is useless here — the entity comes from the
            // application row (`app.entityId`, stamped at draft-create; null for
            // legacy rows is fine). Without it, cert auto-issue births entityId=null
            // farms that vanish from the applicant's entity-filtered list reads.
            // Create-only — never rewrite an existing farm's entityId (a null app
            // value would evict the farm from every workspace read).
            farm = await client.farm.create({
                data: {
                    ...farmPayload,
                    totalArea: baseArea,
                    cultivationArea: baseArea,
                    areaUnit: AREA_UNIT,
                    organizationId: app.organizationId,
                    entityId: app.entityId ?? null,
                },
                include: { entity: true },
            });
            logger.info(`[Certificate] Farm created for cert: ${farm.id}`);
            return farm;
        }

        // M1.5 H3 — the reuse update writes THREE classes and nothing else. It
        // used to spread farmPayload, so one member's application overwrote the
        // farm another member had described — including `ownerId`, which moved
        // the farm to whoever happened to submit.
        //
        //   • fill-only-blank — the applicant's answer is a stand-in for a blank
        //     field on the farm, never a correction of a filled one. A location
        //     field holding a retired literal ('Unknown' / '00000', written by
        //     the pre-F-G4-52 create path) counts as blank: it was never a
        //     fact, so filling over it corrects nothing.
        //   • always-write — what issuance itself means (see below).
        //   • never-write — `ownerId`, `farmType`: not this path's to decide.
        const updateData = {};
        const isBlank = (value) => value === null
            || value === undefined
            || (typeof value === 'string' && value.trim() === '');
        const fillIfBlank = (field, value) => {
            if (value && isBlank(farm[field])) {
                updateData[field] = value;
            }
        };
        const fillIfLocationMissing = (field, value) => {
            if (value && (isBlank(farm[field]) || isRetiredLocationStandIn(farm[field]))) {
                updateData[field] = value;
            }
        };
        // The name follows the location rule, not the plain blank rule: a row still
        // carrying the retired 'Certified Farm' literal was never named, so writing the
        // filing's own site name over it corrects nothing — it finally names the farm.
        if (requestedFarmName
            && (isBlank(farm.farmName) || isRetiredFarmNameStandIn(farm.farmName))) {
            updateData.farmName = requestedFarmName;
        }
        fillIfLocationMissing('address', requestedAddress);
        fillIfLocationMissing('province', requestedProvince);
        fillIfLocationMissing('district', requestedDistrict);
        fillIfLocationMissing('subDistrict', requestedSubDistrict);
        fillIfLocationMissing('postalCode', requestedPostalCode);
        // F-G4-52: once the application has filled what was blank, the farm this
        // certificate is about must still know its province, district and
        // subdistrict. A legacy row missing any of them, met by an application
        // that does not answer it, is refused HERE — before the update — so it
        // is neither stamped VERIFIED nor certified under a stand-in.
        const locationStillMissing = missingLocationFields(
            { ...farm, ...updateData },
            CERTIFICATE_LOCATION_FIELDS,
        );
        if (locationStillMissing.length > 0) {
            throw refuseFarmLocation(locationStillMissing, { applicationId: app.id, farmId: farm.id });
        }
        // Coordinates are fill-only-blank like the address — the applicant's answer stands
        // in for a farm that has none, never corrects one that is located — and they move
        // as a PAIR: a farm with a latitude and no longitude is unlocated, not half-located,
        // so a lone half is never written for a reader to pair with 0.
        if (requestedCoordinates.latitude !== null
            && isBlank(farm.latitude) && isBlank(farm.longitude)) {
            updateData.latitude = requestedCoordinates.latitude;
            updateData.longitude = requestedCoordinates.longitude;
        }

        // The area is a TRIO — number, cultivated number, and the unit they are
        // both in. Writing the unit on its own (or the number on its own) is how
        // 1,600 ตร.ม. becomes 1,600 ไร่, so all three go together or none do.
        //
        // Task 3 fix round 1: the strict read only runs INSIDE this guard —
        // a reuse whose farm.totalArea is already real is never touched by
        // this submission's own unit, ambiguous or not, so it must never
        // throw over data it was never going to write.
        if (isBlank(farm.totalArea) || toPositiveNumber(farm.totalArea, 0) === 0) {
            const baseArea = computeBaseArea();
            updateData.totalArea = baseArea;
            updateData.cultivationArea = baseArea;
            updateData.areaUnit = AREA_UNIT;
        }

        // always-write: this IS the issuance event.
        updateData.status = farmPayload.status;
        updateData.verifiedAt = farmPayload.verifiedAt;
        updateData.verifiedBy = farmPayload.verifiedBy;
        if (statedCultivationMethod) {
            updateData.cultivationMethod = statedCultivationMethod;
        }

        farm = await client.farm.update({
            where: { id: farm.id },
            data: updateData,
            include: { entity: true },
        });
        logger.info(`[Certificate] Farm reused for cert: ${farm.id}`);
        return farm;
    }

    async ensurePlotsForFarm(farm, app, client = prisma) {
        if (!farm?.id) {
            return;
        }

        const plotCount = await client.plot.count({
            where: { farmId: farm.id },
        });
        if (plotCount > 0) {
            return;
        }

        const seeds = extractPlotSeedsFromApplication(app);
        const rows = seeds.length > 0
            ? seeds
            : [
                {
                    name: 'แปลงหลัก',
                    // farm.cultivationArea is in the farm row's own unit, which
                    // is not necessarily this one — the hard-coded 'rai' here
                    // was a guess about a different table.
                    area: submittedAreaSqm(
                        toPositiveNumber(farm.cultivationArea, 1),
                        farm.areaUnit,
                        'farm.cultivationArea',
                    ),
                    areaUnit: AREA_UNIT,
                    solarSystem: mapAreaTypeToSolarSystem(app?.areaType),
                },
            ];

        for (const row of rows) {
            await client.plot.create({
                data: {
                    farmId: farm.id,
                    // Plot.organizationId is a required FK (farm.prisma:246, no default).
                    // Inherit from the farm (created/reused above with its org set), else
                    // Prisma throws and the cert auto-issue rolls back — breaking issuance
                    // on the existing-farm-without-plots path.
                    organizationId: farm.organizationId,
                    name: row.name,
                    // row.area is already square metres - both branches that build
                    // `rows` above convert before they get here. `area` +
                    // `areaUnit` are the retired pair, written from the same
                    // number so a process still serving the previous image reads
                    // a correct plot; the contract migration drops both.
                    areaSqm: row.area,
                    area: row.area,
                    areaUnit: row.areaUnit,
                    solarSystem: row.solarSystem,
                },
            });
        }
        logger.info(`[Certificate] Plots created for farm ${farm.id}: ${rows.length}`);
    }

    /**
     * Read methods centralised here so route handlers do NOT reach into Prisma
     * directly. This keeps row-level filters (isDeleted, ownership) consistent
     * and gives us a single audit point if we ever need to mask, redact, or
     * field-encrypt certificate columns. Bypassing the service from a route is
     * how legacy PII leaks happened — see docs/tech-debt/prisma-bypass-routes.md.
     */

    /**
     * List certificates with role-based scoping.
     * Provider roles see every non-deleted certificate (capped at `take`),
     * a health user only sees their own.
     *
     * C3 (tenant isolation, ADR-014): a `scope:'all'` provider list is
     * narrowed to the caller's `organizationId` UNLESS `crossTenant` is true
     * (only PLATFORM_ADMIN — the one role that legitimately sees every tenant).
     * Without this, any tenant-A provider role (ADMIN/AUDITOR/SCHEDULER/…)
     * could list every other tenant's certificates (PII + multi-tenancy leak).
     * `organizationId` is intentionally a soft narrowing here: legacy callers
     * that omit it keep the previous behaviour (back-compat) — the route layer
     * is responsible for always passing it for the cross-tenant branch.
     */
    async listCertificates({ scope = 'self', userId = null, holderScope = null, organizationId = null, crossTenant = false, take = 100 } = {}) {
        let where = { isDeleted: false };
        if (scope === 'self') {
            if (!userId) {
                throw new Error('listCertificates: userId is required for self scope');
            }
            // Spec 2026-09-30 §3.1: the health 'self' view reads within the holder
            // scope; R1 keeps the pre-R1 `{ userId }` pin as the AND member. No
            // holder scope fails closed (no query).
            if (!isHolderScope(holderScope)) { return []; }
            const { r1HolderOrLegacy, r1LegacyApplicantPin } = holderAccess();
            where = {
                // R1-legacy-pin: removed in Task 12 (→ holderReadWhere). The pre-R1 pin
                // decides the rows; the OR carries the fragment for the witness.
                ...r1HolderOrLegacy(holderScope, 'Certificate', { userId }),
                ...r1LegacyApplicantPin({ userId }),
                isDeleted: false,
            };
        } else if (!crossTenant && organizationId) {
            // scope:'all' but tenant-bounded — only PLATFORM_ADMIN bypasses this.
            where.organizationId = organizationId;
        }
        return prisma.certificate.findMany({
            where,
            orderBy: { issuedDate: 'desc' },
            take,
        });
    }

    /**
     * Health-user "my certificates" view, including application number for UI.
     *
     * Spec 2026-09-30 §3.1: read within the caller's holder scope. R1 (operator
     * ruling C1, Task 4 fix round 1): the pre-R1 filer pin `{ userId }` alone
     * decided these rows (Certificate is outside the ALS entity dimension), so
     * the where is `{ OR: [fragment, legacy pin], AND: [pin] }` = the pre-R1 rows
     * exactly, even for a filer whose membership was revoked.
     * No scope (or a positional userId) fails closed: no query.
     * @param {{ userId: string, readIds: string[] }} scope
     */
    async listCertificatesForUser(scope) {
        if (!isHolderScope(scope)) { return []; }
        const { r1HolderOrLegacy, r1LegacyApplicantPin } = holderAccess();
        return prisma.certificate.findMany({
            where: {
                // R1-legacy-pin: removed in Task 12 (→ holderReadWhere)
                ...r1HolderOrLegacy(scope, 'Certificate', { userId: scope.userId }),
                ...r1LegacyApplicantPin({ userId: scope.userId }),
                isDeleted: false,
            },
            orderBy: { issuedDate: 'desc' },
            include: {
                application: { select: { applicationNumber: true } },
            },
        });
    }

    /**
     * Fetch one certificate by id within the caller's holder scope.
     * Returns null when the certificate is missing OR outside the scope, so the
     * caller cannot distinguish "deleted" from "not yours" — preventing
     * id-enumeration / IDOR side-channels. R1: the pre-R1 `{ userId }` pin decides
     * (see listCertificatesForUser).
     * @param {string} certificateId
     * @param {{ userId: string, readIds: string[] }} scope
     */
    async getCertificateForUser(certificateId, scope, { select, include } = {}) {
        if (!certificateId || !isHolderScope(scope)) {return null;}
        const { r1HolderOrLegacy, r1LegacyApplicantPin } = holderAccess();
        const query = {
            where: {
                id: certificateId,
                // R1-legacy-pin: removed in Task 12 (→ holderReadWhere)
                ...r1HolderOrLegacy(scope, 'Certificate', { userId: scope.userId }),
                ...r1LegacyApplicantPin({ userId: scope.userId }),
                isDeleted: false,
            },
        };
        if (select) {query.select = select;}
        if (include) {query.include = include;}
        return prisma.certificate.findFirst(query);
    }

    /**
     * Fetch one certificate by id WITHOUT an ownership filter.
     * Used by provider-role (ADMIN) cross-tenant views — the route MUST
     * gate on `isProviderRole(req.user.role)` before calling this method,
     * otherwise the IDOR protection of `getCertificateForUser` is bypassed.
     *
     * Still filters out soft-deleted rows: cross-tenant ADMIN sees ACTIVE,
     * EXPIRED, and REVOKED certificates (REVOKED is a status flip, not a
     * soft delete), but never sees rows where `isDeleted: true`.
     *
     * Returns null when the id is missing or the certificate does not exist.
     */
    async findById(certificateId, { select, include, organizationId = null, crossTenant = false } = {}) {
        if (!certificateId) {return null;}
        const where = { id: certificateId, isDeleted: false };
        // C3 (tenant isolation, ADR-014): narrow the lookup to the caller's
        // tenant unless crossTenant (PLATFORM_ADMIN only). A tenant-A provider
        // asking for a tenant-B cert id then gets `null` (route → 404), exactly
        // like the IDOR 404 for a HEALTH user asking for a cert they don't own.
        if (!crossTenant && organizationId) {
            where.organizationId = organizationId;
        }
        const query = { where };
        if (select) {query.select = select;}
        if (include) {query.include = include;}
        return prisma.certificate.findFirst(query);
    }

    /**
     * Resolve the User ids a certificate row stores in issuedBy / revokedBy
     * into display identities for the admin detail page (ledger F-G4-47 —
     * the screen printed the raw uuids). Read-only.
     *
     * Tenant-scoped EXACTLY like findById: a non-crossTenant caller only
     * resolves users inside its own organizationId; PLATFORM_ADMIN
     * (crossTenant) resolves across tenants. The select is the display
     * projection only — id, firstName, lastName — never healthId /
     * providerId / email, so nothing a health applicant owns can ride out
     * through this door.
     *
     * @param {Array<string|null|undefined>} ids  User ids (falsy entries ignored)
     * @param {{ organizationId?: string|null, crossTenant?: boolean }} [scope]
     * @returns {Promise<Record<string, { id: string, displayName: string|null }>>}
     *   keyed by id; an id the lookup could not match is simply absent.
     */
    async resolveStaffIdentities(ids, { organizationId = null, crossTenant = false } = {}) {
        const unique = [...new Set(
            (ids || []).map((value) => String(value || '').trim()).filter(Boolean),
        )];
        if (unique.length === 0) {return {};}
        const where = { id: { in: unique } };
        if (!crossTenant && organizationId) {
            where.organizationId = organizationId;
        }
        const users = await prisma.user.findMany({
            where,
            select: { id: true, firstName: true, lastName: true },
        });
        const identities = {};
        for (const user of users) {
            const displayName = [user.firstName, user.lastName]
                .map((part) => String(part || '').trim())
                .filter(Boolean)
                .join(' ') || null;
            identities[user.id] = { id: user.id, displayName };
        }
        return identities;
    }

    /**
     * Public verification lookup by certificateNumber.
     * Does NOT filter by isDeleted — verification must visibly report a
     * revoked / deleted certificate so a counterfeit cannot pass by reusing
     * an obsolete number.
     */
    async findByCertificateNumber(certificateNumber) {
        if (!certificateNumber) {return null;}
        // The paper prints GACP-DTAM-…; the register stores GACP-TH-… (ruling 2026-10-05).
        return prisma.certificate.findUnique({
            where: { certificateNumber: toCanonicalCertificateNumber(certificateNumber) },
        });
    }

    /**
     * BE-#4 — verify a certificate row has not been tampered with since issuance.
     * Recomputes the content-integrity hash from the live fields and compares it
     * to the stored documentHash.
     *
     * Returns one of:
     *   { status: 'VALID',     documentHash }            — recomputed === stored
     *   { status: 'TAMPERED',  expected, actual }        — mismatch
     *   { status: 'UNSIGNED' }                           — no hash, OR an unkeyed
     *                                                      (bare-hex legacy) hash (#619)
     *
     * @param {object} cert  a loaded Certificate row (must include the hashed fields)
     */
    verifyDocumentIntegrity(cert) {
        if (!cert) { return { status: 'UNSIGNED' }; }
        if (!cert.documentHash) { return { status: 'UNSIGNED' }; }
        // Gap-3 (#619): a bare-hex (UNKEYED SHA-256) documentHash gives ZERO
        // integrity under the #619 threat model — an actor with DB write recomputes
        // the unkeyed digest over the tampered fields and it verifies. So ONLY a
        // keyed HMAC (hmac-sha256: prefix) may yield VALID; ANY other stored hash is
        // UNSIGNED (no cryptographic integrity established from the hash — the RSA
        // signature is the real control). This closes the legacy-downgrade with no
        // attacker-controllable dependency (a prior attempt gated on issuedDate,
        // which is itself DB-writable). Legacy certs read UNSIGNED until backfilled
        // to a keyed HMAC (tracked: issue #804 — cert-hash backfill + legacy-drop).
        if (!cert.documentHash.startsWith(CERT_HASH_PREFIX)) {
            return { status: 'UNSIGNED' };
        }
        const recomputed = buildCertificateDocumentHash(cert);
        if (recomputed !== cert.documentHash) {
            // Hash mismatch is the strongest signal — a legally-binding field
            // was altered after issuance. Report it first (takes precedence over
            // revocation) so a tampered revoked row still reads TAMPERED.
            return { status: 'TAMPERED', expected: cert.documentHash, actual: recomputed };
        }
        // #16 (integrity-audit 2026-07-06): the hash matched, but the hash
        // deliberately does not cover status/revocation (see
        // isCertificateRevoked). Fail CLOSED on the LIVE revocation state so a
        // revoked cert — or an un-revoke that left the revocation markers — can
        // never surface the green 'VALID' integrity verdict. Consumers
        // (public.js) derive `hashValid = integrity.status === 'VALID'`, so this
        // flips the green chip off without any change to the route.
        if (isCertificateRevoked(cert)) {
            return { status: 'REVOKED', documentHash: recomputed };
        }
        return { status: 'VALID', documentHash: recomputed };
    }

    /**
     * RULING 2 — sign `certData.documentHash` and stamp the signature, the
     * algorithm, the key id AND the verifying public key onto the row-to-be.
     * Throws CERT_SIGNING_UNAVAILABLE (503) if any of that cannot be done.
     *
     * Three ways this refuses, all of them fail-closed:
     *   1. the signer throws (no key, wrong passphrase, unreadable mount);
     *   2. the signer returns nothing;
     *   3. the signature does not verify against the public key we are about to
     *      pin. (3) is the one that makes the pinned column trustworthy: it is
     *      a real sign→verify round-trip, so a namespace/key mismatch can never
     *      write a row whose own key fails to verify it.
     *
     * Mutates `certData` in place — the caller passes the object it is about to
     * hand to `certificate.create`, so there is no window in which a partially
     * signed record could be persisted.
     *
     * @param {Object} certData - certificate row under construction (must carry documentHash)
     * @param {String} certNumber - for the operator-facing log line
     * @returns {Promise<void>}
     */
    async signCertificateDataOrThrow(certData, certNumber) {
        const { getSignatureService, fingerprintPublicKey } = require('./crypto/signature-service');
        const refuse = (reason, cause) => {
            logger.error(
                `[Certificate] PKI signing unavailable for ${certNumber} — issuance REFUSED (fail-closed): ${reason}`,
            );
            const err = new Error(
                `Refusing to issue certificate ${certNumber}: the digital signature could not be produced `
                + `(${reason}). A GACP certificate without its signature cannot be verified by a third party, `
                + 'so nothing was written. Restore the signing key and retry the audit result.',
            );
            err.code = 'CERT_SIGNING_UNAVAILABLE';
            err.statusCode = 503;
            if (cause) { err.cause = cause; }
            return err;
        };

        const signatureService = getSignatureService();
        let signature;
        let publicKeyPem;
        try {
            signature = await signatureService.signWithLocalKey(certData.documentHash, CERT_KEY_NAMESPACE);
            publicKeyPem = await signatureService.getPublicKeyForNamespace(CERT_KEY_NAMESPACE);
        } catch (signErr) {
            throw refuse(signErr.message, signErr);
        }
        if (!signature) {
            throw refuse('the signer returned an empty signature');
        }
        if (!publicKeyPem) {
            throw refuse('no public key is available to pin on the certificate');
        }

        const selfVerifies = await signatureService.verifyWithLocalKey(
            certData.documentHash, signature, publicKeyPem,
        );
        if (!selfVerifies) {
            throw refuse('the signature does not verify against the public key it would be stored with');
        }

        // ISSUANCE ASKS THE VERIFIER'S QUESTION (G4 walk, 2026-08-25).
        //
        // The check above only asks "does this signature match the key I am about to
        // pin?" — trivially true, because that key just produced it. Any key passes,
        // including a throwaway pair this process generated at boot because
        // keys/private.pem could not be decrypted. verifyCertificateSignature asks a
        // second, harder question — is the pinned key one the DEPLOYMENT vouches for —
        // and answers { valid: false, reason: 'untrusted_pinned_key' } when it is not.
        //
        // With only the first question at issuance, the platform can mint a certificate
        // it will itself later call invalid: the row looks perfect, the warning lands in
        // a log nobody reads, and the failure surfaces when a buyer scans the QR. That
        // happened to a real certificate in the G4 walk.
        //
        // So the trust anchor is consulted BEFORE anything is written, and the namespace
        // is the CONSTANT — never a value carried on the row, which would let the data
        // being signed choose the key that vouches for it.
        const trusted = await signatureService.getTrustedPublicKeyFingerprints(CERT_KEY_NAMESPACE);
        const fingerprint = fingerprintPublicKey(publicKeyPem);
        if (!trusted || !trusted.has(fingerprint)) {
            throw refuse(
                `the signing key (sha256 ${fingerprint}) is not one this deployment trusts — `
                + 'it is neither the configured signing key nor a declared retired one, so a certificate '
                + 'signed with it would fail verification the first time anyone checked it',
            );
        }

        certData.signature = signature;
        certData.signatureAlgorithm = CERT_SIGNATURE_ALGORITHM;
        certData.signatureKeyId = CERT_KEY_NAMESPACE;
        // RULING 2 / defect 3 — the row carries the key that verifies it, so
        // verification survives key rotation and machine moves.
        certData.signaturePublicKey = publicKeyPem;
    }

    /**
     * CERT-01 — verify the certificate's PKI digital signature over its
     * documentHash. Complements verifyDocumentIntegrity (hash recompute): this
     * proves the signature was produced by the certifying authority's private
     * key (non-repudiation), not just that the row is internally consistent.
     *
     * Returns:
     *   { signed: false }                         — no PKI signature (legacy / hash-only)
     *   { signed: true, valid: true, algorithm }  — RSA signature verifies over documentHash
     *   { signed: true, valid: false }            — signature present but does NOT verify (forged/tampered)
     *
     * Async (RSA verify loads the public key). The hash-level
     * verifyDocumentIntegrity stays synchronous for its existing callers.
     */
    async verifyCertificateSignature(cert) {
        if (!cert || !cert.signature || !cert.documentHash) {
            return { signed: false };
        }
        try {
            const { getSignatureService, fingerprintPublicKey } = require('./crypto/signature-service');
            const signatureService = getSignatureService();
            // RULING 2 — verify against the public key PINNED ON THE ROW when
            // it has one. Before this, verification always used whatever key
            // was loaded on the box TODAY, so rotating the key, rebuilding the
            // container or moving machines made every previously-issued
            // certificate read as forged. Rows issued before the expand
            // migration have no pinned key; they fall back to the loaded key,
            // which is exactly the old behaviour and no worse for them.
            //
            // FIX ROUND (security review) — the pinned key needs a TRUST ANCHOR.
            // It sits on the same row as `signature` and `documentHash`, so
            // taken at face value it proves nothing: anyone able to write a
            // certificate row can generate a keypair, sign the stored hash with
            // it, pin their own PEM, and this method would answer valid:true
            // carrying THEIR fingerprint — which public.js publishes as
            // sealed:true / signatureValid:true. The signature genuinely
            // verifies; the missing question is whether the key is ours.
            //
            // So the pinned key is honoured only when its fingerprint is in the
            // set the deploy configuration vouches for (current key + operator
            // pin + declared retired keys). The registry IS the trust anchor —
            // the first round argued the opposite and was wrong. Machine-move
            // survival is unaffected: moving the mount keeps the same
            // fingerprint, and a real rotation is declared via
            // SIGNING_KEY_RETIRED_FINGERPRINTS.
            //
            // The namespace used to build the set is the CONSTANT
            // CERT_KEY_NAMESPACE, never `cert.signatureKeyId` — that column is
            // row data too, and letting it steer key selection would hand part
            // of the anchor back to the attacker.
            const pinnedPublicKey = cert.signaturePublicKey || null;
            if (pinnedPublicKey) {
                const trusted = await signatureService.getTrustedPublicKeyFingerprints(CERT_KEY_NAMESPACE);
                const pinnedFingerprint = fingerprintPublicKey(pinnedPublicKey);
                if (!trusted.has(pinnedFingerprint)) {
                    logger.warn(
                        `[Certificate] rejected an untrusted pinned public key on ${cert.certificateNumber || cert.id || 'a certificate'} `
                        + `(sha256 ${pinnedFingerprint}); it is neither the current signing key nor a declared retired one.`,
                    );
                    return {
                        signed: true,
                        valid: false,
                        reason: 'untrusted_pinned_key',
                        algorithm: cert.signatureAlgorithm || CERT_SIGNATURE_ALGORITHM,
                        // Attest nothing: this key did not earn a fingerprint on
                        // the public response.
                        publicKeyFingerprint: null,
                    };
                }
            }
            const ok = await signatureService.verifyWithLocalKey(
                cert.documentHash, cert.signature, pinnedPublicKey,
            );
            // H1: surface the verifying public-key fingerprint (sha256 hex of the
            // public key) so the public verify response can attest WHICH key
            // signed. It must describe the key that ACTUALLY verified — for a
            // pinned row that is the row's key, not the box's. Derivation is
            // shared with the boot-time fingerprint guard (one definition), and
            // is byte-identical to the previous inline sha256 for LF PEMs, so
            // fingerprints already published do not change. Best-effort — a
            // fingerprint failure must never flip the signature verdict.
            let publicKeyFingerprint = null;
            try {
                const publicKey = pinnedPublicKey || await signatureService.getPublicKey();
                if (publicKey) {
                    publicKeyFingerprint = fingerprintPublicKey(publicKey);
                }
            } catch (fpErr) {
                logger.warn(`[Certificate] public-key fingerprint derive failed: ${fpErr.message}`);
            }
            return {
                signed: true,
                valid: !!ok,
                algorithm: cert.signatureAlgorithm || CERT_SIGNATURE_ALGORITHM,
                publicKeyFingerprint,
            };
        } catch (err) {
            logger.warn(`[Certificate] PKI signature verify failed: ${err.message}`);
            return { signed: true, valid: false, error: 'VERIFY_ERROR' };
        }
    }

    /**
     * Provider-facing dashboard aggregation for active certificates.
     * Returns { totalActive, expiring30Days, expiring90Days, byStandard,
     *   byProvince, expiringList } in one round trip.
     * Used by routes/api/provider/handlers/certificates.js (batch 10
     * Prisma-bypass cleanup). Status='active' is matched as a string (not
     * the enum constant) to match the seed data — the service centralises
     * that quirk so routes don't drift.
     */
    async getProviderDashboardAggregates({ now, expiring30Cutoff, expiring90Cutoff, listLimit = 50 } = {}) {
        const activeWhere = { isDeleted: false, status: 'active', expiryDate: { gt: now } };
        return Promise.all([
            prisma.certificate.count({ where: activeWhere }),
            prisma.certificate.count({
                where: { ...activeWhere, expiryDate: { gt: now, lte: expiring30Cutoff } },
            }),
            prisma.certificate.count({
                where: { ...activeWhere, expiryDate: { gt: now, lte: expiring90Cutoff } },
            }),
            prisma.certificate.groupBy({
                by: ['standardName'],
                where: activeWhere,
                _count: { id: true },
            }),
            prisma.certificate.groupBy({
                by: ['province'],
                where: activeWhere,
                _count: { id: true },
            }),
            prisma.certificate.findMany({
                where: { ...activeWhere, expiryDate: { gt: now, lte: expiring90Cutoff } },
                include: { user: { select: { email: true, firstName: true, lastName: true, phoneNumber: true } } },
                orderBy: { expiryDate: 'asc' },
                take: listLimit,
            }),
        ]);
    }

    /**
     * Active certificates expiring inside a window — used by the
     * bulk-notify admin route to fan out renewal reminders.
     */
    async listExpiringActiveCertificates({ now, cutoff, take = 500 } = {}) {
        return prisma.certificate.findMany({
            where: {
                isDeleted: false,
                status: 'active',
                expiryDate: { gt: now, lte: cutoff },
            },
            select: {
                id: true,
                userId: true,
                certificateNumber: true,
                expiryDate: true,
                farmName: true,
            },
            take,
        });
    }

    /**
     * Idempotency check used by audit-result handling. Returns the existing
     * certificate row (or null) so the audit/audits.js post-pass flow can
     * decide whether to call generateCertificate(). Centralising here
     * keeps the lookup query out of the route file (batch 11).
     */
    async findCertificateForApplication(applicationId, { prisma: client } = {}) {
        if (!applicationId) {return null;}
        // Only a live (non-deleted) cert dedupes issuance. A cert voided by an
        // audit-pass reversal is soft-deleted, so a later re-pass mints a fresh one.
        //
        // #17 (integrity-audit 2026-07-06): the probe MUST also ignore a
        // human-REVOKED cert. `revokeCertificate` (the operator/interop revoke)
        // keeps isDeleted:false on purpose (MF-1: so it stays visible as REVOKED
        // on public verify), so an isDeleted-only filter returns the revoked cert
        // here → the writer's idempotency probe (application-status-writer.js)
        // treats it as an existing cert and SKIPS generateCertificate → a
        // re-passed application can never get its valid replacement. Mirror
        // generateCertificate's own status-aware dedupe (`status notIn
        // ['revoked','REVOKED']`) so a revoked cert never blocks a fresh one.
        // 2026-09-05: read through the CALLER'S client when one is given. BE-T1 already
        // threads the caller's transaction into generateCertificate, and a probe that
        // reads the singleton while the issuance writes the transaction is two lines
        // looking at two different databases — which is precisely the double-issue /
        // skipped-issue this probe exists to prevent. voidCertificateForApplication
        // takes the same option for the same reason.
        const db = client || prisma;
        return db.certificate.findFirst({
            where: { applicationId, isDeleted: false, status: { notIn: ['revoked', 'REVOKED'] } },
            orderBy: { createdAt: 'desc' },
        });
    }

    /**
     * Void the certificate auto-issued for an application when an audit pass is
     * reversed (auditor reject-to-auditor: AUDIT_PASSED -> CAR_REVIEWING). The
     * cert is status-flipped to 'revoked' (forensic who/why/when) AND soft-deleted
     * so the issuance dedupe (findCertificateForApplication / generateCertificate,
     * both filter isDeleted:false) lets a later re-pass mint a fresh certificate.
     * The row is retained per the cert retention policy — never hard-deleted.
     *
     * @param {string} applicationId
     * @param {{ revokedBy?: string, reason?: string, prisma?: object }} [opts]
     *   Pass a transaction handle as `prisma` to commit atomically with the
     *   status revert.
     * @returns {Promise<object|null>} the voided cert, or null if none existed
     */
    async revokeCertificateForApplication(applicationId, opts = {}) {
        if (!applicationId) {return null;}
        const client = opts.prisma || prisma;
        const revokedBy = opts.revokedBy || 'system';
        const reason = opts.reason || 'Audit pass reversed';

        // #15 (integrity-audit 2026-07-06): reversing a pass MUST invalidate the
        // audit-pass record, otherwise a later force/path can re-mint a
        // certificate off the STALE pass. generateCertificate's hasPassRecord
        // gate reads BOTH the column (Application.auditResult) and the JSON
        // (formData.auditResult + formData.auditedAt), so clear both — re-issuance
        // after this reversal then requires a FRESH AUDIT_PASSED (which re-writes
        // the pass record). This runs whether or not a live cert exists (a pass
        // may be reversed before a cert was minted). Both reversal callers —
        // auditor.js reject-to-auditor and the canonical workflow handler — route
        // through this method inside their $transaction, so the clear commits
        // atomically with the status revert.
        //
        // Capability-guarded: some tx stubs only surface `certificate`. In
        // production the tx/client always carries `application`. A clear failure
        // is logged (golden rule #3) but does NOT abort the in-flight status
        // revert — it is surfaced for ops rather than silently swallowed.
        if (client.application && typeof client.application.update === 'function') {
            try {
                let clearedFormData;
                if (typeof client.application.findUnique === 'function') {
                    const appRow = await client.application.findUnique({
                        where: { id: applicationId },
                        select: { formData: true },
                    });
                    if (appRow && appRow.formData && typeof appRow.formData === 'object') {
                        clearedFormData = { ...appRow.formData };
                        delete clearedFormData.auditResult;
                        delete clearedFormData.auditedAt;
                    }
                }
                await client.application.update({
                    where: { id: applicationId },
                    data: {
                        auditResult: null,
                        ...(clearedFormData ? { formData: clearedFormData } : {}),
                    },
                });
            } catch (clearErr) {
                logger.error(
                    `[certificate-service] failed to clear audit-pass record on reversal for ${applicationId}: ${clearErr?.message || clearErr}`,
                );
            }
        }

        const cert = await client.certificate.findFirst({
            where: { applicationId, isDeleted: false },
            orderBy: { createdAt: 'desc' },
        });
        if (!cert) {return null;}
        const now = new Date();
        return client.certificate.update({
            where: { id: cert.id },
            data: {
                status: 'revoked',
                revokedAt: now,
                revokedBy,
                revokedReason: reason,
                isDeleted: true,
                deletedAt: now,
                deleteReason: reason,
            },
        });
    }

    /**
     * Admin/operator revoke of a certificate by id OR certificateNumber
     * (bugs 1.2 / 6.4 / 7.1). Distinct from `revokeCertificateForApplication`
     * (the automated audit-pass-reversal void); this is the human-initiated
     * revocation surfaced through the interoperability route.
     *
     *   1.2 ORG-GUARD — a tenant ADMIN may only revoke a cert in their OWN org.
     *       A cross-tenant attempt (or a missing cert) throws the SAME 404-mapped
     *       error so the caller cannot probe another tenant's cert existence.
     *       Only PLATFORM_ADMIN (crossTenant:true) bypasses the org check.
     *   6.4 soft-delete — sets isDeleted:true so the issuance dedupe frees a
     *       replacement cert (and the dedupe is also status-aware, above).
     *   7.1 audit — records CERTIFICATE_REVOKED via _auditCertLifecycle.
     *
     * @param {string} idOrNumber                certificate id or certificateNumber
     * @param {object} opts
     * @param {string} opts.reason               required, non-empty
     * @param {string} opts.actorId              acting user id (for audit)
     * @param {string} [opts.callerOrganizationId] the caller's org (org-guard)
     * @param {boolean} [opts.crossTenant=false] PLATFORM_ADMIN bypass
     * @param {object} [opts.prisma]             optional tx handle
     * @returns {Promise<object>} the revoked certificate row
     * @throws  {Error} with `statusCode` 400 (missing reason) / 404 (not found
     *          OR cross-tenant — indistinguishable by design) / 409 (already
     *          revoked — the existing revocation record is never re-stamped)
     */
    async revokeCertificate(idOrNumber, opts = {}) {
        const { reason, actorId = 'SYSTEM', callerOrganizationId = null, crossTenant = false } = opts;
        const client = opts.prisma || prisma;

        const key = idOrNumber != null ? String(idOrNumber).trim() : '';
        const numberKey = toCanonicalCertificateNumber(key);
        if (!key) {
            throw Object.assign(new Error('Certificate id or number is required'), { statusCode: 400 });
        }

        const cleanReason = reason != null ? String(reason).trim() : '';
        if (!cleanReason) {
            throw Object.assign(new Error('A revocation reason is required'), { statusCode: 400 });
        }

        // Resolve by certificateNumber first (the interop route's key), then by
        // id. NOT filtered by isDeleted — a soft-deleted row must still answer
        // (404 for a stranger, 409 once revoked), never silently re-resolve to
        // "missing"; the org-guard below is the access control.
        let cert = await client.certificate.findUnique({ where: { certificateNumber: numberKey } })
            .catch(() => null);
        if (!cert) {
            cert = await client.certificate.findFirst({ where: { id: key } });
        }

        // 404 for a genuinely-missing cert.
        const notFound = () => Object.assign(new Error('Certificate not found'), { statusCode: 404 });
        if (!cert) {
            throw notFound();
        }

        // 1.2 ORG-GUARD (SF-1: fail-CLOSED). Same 404 for a cross-tenant cert
        // (no existence disclosure). A non-crossTenant caller MUST present an
        // organizationId — a falsy one is rejected, never allowed through (prod
        // RLS is decorative, so this app-layer guard is the sole tenant wall).
        // PLATFORM_ADMIN (crossTenant) skips the check.
        if (!crossTenant) {
            if (!callerOrganizationId || cert.organizationId !== callerOrganizationId) {
                throw notFound();
            }
        }

        // Already revoked → 409. The revocation record (revokedAt/revokedBy/
        // revokedReason) is the ISO/IEC 17065 §7.11 record of decision; a
        // second press must never overwrite who/when/why. Checked AFTER the
        // org-guard so a stranger still gets the 404 (no existence disclosure).
        const alreadyRevoked = () => Object.assign(
            new Error('Certificate is already revoked'),
            { statusCode: 409, code: 'CERTIFICATE_ALREADY_REVOKED' },
        );
        if (REVOKED_STATUSES.includes(String(cert.status || ''))) {
            throw alreadyRevoked();
        }

        const now = new Date();
        let updated;
        try {
            updated = await client.certificate.update({
                // Atomic guard (same shape as suspendCertificate): the stamp only
                // lands on a row that is not yet revoked. Two concurrent presses
                // both pass the read above; the loser matches no row here and
                // Prisma throws P2025, mapped to the same 409.
                where: { id: cert.id, status: { notIn: REVOKED_STATUSES } },
                data: {
                    // canonical lowercase 'revoked' — matches revokeCertificateForApplication.
                    status: 'revoked',
                    revokedAt: now,
                    revokedBy: actorId,
                    revokedReason: cleanReason,
                    updatedBy: actorId,
                    // MF-1: do NOT soft-delete a revoked cert. isDeleted:true would make
                    // it VANISH from the public verify / interop endpoints (they filter
                    // isDeleted:false and classify isDeleted → INVALID before REVOKED),
                    // reporting "never existed" instead of "REVOKED" — defeating the
                    // counterfeit-detection intent. Re-issuance is freed purely by the
                    // status-aware issuance dedupe (status notIn ['revoked','REVOKED']),
                    // so soft-delete is unnecessary. The row stays visible as REVOKED.
                },
            });
        } catch (err) {
            if (err?.code === 'P2025') {
                throw alreadyRevoked();
            }
            throw err;
        }

        // 7.1: best-effort lifecycle audit (swallows its own errors).
        await this._auditCertLifecycle('CERTIFICATE_REVOKED', updated, { reason: cleanReason, actorId });

        return updated;
    }

    // ------------------------------------------------------------------
    // ฉบับแก้ไขภายใต้เลขเดิม — certificate revision.
    // Spec: design note 2026-08-27-certificate-revision-design §3.
    //
    // A live certificate whose location facts are wrong (the retired
    // 'Unknown' / '-' stand-ins, or a farm row corrected after issuance) keeps
    // its number, QR and cycles; the signed original is archived verbatim as
    // revision n and the corrected content is re-signed as revision n+1. The
    // corrected values come from the FARM ROW ONLY — the admin never types a
    // register value. Steps 1-3 read; step 4 archives + rewrites + re-signs in
    // ONE transaction.
    // ------------------------------------------------------------------

    /**
     * The row a revision acts on: the live certificate with its farm and the
     * application's wizard answers (formData carries the plant reference,
     * F-G4-58), never a soft-deleted one. One lookup shape, shared by preview
     * and revise.
     * @private
     */
    async _loadCertificateForRevision(certificateId, client) {
        return client.certificate.findFirst({
            where: { id: certificateId, isDeleted: false },
            include: { farm: true, application: { select: { formData: true } } },
        });
    }

    /**
     * Spec steps 1-3 (read only): org-guard, status gate, the corrected
     * location from the farm row, the corrected plant name from the master,
     * the diff against the certificate.
     *
     * @param {object} cert  as loaded by _loadCertificateForRevision
     * @param {{ callerOrganizationId?: string|null, crossTenant?: boolean, client?: object }} [opts]
     *   client: the Prisma client (or tx) the plant master is read through
     * @returns {Promise<{ current: object, corrected: object, changed: string[] }>}
     *   current / corrected carry every CERTIFICATE_REVISION_FIELDS key;
     *   changed lists the ones whose value differs.
     * @throws {Error} statusCode 404 'Certificate not found' — missing, soft-deleted
     *   OR another tenant's (indistinguishable by design, same as revokeCertificate);
     *   409 CERTIFICATE_NOT_REVISABLE — status is not 'active', or expiryDate has passed;
     *   422 CERTIFICATE_FARM_LOCATION_MISSING — the farm row itself lacks a fact;
     *   422 CERTIFICATE_PLANT_UNKNOWN — the application's plant is not in the master.
     * @private
     */
    async _resolveRevisionTarget(cert, { callerOrganizationId = null, crossTenant = false, client = prisma } = {}) {
        const notFound = () => Object.assign(new Error('Certificate not found'), { statusCode: 404 });
        if (!cert) {
            throw notFound();
        }
        // ORG-GUARD (fail-closed, same shape as revokeCertificate 1.2): a
        // non-crossTenant caller must present the certificate's own org.
        if (!crossTenant) {
            if (!callerOrganizationId || cert.organizationId !== callerOrganizationId) {
                throw notFound();
            }
        }
        // Only a certificate in force is corrected; a revoked / suspended /
        // expired / renewed one keeps its history as it stands.
        if (String(cert.status || '').toLowerCase() !== 'active') {
            throw Object.assign(
                new Error('Only a certificate in force (status active) can be revised'),
                { statusCode: 409, code: 'CERTIFICATE_NOT_REVISABLE' },
            );
        }
        // Nothing writes status 'expired': the register derives it from
        // expiryDate at read time (routes/api/certificates/certificates.js), so
        // a certificate past its date still carries status 'active' and the
        // status gate alone would re-sign a dead document under its number.
        if (cert.expiryDate && new Date(cert.expiryDate) < new Date()) {
            throw Object.assign(
                new Error('Only a certificate in force can be revised; this one is past its expiryDate'),
                { statusCode: 409, code: 'CERTIFICATE_NOT_REVISABLE' },
            );
        }
        // The corrected location, through the F-G4-52 rules: a blank or a
        // retired stand-in on the farm row is a missing fact, so a refusal.
        const farm = cert.farm;
        const missing = missingLocationFields(farm, CERTIFICATE_LOCATION_FIELDS);
        if (missing.length > 0) {
            throw refuseFarmLocation(missing, { applicationId: cert.applicationId, farmId: cert.farmId, action: 'revision' });
        }
        // F-G4-58: the plant name from the master, through the application's
        // wizard answer. An unknown plant refuses here, before anything is
        // written; the certificate's own cropType column is never a source.
        const cropType = await resolveCertificatePlantName(cert.application?.formData, {
            applicationId: cert.applicationId,
            action: 'revision',
            client,
        });
        const corrected = {
            province: normalizeText(farm.province),
            district: normalizeText(farm.district),
            subDistrict: normalizeText(farm.subDistrict),
            address: isLocationFactMissing(farm.address) ? null : normalizeText(farm.address),
            cropType,
        };
        const current = {
            province: cert.province ?? null,
            district: cert.district ?? null,
            subDistrict: cert.subDistrict ?? null,
            address: cert.address ?? null,
            cropType: cert.cropType ?? null,
        };
        const changed = CERTIFICATE_REVISION_FIELDS.filter((field) => current[field] !== corrected[field]);
        return { current, corrected, changed };
    }

    /**
     * What a revision WOULD change — spec steps 1-3 only, nothing written.
     * Same refusals as reviseCertificateFromFarm except NO_CHANGE, which is
     * reported as `changed: []` so the admin door can say so before the press.
     *
     * @param {string} certificateId
     * @param {{ callerOrganizationId?: string, crossTenant?: boolean, prisma?: object }} [opts]
     * @returns {Promise<{ current: object, corrected: object, changed: string[] }>}
     */
    async previewCertificateRevision(certificateId, opts = {}) {
        const { callerOrganizationId = null, crossTenant = false } = opts;
        const client = opts.prisma || prisma;
        const cert = await this._loadCertificateForRevision(certificateId, client);
        return this._resolveRevisionTarget(cert, { callerOrganizationId, crossTenant, client });
    }

    /**
     * Issue revision n+1 of a live certificate from its farm row.
     *
     * @param {string} certificateId
     * @param {object} opts
     * @param {string} opts.actorId                 admin user id — supersededBy / revisedBy / signedBy
     * @param {string} [opts.reason]                the admin's words; archived, never public
     * @param {string} [opts.callerOrganizationId]  the caller's org (org-guard)
     * @param {boolean} [opts.crossTenant=false]    PLATFORM_ADMIN bypass
     * @param {object} [opts.prisma]                injectable client
     * @returns {Promise<{ certificate: object, previousRevisionNo: number, correctedFields: string[] }>}
     * @throws {Error} 404 (missing / cross-tenant) · 409 CERTIFICATE_NOT_REVISABLE ·
     *   422 CERTIFICATE_FARM_LOCATION_MISSING · 422 CERTIFICATE_PLANT_UNKNOWN ·
     *   409 CERTIFICATE_REVISION_NO_CHANGE · 503 CERT_SIGNING_UNAVAILABLE (nothing
     *   written) · 409 CERTIFICATE_REVISION_CONFLICT (lost the revisionNo race; the
     *   transaction rolled back)
     */
    async reviseCertificateFromFarm(certificateId, opts = {}) {
        const { actorId, reason, callerOrganizationId = null, crossTenant = false } = opts;
        const client = opts.prisma || prisma;
        if (!actorId) {
            throw Object.assign(new Error('actorId is required to issue a revision'), { statusCode: 400 });
        }

        const cert = await this._loadCertificateForRevision(certificateId, client);
        const { current, corrected, changed } = await this._resolveRevisionTarget(cert, { callerOrganizationId, crossTenant, client });
        if (changed.length === 0) {
            throw Object.assign(
                new Error('The farm record and the certificate already agree; there is nothing to revise'),
                { statusCode: 409, code: 'CERTIFICATE_REVISION_NO_CHANGE' },
            );
        }

        const now = new Date();
        const previousRevisionNo = cert.revisionNo || 1;
        const nextRevisionNo = previousRevisionNo + 1;
        const reasonCode = REVISION_REASON_CODES.SYSTEM_DATA_CORRECTION;
        const reasonText = reason != null ? String(reason).trim() : '';

        // 4b — the corrected document, hashed and signed BEFORE the transaction
        // opens: a signing refusal (untrusted key) writes nothing at all.
        // The relations rode along for the read only; the row-to-be carries columns.
        const { farm: _farm, application: _application, ...certRow } = cert;
        const nextContent = { ...certRow, ...corrected, signedAt: now, signedBy: actorId };
        nextContent.documentHash = buildCertificateDocumentHash(nextContent);
        await this.signCertificateDataOrThrow(nextContent, cert.certificateNumber);

        // 4a — the archived document: every canonical field plus address,
        // exactly as they stood when the previous revision was signed.
        const snapshot = { ...JSON.parse(certificateCanonicalJson(cert)), address: current.address };

        const revisionConflict = () => Object.assign(
            new Error('Another revision of this certificate was recorded first'),
            { statusCode: 409, code: 'CERTIFICATE_REVISION_CONFLICT' },
        );

        const updated = await client.$transaction(async (tx) => {
            // 4c FIRST — conditional on the revisionNo read in step 1. Two
            // concurrent presses both pass the read; under READ COMMITTED the
            // loser's UPDATE waits on the winner's row lock, re-checks the WHERE
            // against the committed row (revisionNo already bumped) and matches
            // nothing, so count 0 is the lost race. Running the archive insert
            // first would instead land the loser on the UNIQUE (certificateId,
            // revisionNo) index as a raw P2002 and never reach this check.
            const res = await tx.certificate.updateMany({
                where: { id: cert.id, revisionNo: previousRevisionNo },
                data: {
                    ...corrected,
                    documentHash: nextContent.documentHash,
                    signature: nextContent.signature,
                    signatureAlgorithm: nextContent.signatureAlgorithm,
                    signatureKeyId: nextContent.signatureKeyId,
                    signaturePublicKey: nextContent.signaturePublicKey,
                    signedBy: actorId,
                    signedAt: now,
                    revisionNo: nextRevisionNo,
                    revisedAt: now,
                    revisedBy: actorId,
                    revisionReason: reasonCode,
                    // The PDF is regenerated from the corrected content on the next download.
                    pdfGenerated: false,
                    pdfGeneratedAt: null,
                    updatedBy: actorId,
                },
            });
            if (res.count !== 1) {
                throw revisionConflict();
            }
            // 4a — the winner archives the document it just superseded. The
            // UNIQUE (certificateId, revisionNo) index is the last line: a
            // violation naming that key is the same lost race (a revision row
            // for this number already exists), so it is refused with the
            // catalogued 409 and the transaction (the update included) rolls
            // back. Any other P2002 is not ours and surfaces untouched.
            try {
                await tx.certificateRevision.create({
                    data: {
                        certificateId: cert.id,
                        revisionNo: previousRevisionNo,
                        snapshot,
                        documentHash: cert.documentHash ?? null,
                        signature: cert.signature ?? null,
                        signatureAlgorithm: cert.signatureAlgorithm ?? null,
                        signatureKeyId: cert.signatureKeyId ?? null,
                        signaturePublicKey: cert.signaturePublicKey ?? null,
                        signedBy: cert.signedBy ?? null,
                        signedAt: cert.signedAt ?? null,
                        supersededAt: now,
                        supersededBy: actorId,
                        reasonCode,
                        reasonText: reasonText || null,
                        correctedFields: changed,
                        organizationId: cert.organizationId,
                    },
                });
            } catch (error) {
                if (isRevisionKeyCollision(error)) {
                    throw Object.assign(revisionConflict(), { cause: error });
                }
                throw error;
            }
            const row = await tx.certificate.findUnique({ where: { id: cert.id } });
            return row || { ...nextContent, revisionNo: nextRevisionNo, revisedAt: now, revisedBy: actorId, revisionReason: reasonCode };
        });

        // 5 — best-effort lifecycle audit (swallows its own errors).
        await this._auditCertLifecycle('CERTIFICATE_REVISED', updated, {
            reason: reasonText || null,
            actorId,
            extra: { reasonCode, revisionNo: nextRevisionNo, previousRevisionNo, correctedFields: changed },
        });

        return { certificate: updated, previousRevisionNo, correctedFields: changed };
    }

    /**
     * Best-effort audit record for a certificate lifecycle transition.
     * Lazy-requires the audit logger so a logging outage (or a require cycle)
     * can never block the compliance transition itself. ISO/IEC 17065 §7.11
     * requires a documented record of suspension / reinstatement decisions.
     * `extra` is folded into metadata (a revision records its numbers there).
     * @private
     */
    async _auditCertLifecycle(action, cert, { reason = null, actorId = null, extra = {} } = {}) {
        try {
            const mod = require('../middleware/audit-logger');
            if (!mod || !mod.auditLogger) { return; }
            await mod.auditLogger.log({
                category: mod.AuditCategory?.CERTIFICATE || 'CERTIFICATE',
                action,
                severity: mod.AuditSeverity?.WARNING || 'WARNING',
                actorId: actorId || 'SYSTEM',
                actorType: 'USER',
                resourceType: 'CERTIFICATE',
                resourceId: cert?.id || null,
                organizationId: cert?.organizationId || null,
                metadata: {
                    certificateNumber: cert?.certificateNumber || null,
                    status: cert?.status || null,
                    reason,
                    ...extra,
                },
            });
        } catch (_) { /* audit failure must never block the lifecycle transition */ }
    }

    /**
     * Suspend an active certificate (ISO/IEC 17065 §7.11). Suspension is a
     * temporary, REVERSIBLE withdrawal: the certificate is no longer valid for
     * the suspension window but is NOT revoked and NOT soft-deleted, so it can
     * be reinstated to 'active' once the non-conformity is closed (or escalated
     * to 'revoked'). Distinct from `revokeCertificateForApplication`, which is
     * permanent + soft-deletes the row.
     *
     * Atomic guard: the update is scoped to `where:{ id, status:'active' }`, so
     * a concurrent suspend/revoke cannot double-transition — the race loser
     * matches no row, Prisma throws P2025, surfaced as CERTIFICATE_NOT_SUSPENDABLE.
     *
     * @param {string} certificateId
     * @param {{ reason: string, suspendedBy?: string, prisma?: object }} opts
     * @returns {Promise<object>} the suspended certificate row
     */
    async suspendCertificate(certificateId, opts = {}) {
        if (!certificateId) {
            throw Object.assign(new Error('certificateId is required'), { code: 'VALIDATION_ERROR' });
        }
        const reason = opts.reason != null ? String(opts.reason).trim() : '';
        if (reason.length < 3) {
            throw Object.assign(
                new Error('A suspension reason (min 3 chars) is required — ISO 17065 §7.11 record of decision'),
                { code: 'VALIDATION_ERROR' },
            );
        }
        const client = opts.prisma || prisma;
        const suspendedBy = opts.suspendedBy || 'system';
        const now = new Date();
        let suspended;
        try {
            suspended = await client.certificate.update({
                where: { id: certificateId, status: 'active', isDeleted: false },
                data: {
                    status: 'suspended',
                    suspendedAt: now,
                    suspendedBy,
                    suspendedReason: reason,
                },
            });
        } catch (err) {
            // P2025 = no { id, status:'active', isDeleted:false } row: the cert is
            // missing, soft-deleted, or already suspended/revoked/expired. Only an
            // ACTIVE certificate can be suspended.
            if (err?.code === 'P2025') {
                throw Object.assign(
                    new Error(`Certificate ${certificateId} is not in an 'active' state — cannot suspend`),
                    { code: 'CERTIFICATE_NOT_SUSPENDABLE' },
                );
            }
            throw err;
        }
        await this._auditCertLifecycle('CERTIFICATE_SUSPENDED', suspended, { reason, actorId: suspendedBy });
        return suspended;
    }

    /**
     * Reinstate a suspended certificate back to 'active' (ISO/IEC 17065 §7.11).
     * Only a 'suspended' certificate can be reinstated; a revoked one cannot.
     * The suspendedAt / suspendedBy / suspendedReason fields are RETAINED as the
     * historical record; reinstatedAt / reinstatedBy capture who lifted it.
     *
     * Atomic guard: scoped to `where:{ id, status:'suspended' }` → race loser
     * hits P2025 → CERTIFICATE_NOT_REINSTATABLE.
     *
     * @param {string} certificateId
     * @param {{ reinstatedBy?: string, prisma?: object }} opts
     * @returns {Promise<object>} the reinstated certificate row
     */
    async reinstateCertificate(certificateId, opts = {}) {
        if (!certificateId) {
            throw Object.assign(new Error('certificateId is required'), { code: 'VALIDATION_ERROR' });
        }
        const client = opts.prisma || prisma;
        const reinstatedBy = opts.reinstatedBy || 'system';
        const now = new Date();
        let reinstated;
        try {
            reinstated = await client.certificate.update({
                where: { id: certificateId, status: 'suspended', isDeleted: false },
                data: {
                    status: 'active',
                    reinstatedAt: now,
                    reinstatedBy,
                },
            });
        } catch (err) {
            if (err?.code === 'P2025') {
                throw Object.assign(
                    new Error(`Certificate ${certificateId} is not in a 'suspended' state — cannot reinstate`),
                    { code: 'CERTIFICATE_NOT_REINSTATABLE' },
                );
            }
            throw err;
        }
        await this._auditCertLifecycle('CERTIFICATE_REINSTATED', reinstated, { actorId: reinstatedBy });
        return reinstated;
    }

    /**
     * List active certification standards with their requirements.
     * Replaces the direct `prisma.certificationStandard.findMany` call in
     * `routes/api/certificates/standards.js` (was at line 13).
     *
     * @returns {Promise<Array>} standards sorted by sortOrder, each with
     *   its requirements (also sorted by sortOrder) included.
     */
    async listActiveStandards() {
        return prisma.certificationStandard.findMany({
            where: { isActive: true },
            include: {
                requirements: { orderBy: { sortOrder: 'asc' } },
            },
            orderBy: { sortOrder: 'asc' },
        });
    }

    /**
     * Generate PDF Buffer for a Certificate
     * @param {string} certificateId
     * @returns {Promise<Buffer>}
     */
    async getCertificatePdf(certificateId, { holderScope } = {}) {
        const { getPdfQueue } = require('./queue-service');
        const pdfQueue = getPdfQueue();

        if (pdfQueue) {
            logger.info(`[Certificate] Offloading PDF generation to worker for ID: ${certificateId}`);
            const job = await pdfQueue.add({ type: 'CERTIFICATE', payload: { certificateId: certificateId } });
            const resultBase64 = await job.finished();
            return Buffer.from(resultBase64, 'base64');
        }

        logger.warn(`[Certificate] PDF Queue not available, falling back to synchronous generation`);
        // A health request (the download door, after getCertificateForUser) reads
        // within the same holder scope; the worker and staff callers keep findUnique.
        const cert = isHolderScope(holderScope)
            ? await prisma.certificate.findFirst({
                // R1-legacy-pin: removed in Task 12 (→ holderReadWhere): the id the door
                // already resolved decides, as the pre-R1 findUnique did.
                where: { id: certificateId, ...holderAccess().r1HolderOrLegacy(holderScope, 'Certificate', { id: certificateId }) },
            })
            : await prisma.certificate.findUnique({ where: { id: certificateId } });
        if (!cert) { throw new Error('Certificate not found'); }

        const { generateCertificatePdf } = require('./pdf/certificate-template-service');
        return await generateCertificatePdf(cert);
    }

    /**
     * Public verifier (F-G4-57) — the certificate NUMBER of the renewal that
     * superseded a certificate, and nothing else about it.
     *
     * renewal-service's supersedeCertificate writes Certificate.status
     * 'renewed' together with Certificate.renewedCertificateId; the public
     * verify door reads that pointer so a citizen holding an obsolete QR is
     * sent to the current document instead of a bare "not valid".
     *
     * The `select` is the privacy control: the successor's own facts (farm,
     * province, status, dates) are NOT part of the superseded certificate's
     * public answer, so only the number may be read here.
     *
     * @param {string|null} renewedCertificateId
     * @returns {Promise<string|null>} the successor's certificateNumber, or null
     *          when there is no pointer / the row is gone / it carries no number.
     */
    async findSuccessorCertificateNumber(renewedCertificateId) {
        if (!renewedCertificateId) { return null; }
        const successor = await prisma.certificate.findUnique({
            where: { id: renewedCertificateId },
            select: { certificateNumber: true },
        });
        return successor?.certificateNumber || null;
    }

    /**
     * Certificate revision — the public history of a certificate number: one
     * entry per ARCHIVED revision, ascending. Only the three public facts are
     * selected; reasonText (the admin's words) never leaves the archive.
     *
     * @param {string} certificateId
     * @returns {Promise<Array<{ no: number, signedAt: string|null, supersededAt: string|null }>>}
     */
    async listRevisionSummaries(certificateId) {
        const toIso = (d) => (d ? new Date(d).toISOString() : null);
        const rows = await prisma.certificateRevision.findMany({
            where: { certificateId },
            orderBy: { revisionNo: 'asc' },
            select: { revisionNo: true, signedAt: true, supersededAt: true },
        });
        return rows.map((r) => ({
            no: r.revisionNo,
            signedAt: toIso(r.signedAt),
            supersededAt: toIso(r.supersededAt),
        }));
    }

    /**
     * Certificate revision — verify an ARCHIVED revision as the document it
     * was when it was signed. The snapshot carries every canonical field (plus
     * address), and the proof columns were copied verbatim at archival, so the
     * same two verifiers the live row goes through apply unchanged: the hash
     * recompute matches iff the archive is intact, and the RSA signature is
     * checked against the key pinned on the archived row (trust-anchored the
     * same way as the live row's).
     *
     * @param {string} certificateId
     * @param {number} revisionNo  the archived revision number (1 = original issue)
     * @returns {Promise<{ found: false } | { found: true, revision: object, integrity: { status: string }, signature: { signed: boolean, valid?: boolean } }>}
     */
    async verifyArchivedRevision(certificateId, revisionNo) {
        const revision = await prisma.certificateRevision.findUnique({
            where: { certificateId_revisionNo: { certificateId, revisionNo } },
        });
        if (!revision) { return { found: false }; }
        const doc = {
            ...(revision.snapshot || {}),
            documentHash: revision.documentHash,
            signature: revision.signature,
            signatureAlgorithm: revision.signatureAlgorithm,
            signatureKeyId: revision.signatureKeyId,
            signaturePublicKey: revision.signaturePublicKey,
        };
        const integrity = this.verifyDocumentIntegrity(doc);
        const signature = await this.verifyCertificateSignature(doc);
        return { found: true, revision, integrity, signature };
    }
}

// M1 (2026-08-15): who a new certificate names as holder is decided here, once —
// application entity first, farm entity second, the frozen person name last (D1).
// Pure by design (no DB, no third argument): 'SYSTEM'/'E2E_BOT' provider callers
// can never become the submitter of record (D3).
function resolveHolderForIssuance(app, farm) {
    const personName = `${app.applicant.firstName} ${app.applicant.lastName}`;
    const entity = app.entity ?? farm?.entity ?? null;

    // มติ operator 2026-09-07: "บริษัท และวิสาหกิจชุมชน ผู้ถือจะต้องเป็นบริษัท หรือวิสาหกิจชุมชน
    // ห้ามเป็นบุคคล" (F-HOLDER-01)
    //
    // คำขอประกาศประเภทผู้ยื่นไว้บนกระดาษ ส่วนตัวตนที่ระบบใช้ออกใบคือ Entity ของคำขอ — สอง
    // อย่างนี้ไม่มีอะไรบังคับให้ตรงกัน คำขอของบริษัทที่ยื่นในนามบุคคลจึงเคยได้ใบรับรองที่บันทึก
    // ผู้ถือเป็น INDIVIDUAL พร้อมชื่อคนที่ล็อกอิน ทั้งที่ชื่อฟาร์มบนใบเป็นชื่อบริษัท — ผิดแบบที่
    // มองไม่เห็นบนหน้ากระดาษ และกระทบการโอน การเพิกถอน และความรับผิด
    //
    // ปฏิเสธ ไม่ใช่เดาแทน: ระบบไม่สร้างตัวตนทางกฎหมายให้ใครเอง ทางที่ถูกมีอยู่แล้ว —
    // /health/workspaces/new สร้าง Entity ชนิดนิติบุคคล/วิสาหกิจชุมชน แล้วยื่นในพื้นที่นั้น
    const declaredType = String(app?.formData?.applicantType || '').trim().toUpperCase();
    if (declaredType === 'JURISTIC' || declaredType === 'COMMUNITY_ENTERPRISE') {
        if (!entity || String(entity.type || '').toUpperCase() !== declaredType) {
            const wording = declaredType === 'JURISTIC' ? 'นิติบุคคล' : 'วิสาหกิจชุมชน';
            logger.error(
                `[Certificate] Application ${app?.applicationNumber || app?.id} declares ${declaredType} `
                + `but its entity is ${entity ? entity.type : 'none'} — issuance REFUSED (fail-closed)`,
                { applicationId: app?.id || null },
            );
            const err = new Error(
                `ไม่สามารถออกใบรับรองได้ เนื่องจากคำขอนี้ระบุผู้ยื่นเป็น${wording} `
                + `แต่ยื่นในนามบุคคล ผู้ถือใบรับรองต้องเป็น${wording}เอง `
                + `กรุณาสร้างหรือสลับไปพื้นที่ทำงาน${wording} แล้วยื่นคำขอในพื้นที่นั้น`,
            );
            err.code = 'CERTIFICATE_HOLDER_MISMATCH';
            err.statusCode = 422;
            err.declaredApplicantType = declaredType;
            err.entityType = entity ? entity.type : null;
            throw err;
        }
    }

    return {
        holderDisplayName: entity ? entity.displayName : personName,
        holderType: entity ? entity.type : 'LEGACY_PERSON',
        submittedByUserId: app.submitterId ?? app.applicant.id,
    };
}

const _certificateServiceInstance = new CertificateService();
// BE-#4: expose the pure hash helper on the singleton so the public verifier
// and unit tests can recompute integrity without re-deriving the field list.
_certificateServiceInstance.buildCertificateDocumentHash = buildCertificateDocumentHash;
// #16: expose the pure revocation predicate so the verifier + tests can reuse
// the same live-revocation rule without re-deriving the marker list.
_certificateServiceInstance.isCertificateRevoked = isCertificateRevoked;
// M1: expose the pure holder resolver so unit tests exercise the exact
// production rule without a database.
_certificateServiceInstance.resolveHolderForIssuance = resolveHolderForIssuance;
// Certificate revision: the correctable field list and the Thai label of each
// reasonCode, so the admin door, the public verifier and the PDF print the same
// words without re-deriving them (reasonText, the admin's free text, is never
// exported anywhere public).
_certificateServiceInstance.CERTIFICATE_REVISION_FIELDS = CERTIFICATE_REVISION_FIELDS;
_certificateServiceInstance.REVISION_REASON_CODES = REVISION_REASON_CODES;
_certificateServiceInstance.REVISION_REASON_LABELS_TH = REVISION_REASON_LABELS_TH;
module.exports = _certificateServiceInstance;
