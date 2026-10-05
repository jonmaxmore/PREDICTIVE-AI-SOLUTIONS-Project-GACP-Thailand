/**
 * The officer's per-slot document check — กทล.๑ ส่วนสำหรับเจ้าหน้าที่ ข้อ ๑.๑
 *
 * ── WHY PER SLOT ──────────────────────────────────────────────────────────────
 * The platform's review has been all-or-nothing: an officer accepts a filing or
 * sends it back with a free-text note. A filing with nine papers and one problem
 * therefore reaches the applicant as "แก้ไข", and they have to work out which
 * paper — often by re-uploading everything, which loses the officer's place too.
 *
 * The ministry's own form does not work that way. ส่วน จนท. ข้อ ๑.๑ is a line per
 * document, ticked one at a time. This service records exactly that: one verdict
 * per slot per round, so the applicant is asked to fix ONE paper and the officer
 * keeps every other line they already accepted.
 *
 * ── WHAT IS PURE HERE AND WHY ─────────────────────────────────────────────────
 * The rules below take data and return an answer. They open no transaction and
 * touch no table, so the refusals can be exercised exhaustively without standing
 * up a database — and the doors in routes/api/provider/document-reviews.js hold
 * nothing but wiring. A rule that can only be tested through an HTTP door is a
 * rule that mostly is not tested.
 *
 * @module services/application-document-review-service
 */

'use strict';

const { isWorkingDay } = require('../utils/working-days');

const DOCUMENT_REVIEW_VERDICTS = Object.freeze(['ACCEPTED', 'MORE_REQUESTED']);
const DOCUMENT_DECISIONS = Object.freeze(['ACCEPT_ALL', 'REQUEST_MORE']);

const REVIEW_REASON_REQUIRED = 'REVIEW_REASON_REQUIRED';
const REVIEW_DUE_DATE_INVALID = 'REVIEW_DUE_DATE_INVALID';
const DOCUMENT_CHECK_INCOMPLETE = 'DOCUMENT_CHECK_INCOMPLETE';
const DOCUMENT_CHECK_NOTHING_REQUESTED = 'DOCUMENT_CHECK_NOTHING_REQUESTED';
const REVISION_INCOMPLETE = 'REVISION_INCOMPLETE';
const DOCUMENT_SLOT_ALREADY_ACCEPTED = 'DOCUMENT_SLOT_ALREADY_ACCEPTED';

/**
 * Short enough to type in a hurry, long enough to be a sentence.
 *
 * "ไม่ชัด" tells an applicant nothing they can act on, and a reason nobody can act
 * on turns a request for one paper into a rejection of the filing.
 */
const MIN_REASON_LENGTH = 10;

function refuse(code, message, messageTh, extra = {}) {
    return Object.assign(new Error(message), { code, messageTh, ...extra });
}

/**
 * Validate ONE slot verdict before it is written.
 *
 * @param {{verdict: string, reason?: string, dueDate?: Date|string}} input
 * @throws VALIDATION_ERROR · REVIEW_REASON_REQUIRED · REVIEW_DUE_DATE_INVALID
 */
function assertReviewInput({ verdict, reason, dueDate } = {}) {
    if (!DOCUMENT_REVIEW_VERDICTS.includes(verdict)) {
        throw refuse(
            'VALIDATION_ERROR',
            `verdict must be one of ${DOCUMENT_REVIEW_VERDICTS.join(', ')}`,
            'ผลการตรวจไม่ถูกต้อง',
        );
    }
    if (verdict === 'ACCEPTED') {
        return true;
    }

    // MORE_REQUESTED — the applicant has to be able to act on this.
    const text = typeof reason === 'string' ? reason.trim() : '';
    if (text.length < MIN_REASON_LENGTH) {
        throw refuse(
            REVIEW_REASON_REQUIRED,
            'A reason of at least 10 characters is required when requesting more documents',
            'กรุณาระบุเหตุผลที่ขอเอกสารเพิ่ม เพื่อให้ผู้ยื่นทราบว่าต้องแก้ไขอะไร',
        );
    }

    const due = dueDate instanceof Date ? dueDate : new Date(dueDate);
    if (!dueDate || Number.isNaN(due.getTime())) {
        throw refuse(
            REVIEW_DUE_DATE_INVALID,
            'A due date is required when requesting more documents',
            'กรุณากำหนดวันครบกำหนดส่งเอกสารเพิ่ม',
        );
    }
    if (!isWorkingDay(due)) {
        // The calendar lives in utils/working-days.js — weekends AND Thai public
        // holidays. A deadline the applicant cannot act on is unfair from the
        // moment it is set, and the officer usually does not mean it.
        throw refuse(
            REVIEW_DUE_DATE_INVALID,
            'The due date must fall on a working day',
            'วันครบกำหนดต้องเป็นวันทำการ กรุณาเลือกวันอื่น',
        );
    }
    return true;
}

