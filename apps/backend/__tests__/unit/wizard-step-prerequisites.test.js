/**
 * F-G4-11 — the wizard's step-exit bar, server side.
 *
 * These pin the table itself. The route-level door (what /draft clamps and
 * what /prepare refuses) is pinned separately in
 * `applications-step-prerequisite-door.test.js`.
 *
 * The table is a TWIN of the browser's `isStepComplete` /
 * `firstIncompleteStep` in
 * apps/web-app/src/app/health/applications/new/_steps/hooks/use-application-flow-store.ts.
 * There is no shared module (backend is CommonJS at runtime, the wizard is
 * TypeScript), so these cases are written to the same field names on purpose:
 * a change on one side that is not made on the other shows up here.
 */

const {
    FLOW_STEP_NUMBERS,
    SERVER_JUDGED_STEP_NUMBERS,
    LAST_FLOW_STEP,
    isStepComplete,
    firstIncompleteStep,
    evaluateStepClaim,
    stepPrerequisiteMessage,
} = require('../../validation/wizard-step-prerequisites');

/** Canonical formData that clears every step the server judges. */
function completeFormData(overrides = {}) {
    return {
        consentedPDPA: true,
        acknowledgedStandards: true,
        plantId: 'cannabis',
        serviceType: 'new_application',
        certificationPurposes: ['EXPORT'],
        cultivationMethods: ['OUTDOOR'],
        applicantData: {
            applicantType: 'INDIVIDUAL',
            firstName: 'สมชาย',
            lastName: 'ใจดี',
            idCard: '1234567890123',
        },
        farmData: { farmName: 'ไร่ใจดี', address: '99 หมู่ 3' },
        plots: [{ name: 'แปลง 1', areaUnit: 'Sqm' }],
        productionData: { propagationType: ['SEED'], plantParts: ['LEAF'] },
        harvestData: { harvestMethod: 'MANUAL' },
        documents: [{ slotId: 'ID_CARD', uploaded: true }],
        ...overrides,
    };
}

describe('wizard step-exit bar — the numbered slots', () => {
    it('walks the URL numbering, with slot 3 vacant', () => {
        expect(FLOW_STEP_NUMBERS).toEqual([1, 2, 4, 5, 6, 7, 8, 9]);
        expect(LAST_FLOW_STEP).toBe(9);
    });

    it('treats the vacant slot 3 as complete so deep links to 4..9 still resolve', () => {
        expect(isStepComplete({}, 3)).toBe(true);
    });

    it('treats the review step as complete — it collects nothing of its own', () => {
        expect(isStepComplete({}, 9)).toBe(true);
    });

    it('refuses a step number the wizard does not have', () => {
        expect(isStepComplete(completeFormData(), 11)).toBe(false);
        expect(isStepComplete(completeFormData(), 0)).toBe(false);
    });
});

