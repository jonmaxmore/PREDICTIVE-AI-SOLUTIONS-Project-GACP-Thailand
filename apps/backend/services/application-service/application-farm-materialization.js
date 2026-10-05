'use strict';

/**
 * HOW A FILING BECOMES A FARM — one field map, read by every submit door.
 *
 * A certificate names the place it certifies by reading the FARM row, never the
 * applicant's formData (certificate-service.resolveFarmForCertificate → the
 * CERTIFICATE_FARM_LOCATION_MISSING refusal). So a filing that cannot produce a farm
 * cannot be certified, however complete it is.
 *
 * F-QA-06 (Deep QA, staging application 0103079d, 2026-09-07): a filing walked through
 * the six-step wizard passed documents, both payments, audit scheduling, six GPS-tagged
 * onsite photographs and the full 24-item checklist — and the auditor's PASS answered
 *
 *     422 CERTIFICATE_FARM_LOCATION_MISSING — "ขาด ที่อยู่"
 *
 * The filing HELD the address the farmer typed at step 3. It held it under the กทล.๑
 * ส่วนที่ ๒ vocabulary the six-step wizard writes — `siteName` / `siteAddress` — and every
 * reader downstream was looking for the previous wizard's `farmName` / `address`. The v1
 * door (application-submission-methods.executeWizardSubmission) mints the farm inside its
 * own submit transaction; the v2 door (routes/api/applications/applications.js POST
 * /submit) never did, and nothing else on the line would.
 *
 * WHY THE MAP LIVES HERE AND NOT AT EITHER DOOR
 * Two copies of "which formData key feeds which Farm column" is precisely the defect
 * this platform keeps paying for: the PDF renderer learned the v2 spellings
 * (katorlor1-template-service.farmForForm), the submit validator learned them
 * (canonical-application-validator step 5), and the two farm writers did not. The map is
 * written once, here, reading BOTH eras' spellings — new vocabulary first, previous one
 * as the fallback, exactly as the renderer and the validator already do.
 *
 * WHAT THIS MODULE REFUSES TO DO
 *   • invent a location. Farm.address / province / district / subDistrict are NOT NULL
 *     and are printed on a certificate as fact; a filing that does not state them gets
 *     no farm from this module (`materializeFarmForFiling` answers NOT_STATED) rather
 *     than a row full of stand-ins. The submit gate is what demands them from the
 *     farmer, in the words of their own form (canonicalStep5V2Schema).
 *   • guess a coordinate. Both halves or neither — shared/coordinates.js.
 *   • guess a cultivation method. The most controlled ลักษณะพื้นที่ the filing actually
 *     ticked, or nothing — shared/cultivation-method.js.
 */

const { AREA_UNIT } = require('../../shared/area-utils');
const { coordinatePairFrom } = require('../../shared/coordinates');
const { mostControlledMethod } = require('../../shared/cultivation-method');
const { submittedAreaSqm } = require('../certificate/submitted-area');

/**
 * What a Farm row cannot be born without. `postalCode` is NOT on this list on purpose:
 * the กทล.๑ form does not require it (canonicalStep5V2Schema leaves it optional) and the
 * certificate's own location gate does not read it (CERTIFICATE_LOCATION_FIELDS).
 */
const FILING_SITE_REQUIRED = Object.freeze(['farmName', 'address', 'province', 'district', 'subDistrict']);

function asObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asArray(value) {
    return Array.isArray(value) ? value : [];
}

/** Trimmed text, or '' — `0` is a value a farmer gave, `null` is not. */
function text(value) {
    if (value === null || value === undefined) { return ''; }
    return String(value).trim();
}

function firstNonEmpty(...values) {
    for (const value of values) {
        const t = text(value);
        if (t !== '') { return t; }
    }
    return '';
}

/**
 * The six-step wizard offers ONE free-text พิกัด box ("18.7961, 98.9797"), the previous
 * one wrote gpsLat/gpsLng. Read either, and pair them — a farm with a latitude and no
 * longitude is unlocated, not half-located.
 */
function readCoordinates(farm) {
    const [lat, lng] = text(farm.coordinates).split(',');
    return coordinatePairFrom({
        gpsLat: firstNonEmpty(farm.gpsLat, farm.latitude, lat) || null,
        gpsLng: firstNonEmpty(farm.gpsLng, farm.longitude, lng) || null,
    });
}

/**
 * The one map: a filing's own answers → the Farm columns that describe a place.
 *
 * Every caller reads the SAME keys in the SAME order, so a wizard field that is renamed
 * again breaks in one place instead of silently emptying a certificate.
 *
 * @param {unknown} formData the applicant's blob (Application.formData, or the v1
 *   wizard payload — they are the same shape)
 * @returns {{
 *   farmName: string, address: string, province: string, district: string,
 *   subDistrict: string, postalCode: string,
 *   latitude: number|null, longitude: number|null,
 *   areaAmount: string, areaUnit: string, cultivationMethod: string|null,
 * }}
 */
