'use strict';
/**
 * fix/fee-line-descriptions round 3 (operator 2026-10-03). A renewal sits in PENDING_AUDIT_FEE
 * like a new filing's second instalment. Payloads that carry an application say which it is
 * (`isRenewal`), so a screen can name the renewal; labels with no application at hand must be
 * true for both and may not name "งวดที่ 2".
 */
const { mapHealthApplication } = require('../../routes/api/helpers/applications-helpers');
const { buildTrackingPayload, buildApplicationDetailPayload, buildActionCard } = require('../../routes/api/helpers/application-payload-builders');
const { TRACKING_STEPS } = require('../../routes/api/helpers/application-constants');
const { STATUS_PRESENTATION } = require('../../shared/status-machine-contract');
const stage = require('../../shared/health-dashboard-stage');

const renewal = { id: 'a1', applicationNumber: 'APP-R', status: 'PENDING_AUDIT_FEE', totalAreaTypes: 2, formData: { renewalOf: 'cert-1', cultivationMethods: ['OUTDOOR', 'INDOOR'] } };
const fresh = { id: 'a2', applicationNumber: 'APP-N', status: 'PENDING_AUDIT_FEE', formData: {} };
const PHASE2 = /งวดที่ 2|instalment 2|ตรวจประเมินแปลงและออกใบรับรอง/i;

describe('payloads carrying an application say whether it is a renewal', () => {
    test('list item', () => {
        expect(mapHealthApplication(renewal).isRenewal).toBe(true);
        expect(mapHealthApplication(fresh).isRenewal).toBe(false);
    });
    test('tracking payload', () => {
        expect(buildTrackingPayload(renewal).isRenewal).toBe(true);
        expect(buildTrackingPayload(fresh).isRenewal).toBe(false);
    });
    test('detail payload, with its stored cultivation-type count', () => {
        const d = buildApplicationDetailPayload(renewal);
        expect(d.isRenewal).toBe(true);
        expect(d.cultivationScopeCount).toBe(2);
        expect(buildApplicationDetailPayload(fresh).isRenewal).toBe(false);
    });
});

describe('labels with no application at hand are true for a renewal too', () => {
    test.each([
        ['status machine PENDING_AUDIT_FEE', () => STATUS_PRESENTATION.PENDING_AUDIT_FEE.label],
        ['status machine AUDIT_FEE_PAID', () => STATUS_PRESENTATION.AUDIT_FEE_PAID.label],
        ['stage label PENDING_FEE_PHASE2', () => stage.STAGE_LABEL_TH.PENDING_FEE_PHASE2],
        ['stage label EN PENDING_FEE_PHASE2', () => stage.STAGE_LABEL_EN.PENDING_FEE_PHASE2],
        ['stage next action PENDING_FEE_PHASE2', () => stage.STAGE_NEXT_ACTION_TH.PENDING_FEE_PHASE2],
        ['action card PAY_AUDIT_FEE title', () => buildActionCard('PENDING_AUDIT_FEE').title],
        ['tracking step PENDING_AUDIT_FEE', () => TRACKING_STEPS.find((s) => s.key === 'PENDING_AUDIT_FEE').label],
    ])('%s', (_l, get) => {
        const text = get();
        expect(text).toBeTruthy();
        expect(text).not.toMatch(PHASE2);
        expect(text).not.toMatch(/audit fee/i);
    });
});