describe('wizard step-exit bar — per step', () => {
    it('step 2 needs plant, service type, at least one purpose and one cultivation method', () => {
        const base = completeFormData();
        expect(isStepComplete(base, 2)).toBe(true);
        expect(isStepComplete({ ...base, plantId: '' }, 2)).toBe(false);
        expect(isStepComplete({ ...base, serviceType: null }, 2)).toBe(false);
        expect(isStepComplete({ ...base, certificationPurposes: [] }, 2)).toBe(false);
        expect(isStepComplete({ ...base, cultivationMethods: [] }, 2)).toBe(false);
    });

    it('step 4 asks a different question of each applicant type', () => {
        const base = completeFormData();
        expect(isStepComplete(base, 4)).toBe(true);
        expect(isStepComplete({ ...base, applicantData: {} }, 4)).toBe(false);
        expect(isStepComplete({ ...base, applicantData: { applicantType: 'INDIVIDUAL', firstName: 'ก' } }, 4)).toBe(false);

        const community = { applicantType: 'COMMUNITY', communityName: 'วิสาหกิจ ก', presidentName: 'สมหญิง' };
        expect(isStepComplete({ ...base, applicantData: community }, 4)).toBe(true);
        expect(isStepComplete({ ...base, applicantData: { ...community, presidentName: '  ' } }, 4)).toBe(false);

        const juristic = { applicantType: 'JURISTIC', companyName: 'บริษัท ก', taxId: '0105500000000' };
        expect(isStepComplete({ ...base, applicantData: juristic }, 4)).toBe(true);
        expect(isStepComplete({ ...base, applicantData: { ...juristic, taxId: '' } }, 4)).toBe(false);

        // An unknown applicant type is not "complete by omission".
        expect(isStepComplete({ ...base, applicantData: { applicantType: 'SOMETHING_ELSE' } }, 4)).toBe(false);
    });

    it('step 5 needs a farm name, an address and at least one plot', () => {
        const base = completeFormData();
        expect(isStepComplete(base, 5)).toBe(true);
        expect(isStepComplete({ ...base, farmData: { address: 'x' } }, 5)).toBe(false);
        expect(isStepComplete({ ...base, farmData: { farmName: 'x' } }, 5)).toBe(false);
        expect(isStepComplete({ ...base, plots: [] }, 5)).toBe(false);
    });

    it('step 6 needs propagation type and plant parts; step 7 needs a harvest method', () => {
        const base = completeFormData();
        expect(isStepComplete({ ...base, productionData: { propagationType: ['SEED'], plantParts: [] } }, 6)).toBe(false);
        expect(isStepComplete({ ...base, productionData: { propagationType: [], plantParts: ['LEAF'] } }, 6)).toBe(false);
        expect(isStepComplete({ ...base, harvestData: {} }, 7)).toBe(false);
        expect(isStepComplete(base, 7)).toBe(true);
    });

    it('step 8 counts documents from EITHER place the wizard can put them', () => {
        const base = completeFormData({ documents: [] });
        expect(isStepComplete(base, 8)).toBe(false);
        // Listed in the store but not actually uploaded is not a document.
        expect(isStepComplete({ ...base, documents: [{ slotId: 'ID_CARD', uploaded: false }] }, 8)).toBe(false);
        expect(isStepComplete({ ...base, documents: [{ slotId: 'ID_CARD', uploaded: true }] }, 8)).toBe(true);
        // Uploaded through POST /applications/draft-documents instead.
        expect(isStepComplete({ ...base, draftDocuments: [{ documentId: 'd1' }] }, 8)).toBe(true);
    });
});

describe('firstIncompleteStep — the frontier', () => {
    it('does NOT judge consent: an empty draft starts at step 2, not step 1', () => {
        // Step 1 is consent and neither /prepare payload carries the consent
        // flags; judging it here would refuse every real applicant. The
        // registration consent record + requireConsent on /submit is the
        // server's authority instead.
        expect(SERVER_JUDGED_STEP_NUMBERS).toEqual([2, 4, 5, 6, 7, 8, 9]);
        expect(firstIncompleteStep({})).toBe(2);
        expect(firstIncompleteStep({ consentedPDPA: false, acknowledgedStandards: false, ...completeFormData() }))
            .toBe(LAST_FLOW_STEP);
    });

    it('skips the vacant slot 3', () => {
        const consentedOnly = { plantId: 'cannabis', serviceType: 'new', certificationPurposes: ['C'], cultivationMethods: ['O'] };
        expect(firstIncompleteStep(consentedOnly)).toBe(4);
    });

    it('names the first gap, not the last', () => {
        const missingFarm = completeFormData({ farmData: {} });
        expect(firstIncompleteStep(missingFarm)).toBe(5);
    });

    it('returns the review step once everything it judges is done', () => {
        expect(firstIncompleteStep(completeFormData())).toBe(LAST_FLOW_STEP);
    });
});

describe('evaluateStepClaim — the door', () => {
    it('refuses a claim that runs ahead of the data', () => {
        // The URL trick, expressed as an API call: nothing filled, claiming step 9.
        const claim = evaluateStepClaim({}, 9);
        expect(claim).toEqual({ allowedStep: 2, requestedStep: 9, earned: false });
    });

    it('allows the step the applicant is standing on', () => {
        const missingFarm = completeFormData({ farmData: {} });
        expect(evaluateStepClaim(missingFarm, 5).earned).toBe(true);
    });

    it('allows going BACK to a step already finished', () => {
        const complete = completeFormData();
        for (const step of [2, 4, 5, 6, 7, 8, 9]) {
            expect(evaluateStepClaim(complete, step).earned).toBe(true);
        }
    });

    it('treats a missing or unparsable step as no claim at all', () => {
        expect(evaluateStepClaim({}, undefined)).toEqual({ allowedStep: 2, requestedStep: null, earned: true });
        expect(evaluateStepClaim({}, 'ninth')).toEqual({ allowedStep: 2, requestedStep: null, earned: true });
    });

    it('the refusal names the blocking step AND the action that clears it', () => {
        const message = stepPrerequisiteMessage(9, 5);
        expect(message).toContain('ขั้นตอนที่ 5');
        expect(message).toContain('ขั้นตอนที่ 9');
        expect(message).toContain('กรุณา');
        // Law: no em dash in Thai UI copy.
        expect(message).not.toContain('—');
    });
});
