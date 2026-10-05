/**
 * Task 11 — the one review page reads the SERVER, and says where to go back to.
 *
 * The page it replaces (review-step.tsx) built its own picture of the filing out of
 * the wizard's zustand store and its own copy of the document list, so the browser
 * could disagree with the server about whether a filing was complete — and the
 * browser was the one the applicant believed. Everything here is derived from the
 * requirements payload the server returns.
 *
 * Two rules this file pins:
 *
 * **Where a missing paper lives is not typed here.** Each step already declares the
 * slots it shows (STEP2_QUALIFICATION_SLOT_IDS / STEP3_SITE_SLOT_IDS /
 * STEP5_LEAD_SLOT_IDS). A fourth hand-written copy would drift the first time a slot
 * moved, and the farmer would be sent to a step that no longer shows it. Unknown
 * slots fall to step 5, which is where step 5 already puts everything nobody claimed.
 *
 * **All six boxes, or no submit.** The server takes one boolean and stamps the time
 * itself (services/application-declarations-gate.js). The six rows are ส่วนที่ ๔
 * (๑)-(๕) plus the disclosure consent, each its own row — a single "I agree to
 * everything" box is not what the form asks a person to certify.
 */
import { describe, expect, it } from '@jest/globals';
import {
    DECLARATION_ROWS, allDeclarationsTicked, stepForSlot, missingItems, canSubmit,
} from '../step6-review-state';
import { STEP2_QUALIFICATION_SLOT_IDS } from '../requirement-slot-card-state';
import { STEP3_SITE_SLOT_IDS } from '../step3-site-land-config';
import { STEP5_LEAD_SLOT_IDS } from '../step5-plans-docs-config';

const slot = (slotId: string, over: Record<string, unknown> = {}) => ({
    slotId, labelTH: `เอกสาร ${slotId}`, description: null, sourceHint: null,
    required: true, requiredReason: null, satisfied: false,
    fileUrl: null, fileName: null, uploadedAt: null, ...over,
} as never);

describe('where a missing paper sends the farmer back to', () => {
    it('every slot step 2 shows resolves to step 2', () => {
        for (const id of STEP2_QUALIFICATION_SLOT_IDS) { expect(stepForSlot(id)).toBe(2); }
    });

    it('every slot step 3 shows resolves to step 3', () => {
        for (const id of STEP3_SITE_SLOT_IDS) { expect(stepForSlot(id)).toBe(3); }
    });

    it('every slot step 5 leads with resolves to step 5', () => {
        for (const id of STEP5_LEAD_SLOT_IDS) { expect(stepForSlot(id)).toBe(5); }
    });

    it('a slot nobody claims falls to step 5, where step 5 already puts the unclaimed', () => {
        expect(stepForSlot('a_slot_filed_next_year')).toBe(5);
    });
});

describe('what the red card lists', () => {
    it('names the required slots the server says are unsatisfied, and no others', () => {
        const payload = { slots: [
            slot('land_rights', { satisfied: true }),
            slot('landlord_consent'),
            slot('sop_manual'),
            slot('site_photos', { required: false }),
        ] };
        const items = missingItems(payload as never);
        expect(items.map((i) => i.slotId)).toEqual(['landlord_consent', 'sop_manual']);
        expect(items.map((i) => i.step)).toEqual([3, 5]);
        expect(items[0]!.labelTH).toBe('เอกสาร landlord_consent');
    });

    it('an optional slot is never listed as missing — it is optional', () => {
        const payload = { slots: [slot('site_photos', { required: false })] };
        expect(missingItems(payload as never)).toEqual([]);
    });

    it('no payload yet means no claim either way, not "nothing is missing"', () => {
        expect(missingItems(null as never)).toEqual([]);
        expect(missingItems({ slots: [] } as never)).toEqual([]);
    });
});

