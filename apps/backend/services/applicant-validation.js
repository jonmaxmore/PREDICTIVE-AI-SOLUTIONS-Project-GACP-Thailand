// Applicant identifier validators (Phase 4) — see plan
// the entity-model design note.
//
// Three identifier shapes:
//   * INDIVIDUAL — Thai 13-digit citizen ID, mod-11 check, must start 1-9
//   * JURISTIC   — Thai 13-digit company registration / tax ID,
//                  mod-11 check, must start 0
//   * COMMUNITY  — DOAE 11-digit community-enterprise registration number,
//                  no checksum (DOAE never published one)
//
// Used by entity-service.js when materialising entities from wizard
// data, and by the certificate / PDF templates as a sanity guard.
//
// Pure functions: no Prisma, no IO. Easy to unit-test.

'use strict';

// F-G4-10 — the check digit is computed in exactly one place platform-wide.
const { isThaiIdChecksumValid } = require('@gacp/validation/thai-id-checksum');

const THAI_ID_REGEX = /^\d{13}$/;
const COMMUNITY_REG_REGEX = /^\d{11}$/;

function isThaiIdMod11Valid(value) {
    if (!THAI_ID_REGEX.test(value)) {return false;}
    return isThaiIdChecksumValid(value);
}

function validateIndividual(payload) {
    const errors = [];
    const idCard = String(payload?.idCard || '').trim();
    if (!idCard) {
        errors.push({ field: 'idCard', message: 'idCard is required' });
    } else if (!isThaiIdMod11Valid(idCard)) {
        errors.push({ field: 'idCard', message: 'idCard is not a valid Thai citizen ID (mod-11)' });
    } else if (idCard[0] === '0') {
        errors.push({ field: 'idCard', message: 'INDIVIDUAL Thai ID must not start with 0 (use JURISTIC for company IDs)' });
    }
    if (!String(payload?.firstName || '').trim()) {
        errors.push({ field: 'firstName', message: 'firstName is required' });
    }
    if (!String(payload?.lastName || '').trim()) {
        errors.push({ field: 'lastName', message: 'lastName is required' });
    }
    return { valid: errors.length === 0, errors };
}

function validateJuristic(payload) {
    const errors = [];
    const taxId = String(payload?.taxId || '').trim();
    if (!taxId) {
        errors.push({ field: 'taxId', message: 'taxId is required' });
    } else if (!isThaiIdMod11Valid(taxId)) {
        errors.push({ field: 'taxId', message: 'taxId is not a valid Thai 13-digit registration number (mod-11)' });
    } else if (taxId[0] !== '0') {
        errors.push({ field: 'taxId', message: 'JURISTIC Thai ID must start with 0' });
    }
    if (!String(payload?.companyName || '').trim()) {
        errors.push({ field: 'companyName', message: 'companyName is required' });
    }
    return { valid: errors.length === 0, errors };
}

function validateCommunityEnterprise(payload) {
    const errors = [];
    const regNo = String(payload?.communityRegNumber || '').trim();
    if (!regNo) {
        errors.push({ field: 'communityRegNumber', message: 'communityRegNumber is required' });
    } else if (!COMMUNITY_REG_REGEX.test(regNo)) {
        errors.push({ field: 'communityRegNumber', message: 'communityRegNumber must be exactly 11 digits' });
    }
    if (!String(payload?.communityName || '').trim()) {
        errors.push({ field: 'communityName', message: 'communityName is required' });
    }
    return { valid: errors.length === 0, errors };
}

module.exports = {
    isThaiIdMod11Valid,
    validateIndividual,
    validateJuristic,
    validateCommunityEnterprise,
};