/**
 * Can the officer take this decision, given the current round's verdicts?
 *
 * @param {'ACCEPT_ALL'|'REQUEST_MORE'} action
 * @param {Array<{slotId: string, required: boolean, verdict: string|null}>} slots
 * @returns {{ok: true, requestedSlotIds?: string[]}}
 */
/**
 * ผลตรวจต้องสอดคล้องกับสิ่งที่มีอยู่จริงในคำขอ
 *
 * "รับเอกสารนี้" คือการรับรองว่าเจ้าหน้าที่ได้เห็นเอกสารแล้วและใช้ได้ · ถ้าไม่มีไฟล์อยู่เลย
 * ก็ไม่มีอะไรให้รับ · เดินฝั่งเจ้าหน้าที่จริง 2026-09-06 พบว่าหน้าจอแสดงปุ่มนี้กับทุกช่อง
 * รวมช่องที่ยังไม่ได้แนบ และประตูก็บันทึกให้ — ฐานข้อมูลจึงมีแถว ACCEPTED ของ water_test
 * กับ soil_test ที่ไม่เคยมีไฟล์
 *
 * เหตุผลที่ต้องกันตรงนี้ ไม่ใช่แค่ที่หน้าจอ: `ACCEPT_ALL` ปฏิเสธก็ต่อเมื่อยังมีช่องบังคับที่
 * ผลตรวจไม่ใช่ ACCEPTED ⇒ รับช่องบังคับที่ว่างเปล่าได้เมื่อไร คำขอก็ผ่านด่านตรวจเอกสารทั้ง
 * ที่กระดาษไม่เคยมา และบันทึกการรับก็กลายเป็นร่องรอยเท็จในสายการตรวจสอบ (ISO/IEC 17065 §7.4)
 *
 * "ขอเอกสารเพิ่ม" กับช่องว่างยังทำได้ตามปกติ — นั่นคือเหตุผลหลักที่ปุ่มนั้นมีอยู่
 *
 * @param {string} verdict ACCEPTED | MORE_REQUESTED
 * @param {{slotId?: string, satisfied?: boolean}|undefined} slot แถวของช่องนั้นจากคำตอบของ lens
 */
function assertReviewSlotState(verdict, slot) {
    if (verdict !== 'ACCEPTED') { return true; }
    if (slot && slot.satisfied === true) { return true; }
    throw refuse(
        'REVIEW_SLOT_NOT_ATTACHED',
        'A slot with no attached document cannot be accepted',
        'ยังไม่มีเอกสารในรายการนี้ให้ตรวจ จึงรับไม่ได้ หากต้องการให้ผู้ยื่นส่งเพิ่ม ให้เลือก "ขอเอกสารเพิ่ม"',
    );
}

function decideDocumentOutcome(action, slots = [], context = {}) {
    if (!DOCUMENT_DECISIONS.includes(action)) {
        throw refuse(
            'VALIDATION_ERROR',
            `action must be one of ${DOCUMENT_DECISIONS.join(', ')}`,
            'คำสั่งไม่ถูกต้อง',
        );
    }
    const rows = Array.isArray(slots) ? slots : [];

    if (action === 'ACCEPT_ALL') {
        // An EMPTY checklist is not a passed checklist. Every identity and
        // qualification rule in the register binds requestType='NEW', so a
        // REPLACEMENT (and, until the register is widened, a RENEWAL) resolves to
        // zero required slots — and the filter below then found no blockers and let
        // the officer accept a filing evidenced by nothing at all, while the
        // checklist's `.every()` on the same empty list printed ครบถ้วน.
        // Every lawful filing owes at least an identity paper; zero required slots
        // means the register has nothing filed for this case, which is a reason to
        // STOP, not to approve.
        // Operator approved P1/P2 on 2026-09-06: a succeeding request re-proves identity, so
        // EVERY lawful filing now owes at least one paper. Zero required slots therefore always
        // means the register has nothing filed for this case — a reason to STOP, never to
        // approve on paper that does not exist. (`context` is kept: the door passes the request
        // type, and a future case-specific message can read it without another signature change.)
        if (!rows.some((s) => s.required === true)) {
            throw refuse(
                DOCUMENT_CHECK_INCOMPLETE,
                'This filing has no required documents at all — nothing to review',
                'คำขอนี้ไม่มีเอกสารที่ต้องตรวจแม้แต่รายการเดียว จึงยังรับคำขอไม่ได้ '
                + 'กรุณาแจ้งผู้ดูแลระบบเพื่อตรวจสอบกติกาเอกสารของคำขอประเภทนี้',
                { slotIds: [] },
            );
        }
        // OPTIONAL slots never block. review-completeness is law: a paper the
        // ministry did not demand is not something the filing lacks, and an
        // officer must not be stopped by one.
        const blocking = rows
            .filter((s) => s.required === true && s.verdict !== 'ACCEPTED')
            .map((s) => s.slotId);
        if (blocking.length > 0) {
            throw refuse(
                DOCUMENT_CHECK_INCOMPLETE,
                `Required documents not yet accepted: ${blocking.join(', ')}`,
                'ยังมีเอกสารที่จำเป็นซึ่งยังไม่ได้รับ กรุณาตรวจให้ครบก่อนรับคำขอ',
                // Named, so the screen can point at the rows instead of making
                // the officer re-read every line to find the one that blocks.
                { slotIds: blocking },
            );
        }
        return { ok: true };
    }

    // REQUEST_MORE — an optional paper CAN be the thing asked for. Offering is
    // not demanding, but once an officer asks, they have asked.
    const requestedSlotIds = rows
        .filter((s) => s.verdict === 'MORE_REQUESTED')
        .map((s) => s.slotId);
    if (requestedSlotIds.length === 0) {
        throw refuse(
            DOCUMENT_CHECK_NOTHING_REQUESTED,
            'No slot is marked MORE_REQUESTED',
            'ยังไม่ได้เลือกเอกสารที่ต้องการเพิ่ม กรุณาระบุอย่างน้อยหนึ่งรายการ',
        );
    }
    return { ok: true, requestedSlotIds };
}

