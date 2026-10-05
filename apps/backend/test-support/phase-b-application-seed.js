'use strict';

/**
 * The application row the Phase-B suite seeds before it asks
 * certificate-service.generateCertificate to mint
 * (__tests__/integration/onsite-evidence-unfreeze.test.js, seedApplicationWithAudit).
 *
 * It lives here, outside that suite's describe closure, so a database-free test
 * (__tests__/unit/phase-b-seed-reaches-the-mint.test.js) can walk the SAME row
 * through the real issuance chain. The suite skips whenever the run has no test
 * database; a row shape only that suite can see is a shape nothing checks on a
 * laptop, and it was exactly that row that stopped at the register's fail-closed
 * gates on a database runner (F-G4-58).
 */

/**
 * The wizard slug the seeded application names as its plant. It resolves through
 * config/plant-species-slugs.js to master code CAN, a row prisma/seed-plants.js
 * declares; the test database must carry that row (run the plant seed there) or
 * issuance refuses with CERTIFICATE_PLANT_UNKNOWN, which is the register's rule,
 * not a defect in the suite.
 */
const PHASE_B_PLANT_SLUG = 'cannabis';

/**
 * The wizard answers issuance reads (Application.formData). Two register gates
 * refuse an application that carries none, before anything is written:
 *   - F-G4-58: the plant, resolved from the master (certificate-service.js
 *     resolveCertificatePlantName);
 *   - F-G4-52: where the farm is; with no Farm on record the resolver creates one
 *     and refuses when address/province/district/subDistrict/postalCode is blank
 *     (certificate-service.js resolveFarmForCertificate, FARM_CREATE_LOCATION_FIELDS).
 * The location is a real Thai address (Rim Tai, Mae Rim, Chiang Mai, 50180); the
 * area is 1,600 square metres in the unit the wizard submits.
 *
 * @param {object} [extra] merged over the answers
 * @returns {object}
 */
function phaseBWizardAnswers(extra = {}) {
    return {
        plantId: PHASE_B_PLANT_SLUG,
        farmData: {
            farmName: 'ไร่ทดสอบ Phase-B',
            totalAreaSize: '1600',
            totalAreaUnit: 'sqm',
            address: '99 หมู่ 5',
            province: 'เชียงใหม่',
            district: 'แม่ริม',
            subdistrict: 'ริมใต้',
            postalCode: '50180',
        },
        ...extra,
    };
}

/**
 * `data` for prisma.application.create, as the Phase-B suite seeds it.
 *
 * @param {{ applicationNumber: string, healthId: string, organizationId: string }} ids
 *   healthId is the applicant's User.canonicalId (Application.healthId FKs to it, not to User.id).
 * @param {object} [overrides] spread last, the way the suite's seedApplicationWithAudit takes them
 * @returns {object}
 */
function phaseBApplicationData({ applicationNumber, healthId, organizationId }, overrides = {}) {
    return {
        applicationNumber,
        healthId,
        areaType: 'OUTDOOR',
        organizationId,
        status: 'AUDIT_CONFIRMED',
        formData: phaseBWizardAnswers(),
        ...overrides,
    };
}

module.exports = { PHASE_B_PLANT_SLUG, phaseBWizardAnswers, phaseBApplicationData };
