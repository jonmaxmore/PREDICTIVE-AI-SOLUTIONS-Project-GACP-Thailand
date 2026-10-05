/**
 * The officer's per-slot document check — กทล.๑ ส่วน จนท. ข้อ 1.1
 *
 * ── WHY PER SLOT AND NOT PER FILING ───────────────────────────────────────────
 * Today an officer accepts or rejects a whole application. A filing with nine
 * papers and one problem comes back to the applicant as "แก้ไข" with a free-text
 * note, and the applicant has to work out which paper. The form the ministry
 * actually uses asks the officer to tick each document line — so the platform
 * should record a verdict per line, and the applicant should be asked to fix ONE
 * paper, not re-file everything.
 *
 * ── THE RULES THIS FILE OWNS ──────────────────────────────────────────────────
 *  1. ขอเอกสารเพิ่ม without a REASON is not a request, it is a rejection the
 *     applicant cannot act on. Thai, and long enough to say something.
 *  2. A due date on a weekend or a public holiday is a deadline that starts
 *     already unfair. working-days.js owns the calendar; this asks it.
 *  3. รับคำขอ is refused while any REQUIRED slot is unaccepted — an officer
 *     cannot accept a filing the register says is incomplete.
 *  4. ขอเอกสารเพิ่ม is refused when nothing was actually requested, so the
 *     applicant is never sent back with an empty list.
 *  5. OPTIONAL slots never block acceptance. review-completeness.ts is law:
 *     an optional paper nobody attached is not something the filing lacks.
 *  6. Rounds. A resubmit opens round N+1; the round-N verdicts stay as the
 *     record of what was asked and when.
 */

'use strict';

const {
    assertReviewInput,
    decideDocumentOutcome,
    nextRound,
    DOCUMENT_REVIEW_VERDICTS,
    REVIEW_REASON_REQUIRED,
    REVIEW_DUE_DATE_INVALID,
    DOCUMENT_CHECK_INCOMPLETE,
    DOCUMENT_CHECK_NOTHING_REQUESTED,
} = require('../../services/application-document-review-service');

/** A Thursday — an ordinary Thai working day. */
const WORKING_DAY = new Date('2026-09-10T00:00:00+07:00');
/** The Saturday after it. */
const WEEKEND = new Date('2026-09-12T00:00:00+07:00');

const REASON = 'สำเนาโฉนดที่แนบมาอ่านเลขที่ไม่ออก กรุณาแนบฉบับที่ชัดเจนกว่านี้';