/**
 * Which round the officer is working in.
 *
 * Rounds are append-only. A resubmit opens N+1 and the round-N verdicts stay
 * exactly as they were: they are the record of what was asked, of whom, and
 * when — which is the thing an applicant appeals against and an auditor reads.
 *
 * @param {Array<{round:number}>} reviews
 * @param {{open?: boolean}} [opts] open:true → the round a resubmit starts
 */
function nextRound(reviews = [], { open = false } = {}) {
    const highest = (Array.isArray(reviews) ? reviews : [])
        .reduce((max, r) => Math.max(max, Number(r && r.round) || 0), 0);
    if (highest === 0) { return 1; }
    return open ? highest + 1 : highest;
}

/**
 * ส่งกลับให้เจ้าหน้าที่ตรวจ — every requested paper must be NEWER than the request.
 *
 * The test is deliberately not "is a file attached": one WAS attached when the
 * officer rejected it. It is "was it replaced after we asked", because a filing
 * returned with the same scan is a round trip that teaches the applicant nothing
 * and costs the officer a second reading of a document they already refused.
 *
 * Each slot is judged against ITS OWN request time. Round 2 can ask again for a
 * paper the applicant replaced in round 1, and one shared timestamp would let
 * that stale file through.
 *
 * @param {Array<{slotId: string, createdAt: Date|string}>} requestedRows
 *        the current round's MORE_REQUESTED review rows
 * @param {Array<{slotId: string, uploadedAt: Date|string}>} documents
 *        what the applicant has attached for those slots
 * @throws REVISION_INCOMPLETE (409) naming every slot still stale
 */
function assertRevisionSlotsRefreshed(requestedRows = [], documents = []) {
    const rows = Array.isArray(requestedRows) ? requestedRows : [];
    const docs = Array.isArray(documents) ? documents : [];

    if (rows.length === 0) {
        // Reaching a resubmit with nothing outstanding means the filing is in
        // REVISION_REQUESTED for a reason nobody recorded. Passing it on would
        // hand the officer a filing with no note of what changed.
        throw refuse(
            REVISION_INCOMPLETE,
            'No outstanding document request for this application',
            'ไม่พบรายการเอกสารที่เจ้าหน้าที่ขอเพิ่มสำหรับคำขอนี้ กรุณาติดต่อเจ้าหน้าที่',
            { slotIds: [] },
        );
    }

    /** The newest upload for a slot — an older copy left behind proves nothing. */
    const newestFor = (slotId) => docs
        .filter((d) => d && d.slotId === slotId && d.uploadedAt)
        .map((d) => new Date(d.uploadedAt).getTime())
        .filter((t) => !Number.isNaN(t))
        .reduce((max, t) => Math.max(max, t), -Infinity);

    const stale = rows.filter((row) => {
        const askedAt = new Date(row.createdAt).getTime();
        if (Number.isNaN(askedAt)) { return true; }
        // Strictly newer: an upload at the same instant cannot have been a
        // response to the request, and accepting it lets a filing through on a
        // coincidence.
        return newestFor(row.slotId) <= askedAt;
    }).map((row) => row.slotId);

    if (stale.length > 0) {
        throw refuse(
            REVISION_INCOMPLETE,
            `Documents not yet replaced: ${stale.join(', ')}`,
            'ยังมีเอกสารที่ยังไม่ได้อัปโหลดฉบับใหม่ กรุณาอัปโหลดให้ครบก่อนส่งกลับให้เจ้าหน้าที่',
            { slotIds: stale },
        );
    }
    return true;
}