describe('the six boxes of ส่วนที่ ๔', () => {
    it('is five คำรับรอง plus the disclosure consent, each its own row', () => {
        expect(DECLARATION_ROWS).toHaveLength(6);
        expect(DECLARATION_ROWS.filter((r) => r.kind === 'CERTIFICATION')).toHaveLength(5);
        expect(DECLARATION_ROWS.filter((r) => r.kind === 'CONSENT')).toHaveLength(1);
    });

    it('every row carries Thai text a person can actually read', () => {
        for (const row of DECLARATION_ROWS) {
            expect(row.text).toMatch(/[ก-๙]/);
            expect(row.text.length).toBeGreaterThan(20);
        }
    });

    it('the one with teeth — (๓) no change of area, seed or plant part without refiling — is present verbatim', () => {
        const three = DECLARATION_ROWS.find((r) => r.id === 'cert_3');
        expect(three?.text).toContain('ไม่เปลี่ยน');
        expect(three?.text).toContain('ยื่นคำขอใหม่');
    });

    it('all six or nothing', () => {
        const all = Object.fromEntries(DECLARATION_ROWS.map((r) => [r.id, true]));
        expect(allDeclarationsTicked(all)).toBe(true);
        expect(allDeclarationsTicked({ ...all, cert_3: false })).toBe(false);
        expect(allDeclarationsTicked({})).toBe(false);
    });
});

describe('when the button may be pressed', () => {
    const complete = { slots: [slot('sop_manual', { satisfied: true })], complete: true, missingRequired: [], blockingIssues: [] };
    const ticked = Object.fromEntries(DECLARATION_ROWS.map((r) => [r.id, true]));

    it('complete filing plus six ticks', () => {
        expect(canSubmit({ requirements: complete as never, ticked, alreadyAccepted: false , consentsAgreed: true })).toBe(true);
    });

    it('a missing required paper blocks it however many boxes are ticked', () => {
        const incomplete = { slots: [slot('sop_manual')], complete: false, missingRequired: ['sop_manual'], blockingIssues: [] };
        expect(canSubmit({ requirements: incomplete as never, ticked, alreadyAccepted: false , consentsAgreed: true })).toBe(false);
    });

    it('an unticked box blocks it however complete the filing', () => {
        expect(canSubmit({ requirements: complete as never, ticked: {}, alreadyAccepted: false })).toBe(false);
    });

    it('a resubmit stands on the acceptance already recorded — the server does not ask twice', () => {
        expect(canSubmit({ requirements: complete as never, ticked: {}, alreadyAccepted: true, consentsAgreed: true })).toBe(true);
    });

    it('no server answer yet is not permission to submit', () => {
        expect(canSubmit({ requirements: null as never, ticked, alreadyAccepted: false , consentsAgreed: true })).toBe(false);
    });

    it('a payload that does not SAY it is complete is not a payload that said so', () => {
        const silent = { slots: [slot('sop_manual', { satisfied: true })] };
        expect(canSubmit({ requirements: silent as never, ticked, alreadyAccepted: false , consentsAgreed: true })).toBe(false);
    });

    it('the server\'s own refusal beats a locally complete-looking slot list', () => {
        const refused = { slots: [slot('sop_manual', { satisfied: true })], complete: false,
            blockingIssues: [{ code: 'APPLICATION_NOT_JUDGEABLE' }] };
        expect(canSubmit({ requirements: refused as never, ticked, alreadyAccepted: false , consentsAgreed: true })).toBe(false);
    });
});

describe('ด่านความยินยอมของแพลตฟอร์ม', () => {
    const completeFiling = {
        slots: [{ slotId: 'sop_manual', required: true, satisfied: true, labelTH: 'x' }],
        complete: true, missingRequired: [], blockingIssues: [],
    };
    const allTicked = Object.fromEntries(DECLARATION_ROWS.map((r) => [r.id, true]));

    it('ยังขาดความยินยอม = ยื่นไม่ได้ แม้เอกสารครบและติ๊กคำรับรองครบ', () => {
        expect(canSubmit({
            requirements: completeFiling as never, ticked: allTicked, alreadyAccepted: false,
            consentsAgreed: false,
        })).toBe(false);
    });

    it('ยังอ่านสถานะความยินยอมไม่เสร็จ = ยังไม่พร้อม ไม่ใช่เดาว่าให้แล้ว', () => {
        expect(canSubmit({
            requirements: completeFiling as never, ticked: allTicked, alreadyAccepted: false,
            consentsAgreed: undefined,
        })).toBe(false);
    });

    it('ให้ความยินยอมครบแล้ว = ผ่านด่านนี้', () => {
        expect(canSubmit({
            requirements: completeFiling as never, ticked: allTicked, alreadyAccepted: false,
            consentsAgreed: true,
        })).toBe(true);
    });
});
