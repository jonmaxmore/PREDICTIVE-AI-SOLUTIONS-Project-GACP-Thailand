/**
 * Unit Tests for Document Slots
 * Tests for document slot logic and requirements
 */

const {
    DOCUMENT_SLOTS,
    getRequiredSlots,
    getAllSlotIds,
    requiresLicense,
    getRequiredDocuments,
} = require('../constants/document-slots');

describe('Document Slots', () => {

    describe('DOCUMENT_SLOTS structure', () => {

        // Renamed from "should have required fields for each slot": it stopped
        // asserting `required` when the v2 rows arrived without one (see the next
        // test for why they carry none), and a name that describes a check the
        // test no longer makes is worse than no name.
        test('every slot names itself and says what it is (slotId, name, description)', () => {
            Object.values(DOCUMENT_SLOTS).forEach(slot => {
                expect(slot).toHaveProperty('slotId');
                expect(slot).toHaveProperty('name');
                expect(slot).toHaveProperty('description');
            });
        });

        /**
         * The กทล.1 v2 rows (spec 2026-09-01) carry `sourceHint` and deliberately
         * carry NO `required`: WHICH of them a case must attach is decided by the
         * dated, append-only requirement_rules engine, not by a constant a deploy
         * can change. A flag here would be a second answer to a question the
         * engine already owns, and two answers drift. The legacy rows keep theirs
         * until nothing reads them.
         */
        test('v2 กทล.1 slots answer "หาได้ที่ไหน" and leave "required" to the engine', () => {
            const rows = Object.values(DOCUMENT_SLOTS);
            const v2 = rows.filter(slot => slot.sourceHint !== undefined);
            const legacy = rows.filter(slot => slot.sourceHint === undefined);

            expect(v2.length).toBeGreaterThanOrEqual(25);
            v2.forEach(slot => {
                expect(typeof slot.sourceHint).toBe('string');
                expect(slot.sourceHint.length).toBeGreaterThan(0);
                expect(slot).not.toHaveProperty('required');
                expect(slot).not.toHaveProperty('requiredFor');
            });
            legacy.forEach(slot => {
                expect(slot).toHaveProperty('required');
            });
        });

        test('should have unique slot IDs', () => {
            const slotIds = Object.values(DOCUMENT_SLOTS).map(s => s.slotId);
            const uniqueIds = [...new Set(slotIds)];
            expect(slotIds.length).toBe(uniqueIds.length);
        });

        test('should have photo category slots', () => {
            const photoSlots = ['photos_exterior', 'photos_interior', 'photos_storage', 'photos_signage'];
            photoSlots.forEach(slotId => {
                const slot = Object.values(DOCUMENT_SLOTS).find(s => s.slotId === slotId);
                expect(slot).toBeDefined();
            });
        });

        test('should have DTAM required documents', () => {
            const dtamRequired = ['criminal_bg', 'land_consent', 'gov_support'];
            dtamRequired.forEach(slotId => {
                const slot = Object.values(DOCUMENT_SLOTS).find(s => s.slotId === slotId);
                expect(slot).toBeDefined();
            });
        });

        test('should have renewal documents', () => {
            const renewalDocs = ['renewal_report', 'previous_cert'];
            renewalDocs.forEach(slotId => {
                const slot = Object.values(DOCUMENT_SLOTS).find(s => s.slotId === slotId);
                expect(slot).toBeDefined();
                expect(slot.requiredFor.applicationTypes).toContain('RENEWAL');
            });
        });

    });

    describe('getRequiredSlots', () => {

        test('should return required slots for general plant type', () => {
            const slots = getRequiredSlots('general');
            expect(Array.isArray(slots)).toBe(true);
            expect(slots.every(s => s.required === true)).toBe(true);
        });

        test('should return slots for cannabis including license requirement', () => {
            const slots = getRequiredSlots('cannabis');
            const hasBt11 = slots.some(s => s.slotId === 'license_bt11');
            expect(hasBt11).toBe(true);
        });

    });

    describe('getAllSlotIds', () => {

        test('should return array of slot IDs', () => {
            const ids = getAllSlotIds();
            expect(Array.isArray(ids)).toBe(true);
            expect(ids.length).toBeGreaterThan(0);
            expect(ids.every(id => typeof id === 'string')).toBe(true);
        });

    });

    describe('requiresLicense', () => {

        test('should return true for cannabis', () => {
            expect(requiresLicense('cannabis')).toBe(true);
            expect(requiresLicense('Cannabis')).toBe(true);
            expect(requiresLicense('CANNABIS')).toBe(true);
        });

        test('should return true for kratom', () => {
            expect(requiresLicense('kratom')).toBe(true);
        });

        test('should return false for other plants', () => {
            expect(requiresLicense('turmeric')).toBe(false);
            expect(requiresLicense('ginger')).toBe(false);
            expect(requiresLicense('general')).toBe(false);
        });

    });

    describe('getRequiredDocuments', () => {

        test('should return array of required documents', () => {
            const docs = getRequiredDocuments({
                plantType: 'cannabis',
                applicantType: 'INDIVIDUAL',
            });
            expect(Array.isArray(docs)).toBe(true);
        });

        test('should include BT.11 for cannabis', () => {
            const docs = getRequiredDocuments({
                plantType: 'cannabis',
                applicantType: 'INDIVIDUAL',
            });
            const hasBt11 = docs.some(d => d.slotId === 'license_bt11');
            expect(hasBt11).toBe(true);
        });

        test('should include BT.13 when PROCESSING objective', () => {
            const docs = getRequiredDocuments({
                plantType: 'cannabis',
                applicantType: 'INDIVIDUAL',
                objectives: ['PROCESSING'],
            });
            const hasBt13 = docs.some(d => d.slotId === 'license_bt13');
            expect(hasBt13).toBe(true);
        });

        test('should include company_reg for JURISTIC applicant', () => {
            const docs = getRequiredDocuments({
                plantType: 'cannabis',
                applicantType: 'JURISTIC',
            });
            const hasCompanyReg = docs.some(d => d.slotId === 'company_reg');
            expect(hasCompanyReg).toBe(true);
        });

        test('should include land_consent for permitted_use ownership', () => {
            const docs = getRequiredDocuments({
                plantType: 'cannabis',
                applicantType: 'INDIVIDUAL',
                landOwnership: 'permitted_use',
            });
            const hasLandConsent = docs.some(d => d.slotId === 'land_consent');
            expect(hasLandConsent).toBe(true);
        });

    });

});