describe('recording one slot verdict', () => {
    test('ACCEPTED needs nothing else', () => {
        expect(() => assertReviewInput({ verdict: 'ACCEPTED' })).not.toThrow();
    });

    test('MORE_REQUESTED without a reason is refused', () => {
        expect(() => assertReviewInput({ verdict: 'MORE_REQUESTED', dueDate: WORKING_DAY }))
            .toThrow(expect.objectContaining({ code: REVIEW_REASON_REQUIRED }));
    });

    test.each([
        ['empty', ''],
        ['whitespace', '    '],
        ['too short to say anything', 'ไม่ชัด'],
    ])('a reason that is %s is not a reason', (_label, reason) => {
        expect(() => assertReviewInput({ verdict: 'MORE_REQUESTED', reason, dueDate: WORKING_DAY }))
            .toThrow(expect.objectContaining({ code: REVIEW_REASON_REQUIRED }));
    });

    test('MORE_REQUESTED without a due date is refused — an open-ended demand has no deadline to miss', () => {
        expect(() => assertReviewInput({ verdict: 'MORE_REQUESTED', reason: REASON }))
            .toThrow(expect.objectContaining({ code: REVIEW_DUE_DATE_INVALID }));
    });

    test('a weekend due date is refused, and says why in Thai', () => {
        let err;
        try {
            assertReviewInput({ verdict: 'MORE_REQUESTED', reason: REASON, dueDate: WEEKEND });
        } catch (e) { err = e; }
        expect(err.code).toBe(REVIEW_DUE_DATE_INVALID);
        expect(err.messageTh).toContain('วันทำการ');
    });

    test('a working day is accepted', () => {
        expect(() => assertReviewInput({
            verdict: 'MORE_REQUESTED', reason: REASON, dueDate: WORKING_DAY,
        })).not.toThrow();
    });

    test('an unknown verdict is refused — the vocabulary is closed', () => {
        expect(() => assertReviewInput({ verdict: 'MAYBE' }))
            .toThrow(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
        expect(DOCUMENT_REVIEW_VERDICTS).toEqual(['ACCEPTED', 'MORE_REQUESTED']);
    });
});

describe('the decision over the whole filing', () => {
    const slot = (slotId, required, verdict) => ({ slotId, required, verdict });

    test('ACCEPT_ALL passes when every required slot is accepted', () => {
        const out = decideDocumentOutcome('ACCEPT_ALL', [
            slot('land_rights', true, 'ACCEPTED'),
            slot('sop_manual', true, 'ACCEPTED'),
        ]);
        expect(out.ok).toBe(true);
    });

    test('ACCEPT_ALL is refused while one required slot is not accepted, and NAMES it', () => {
        let err;
        try {
            decideDocumentOutcome('ACCEPT_ALL', [
                slot('land_rights', true, 'ACCEPTED'),
                slot('sop_manual', true, null),
            ]);
        } catch (e) { err = e; }
        expect(err.code).toBe(DOCUMENT_CHECK_INCOMPLETE);
        // An officer told "incomplete" without being told which line is not
        // being helped; they have to re-read nine rows to find it.
        expect(err.slotIds).toEqual(['sop_manual']);
    });

    test('a required slot marked MORE_REQUESTED also blocks ACCEPT_ALL', () => {
        expect(() => decideDocumentOutcome('ACCEPT_ALL', [
            slot('land_rights', true, 'MORE_REQUESTED'),
        ])).toThrow(expect.objectContaining({ code: DOCUMENT_CHECK_INCOMPLETE }));
    });

    test('an OPTIONAL slot never blocks acceptance, reviewed or not', () => {
        const out = decideDocumentOutcome('ACCEPT_ALL', [
            slot('land_rights', true, 'ACCEPTED'),
            slot('water_test', false, null),
            slot('soil_test', false, 'MORE_REQUESTED'),
        ]);
        expect(out.ok).toBe(true);
    });

    test('REQUEST_MORE passes when at least one slot was actually requested', () => {
        const out = decideDocumentOutcome('REQUEST_MORE', [
            slot('land_rights', true, 'ACCEPTED'),
            slot('sop_manual', true, 'MORE_REQUESTED'),
        ]);
        expect(out.ok).toBe(true);
        expect(out.requestedSlotIds).toEqual(['sop_manual']);
    });

    test('REQUEST_MORE with nothing requested is refused — never send someone back with an empty list', () => {
        expect(() => decideDocumentOutcome('REQUEST_MORE', [
            slot('land_rights', true, 'ACCEPTED'),
        ])).toThrow(expect.objectContaining({ code: DOCUMENT_CHECK_NOTHING_REQUESTED }));
    });

    test('an optional slot CAN be the thing requested — offering is not demanding, but asking is asking', () => {
        const out = decideDocumentOutcome('REQUEST_MORE', [
            slot('water_test', false, 'MORE_REQUESTED'),
        ]);
        expect(out.requestedSlotIds).toEqual(['water_test']);
    });

    test('an unknown action is refused', () => {
        expect(() => decideDocumentOutcome('SOMETHING', []))
            .toThrow(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
    });
});

describe('rounds', () => {
    test('a filing never reviewed is round 1', () => {
        expect(nextRound([])).toBe(1);
    });

    test('the current round is the highest recorded', () => {
        expect(nextRound([{ round: 1 }, { round: 1 }, { round: 2 }])).toBe(2);
    });

    test('openNextRound moves past it — the old verdicts stay as the record', () => {
        expect(nextRound([{ round: 2 }], { open: true })).toBe(3);
    });
});

/**
 * เจ้าหน้าที่ "รับ" เอกสารที่ไม่มีตัวตนไม่ได้
 *
 * เดินฝั่งเจ้าหน้าที่จริง 2026-09-06: หน้าตรวจเอกสารแสดงปุ่ม "รับเอกสารนี้" กับทุกช่อง
 * รวมช่องที่ยังไม่ได้แนบไฟล์ · กดแล้วประตูบันทึก ACCEPTED ให้เรียบร้อย — วัดได้ในฐานข้อมูล
 * มีแถว ACCEPTED ของ `water_test` และ `soil_test` ซึ่งไม่มีไฟล์อยู่เลย
 *
 * ทำไมเป็นเรื่องใหญ่: `ACCEPT_ALL` ปฏิเสธเมื่อยังมีช่องบังคับที่ผลตรวจรอบนี้ไม่ใช่ ACCEPTED
 * ⇒ ถ้ารับช่องบังคับที่ไม่มีไฟล์ได้ คำขอก็เดินต่อไปพร้อมเอกสารที่ไม่เคยมีใครยื่น และการตรวจ
 * เอกสารทั้งขั้นก็ไม่เหลือความหมาย · บันทึกว่า "รับแล้ว" สำหรับกระดาษที่ไม่มีตัวตน ยังเป็น
 * ร่องรอยเท็จในสายการตรวจสอบตาม ISO/IEC 17065 §7.4 ด้วย
 *
 * สิ่งที่ต้อง **ไม่** เปลี่ยน: "ขอเอกสารเพิ่ม" กับช่องที่ยังไม่ได้แนบ ต้องทำได้ตามปกติ —
 * นั่นคือกรณีปกติที่สุดของปุ่มนั้น
 */
describe('รับเอกสารได้เฉพาะช่องที่มีเอกสารอยู่จริง', () => {
    const { assertReviewSlotState } = require('../../services/application-document-review-service');
    const attached = { slotId: 'sop_manual', satisfied: true, required: true };
    const empty = { slotId: 'water_test', satisfied: false, required: false };

    test('รับช่องที่แนบแล้ว = ผ่าน', () => {
        expect(assertReviewSlotState('ACCEPTED', attached)).toBe(true);
    });

    test('รับช่องที่ยังไม่ได้แนบ = ปฏิเสธ พร้อมรหัสที่ลงทะเบียนไว้', () => {
        expect(() => assertReviewSlotState('ACCEPTED', empty))
            .toThrow(expect.objectContaining({ code: 'REVIEW_SLOT_NOT_ATTACHED' }));
    });

    test('ขอเอกสารเพิ่มกับช่องที่ยังไม่ได้แนบ = ทำได้ นี่คือกรณีปกติของปุ่มนั้น', () => {
        expect(assertReviewSlotState('MORE_REQUESTED', empty)).toBe(true);
    });

    test('ขอเอกสารเพิ่มกับช่องที่แนบแล้ว = ทำได้ (ไฟล์ผิด อ่านไม่ออก หมดอายุ)', () => {
        expect(assertReviewSlotState('MORE_REQUESTED', attached)).toBe(true);
    });

    test('ไม่รู้จักช่องนั้น = ปฏิเสธ ไม่ใช่ปล่อยผ่าน', () => {
        expect(() => assertReviewSlotState('ACCEPTED', undefined))
            .toThrow(expect.objectContaining({ code: 'REVIEW_SLOT_NOT_ATTACHED' }));
    });
});