function readFilingSite(formData) {
    const farm = asObject(asObject(formData).farmData);
    const { latitude, longitude } = readCoordinates(farm);
    const areaTypes = asArray(farm.areaTypes);

    return {
        // กทล.๑ ส่วนที่ ๒ vocabulary first, the previous wizard's as the fallback — the
        // same precedence katorlor1-template-service.farmForForm and the submit
        // validator's step-5 map already use.
        farmName: firstNonEmpty(farm.siteName, farm.farmName),
        address: firstNonEmpty(farm.siteAddress, farm.address),
        province: firstNonEmpty(farm.province),
        district: firstNonEmpty(farm.district),
        // Both spellings are live: the certificate resolver reads both, so does this.
        subDistrict: firstNonEmpty(farm.subDistrict, farm.subdistrict),
        postalCode: firstNonEmpty(farm.postalCode),
        latitude,
        longitude,
        // `areaSqm` is the v2 field and its unit is in its NAME, so a filing that
        // declared through it has declared the unit too — the identical rule the
        // submit validator applies (canonical-application-validator step 5).
        areaAmount: firstNonEmpty(farm.areaSqm, farm.totalAreaSize),
        areaUnit: firstNonEmpty(farm.totalAreaUnit, text(farm.areaSqm) !== '' ? AREA_UNIT : ''),
        // ลักษณะพื้นที่ IS the cultivation declaration on the six-step wizard, and the
        // most controlled tick is what the platform records (higher fee, stricter
        // obligations — erring that way under-charges and under-regulates nobody).
        // 'OTHER' maps to no canonical method, so it is carried verbatim rather than
        // rewritten into an OUTDOOR nobody said.
        cultivationMethod: mostControlledMethod(areaTypes)
            || firstNonEmpty(...areaTypes)
            || null,
    };
}

/** The facts a Farm row cannot be born without and this filing does not state. */
function missingSiteFacts(site) {
    return FILING_SITE_REQUIRED.filter((field) => text(site[field]) === '');
}

/**
 * Give this filing the farm its certificate will name.
 *
 * IDEMPOTENT: a filing that already points at a farm is left exactly as it is. The
 * pointer is `formData.farmId` — the first thing certificate-service.resolveFarmForCertificate
 * reads, and scoped by that resolver to the applicant's own entity/owner before it is
 * trusted.
 *
 * FAIL-CLOSED, BY THE CALLER'S TRANSACTION: this writes on whatever client it is handed.
 * Handed a submit transaction, a failed farm write rolls the submit back with it — the
 * filing stays DRAFT and the farmer can press ยื่นคำขอ again. That is the deliberate
 * choice over a best-effort write: a filing that reaches the department without a farm
 * is a filing that walks the whole line and is refused at the certificate, which is the
 * defect this exists to close.
 *
 * @param {object} params
 * @param {object} params.client prisma client or interactive-transaction handle
 * @param {unknown} params.formData the filing's own answers
 * @param {string} params.ownerId the applicant User the farm belongs to
 * @param {string|null} params.entityId workspace dimension — the application's own
 * @param {string|undefined} params.organizationId tenant — the application's own
 * @returns {Promise<{ farmId: string|null, created: boolean, reason: string }>}
 */
async function materializeFarmForFiling({ client, formData, ownerId, entityId, organizationId }) {
    const existingFarmId = firstNonEmpty(
        asObject(formData).farmId,
        asObject(asObject(formData).farm).id,
        asObject(asObject(formData).farmData).id,
    );
    if (existingFarmId) {
        return { farmId: existingFarmId, created: false, reason: 'ALREADY_LINKED' };
    }

    const site = readFilingSite(formData);
    const missing = missingSiteFacts(site);
    if (missing.length > 0) {
        // Nothing is written and nothing is invented. The submit gate is where a farmer
        // is told what their own form still needs.
        return { farmId: null, created: false, reason: `NOT_STATED:${missing.join(',')}` };
    }

    const area = submittedAreaSqm(site.areaAmount, site.areaUnit || AREA_UNIT, 'farmData.areaSqm');

    const farm = await client.farm.create({
        data: {
            ownerId,
            // The workspace this filing belongs to, taken from the application row —
            // the same source certificate issuance uses (it runs under a provider's
            // context, where the ALS entity context says nothing about the applicant).
            entityId: entityId ?? null,
            farmName: site.farmName,
            farmType: 'CULTIVATION',
            address: site.address,
            province: site.province,
            district: site.district,
            subDistrict: site.subDistrict,
            // NOT NULL with no default, and the form does not require it. '' is the
            // honest spelling of "the farmer did not say" — never the retired '00000'
            // stand-in, which certificate issuance now treats as a blank anyway
            // (isRetiredLocationStandIn) and which a register would print as a fact.
            postalCode: site.postalCode,
            latitude: site.latitude,
            longitude: site.longitude,
            // Square metres, always — the unit is stored, not guessed (F-G4 areaUnit).
            totalArea: area,
            cultivationArea: area,
            areaUnit: AREA_UNIT,
            cultivationMethod: site.cultivationMethod || '',
            // The filing has been made; the audit is what VERIFIES it, and issuance is
            // what stamps that. Same value the v1 submit door writes.
            status: 'ACTIVE',
            // Farm.organizationId is a required FK with no default. Passed explicitly
            // from the application row; left undefined the tenant extension injects the
            // bound context's org (services/tenant-prisma-extension.js), which is what
            // the v1 door relies on.
            ...(organizationId ? { organizationId } : {}),
        },
    });

    return { farmId: farm.id, created: true, reason: 'CREATED' };
}

module.exports = {
    FILING_SITE_REQUIRED,
    readFilingSite,
    missingSiteFacts,
    materializeFarmForFiling,
};