/**
 * ช่องที่เจ้าหน้าที่กด "ผ่าน" แล้ว อัปทับไม่ได้
 *
 * operator 2026-09-11: *"ถ้าเจ้าหน้าที่ผ่านไปแล้ว ไม่สามารถกลับมาแก้เอกสารได้"* และ
 * *"คือเคสผ่านแล้วจะกลับมาแก้ทำไม ที่แก้ต้องเป็นเพราะยังไม่ผ่าน"*
 *
 * ── ช่องโหว่ที่ด่านนี้ปิด ──
 * คำขอที่ถูกตีกลับอยู่ในสถานะ REVISION_REQUESTED ซึ่ง EDITABLE_STATUSES เปิดให้แก้
 * **ทั้งใบ** แต่เจ้าหน้าที่ตัดสิน **รายช่อง** ⇒ ผู้ยื่นอัปทับช่องที่ผ่านไปแล้วได้
 * และประตูอัปโหลดไม่เคยถามตารางผลตรวจเลยสักครั้ง
 *
 * ที่ทำให้มันเงียบเป็นพิเศษ: คำตัดสินผูกกับ `(applicationId, slotId, round)` —
 * **กับช่อง ไม่ใช่กับใบเอกสาร** ⇒ เปลี่ยนกระดาษแล้วแถว ACCEPTED เดิมยังอยู่ครบ
 * กลายเป็นคำตัดสินของกระดาษที่ไม่ได้อยู่ตรงนั้นแล้ว โดยไม่มีร่องรอยใดในฐานข้อมูล
 *
 * ── ตัดสินด้วยรอบล่าสุดของช่องนั้น ──
 * ไม่ใช่ "เคยมี ACCEPTED ไหม" เพราะเจ้าหน้าที่กลับคำได้ในรอบถัดไป: ACCEPTED รอบ 1
 * แล้ว MORE_REQUESTED รอบ 2 แปลว่าเปิดให้แก้อีกครั้ง · และไม่ใช่ลำดับในอาเรย์
 * เพราะลำดับที่แถวถูกอ่านมาไม่ใช่กติกา
 *
 * ไม่มีคำตัดสินเลย = ยังไม่เคยถูกตรวจ = แก้ได้ตามปกติ ⇒ ด่านนี้เงียบสนิทตลอดช่วงร่าง
 * และการยื่นครั้งแรก ซึ่งเป็นตอนที่ยังไม่มีใครตัดสินอะไร
 *
 * @param {{slotId: string|null, reviews: Array<{slotId: string, verdict: string, round: number}>}} args
 * @throws DOCUMENT_SLOT_ALREADY_ACCEPTED (409)
 */
function assertSlotNotAlreadyAccepted({ slotId, reviews } = {}) {
    // อัปโหลดที่ไม่สังกัดช่องใด ไม่มีคำตัดสินให้ขัดกับมันได้
    if (!slotId) { return true; }
    const rows = Array.isArray(reviews) ? reviews : [];

    const latest = rows
        .filter((r) => r && r.slotId === slotId)
        .reduce((best, r) => (best === null || Number(r.round) > Number(best.round) ? r : best), null);

    if (latest && latest.verdict === 'ACCEPTED') {
        throw Object.assign(
            refuse(
                DOCUMENT_SLOT_ALREADY_ACCEPTED,
                `slot ${slotId} was already accepted by a reviewer and cannot be replaced`,
                'เอกสารช่องนี้เจ้าหน้าที่ตรวจผ่านแล้ว จึงเปลี่ยนไม่ได้ — '
                + 'สิ่งที่แก้ได้คือช่องที่เจ้าหน้าที่ขอให้แก้เท่านั้น '
                + 'หากเอกสารที่ผ่านไปแล้วไม่ถูกต้อง กรุณาติดต่อเจ้าหน้าที่',
            ),
            { statusCode: 409, slotId },
        );
    }
    return true;
}

module.exports = {
    assertSlotNotAlreadyAccepted,
    DOCUMENT_SLOT_ALREADY_ACCEPTED,
    assertReviewInput,
    assertReviewSlotState,
    decideDocumentOutcome,
    assertRevisionSlotsRefreshed,
    nextRound,
    DOCUMENT_REVIEW_VERDICTS,
    DOCUMENT_DECISIONS,
    MIN_REASON_LENGTH,
    REVIEW_REASON_REQUIRED,
    REVIEW_DUE_DATE_INVALID,
    DOCUMENT_CHECK_INCOMPLETE,
    DOCUMENT_CHECK_NOTHING_REQUESTED,
    REVISION_INCOMPLETE,
};
