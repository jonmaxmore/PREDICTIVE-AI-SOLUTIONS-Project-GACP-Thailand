'use strict';

/**
 * P3 (staging walk 2026-09-29, ~/work/state/staging-walk-2026-09-29/INDEX.md,
 * the backlog) — reopening a never-submitted draft showed step 1 with
 * NEITHER the request type NOR the applicant type selected, although the
 * draft's own DB row carried them.
 *
 * The frontend edit-hydration bug is pinned separately
 * (apps/web-app/.../[id]/__tests__/edit-hydrates-step1-answers.test.tsx), but
 * that fix is powerless while the ROOT of the defect sits here: GET
 * /api/applications/:id (application-workflow-handlers.js) answers with
 * `buildApplicationDetailPayload(app)`, and its `formData` echo is a
 * hand-picked whitelist that never named `requestType`, `applicantType` or
 * `certScope` — so those three answers never leave the server, however the
 * client tries to read them.
 *
 * `applicantType` is applicant-writable (WIZARD_OWNED_FORM_DATA_KEYS,
 * application-constants.js) and already stored; `requestType` / `certScope`
 * are server-owned (SERVER_OWNED_FORM_DATA_KEYS, form-data-ownership.js) and
 * written by the F-APPV2-02 law resolver on every draft save. Echoing all
 * three back on a GET is a read, not a write — it does not change who may
 * SET them.
 */

const { buildApplicationDetailPayload } = require('../../routes/api/helpers/application-payload-builders');

function draftApplication(formDataOverrides) {
    return {
        id: 'app-1',
        applicationNumber: 'APP-2569-MUJZVOTO-80E5FE',
        healthId: 'health-1',
        serviceType: 'NEW',
        status: 'DRAFT',
        consentedPDPA: false,
        createdAt: new Date('2026-09-29T00:00:00Z'),
        updatedAt: new Date('2026-09-29T00:00:00Z'),
        workflowHistory: [],
        comments: [],
        formData: {
            plantId: 'cannabis',
            serviceType: 'NEW',
            requestType: 'NEW',
            applicantType: 'JURISTIC',
            certScope: 'PLANTING',
            ...formDataOverrides,
        },
    };
}

describe('buildApplicationDetailPayload — the edit-hydration door echoes step 1 answers back', () => {
    it('carries requestType, applicantType and certScope in the formData it hands the edit page', () => {
        const payload = buildApplicationDetailPayload(draftApplication());

        expect(payload.formData.requestType).toBe('NEW');
        expect(payload.formData.applicantType).toBe('JURISTIC');
        expect(payload.formData.certScope).toBe('PLANTING');
    });

    it('a draft that never answered step 1 gets null, not a thrown error or a guessed default', () => {
        const payload = buildApplicationDetailPayload(draftApplication({
            requestType: undefined,
            applicantType: undefined,
            certScope: undefined,
        }));

        expect(payload.formData.requestType).toBeNull();
        expect(payload.formData.applicantType).toBeNull();
        expect(payload.formData.certScope).toBeNull();
    });
});
