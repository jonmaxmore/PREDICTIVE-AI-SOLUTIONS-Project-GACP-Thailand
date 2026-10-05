/**
 * งานที่มอบหมายให้ใคร คนนั้นต้องเห็นมันในรายการของตัวเอง
 *
 * เจอจากการเดินฝั่งพนักงานจริง 2026-09-05 บนฐานที่ตั้งใหม่จากศูนย์:
 *
 *   1. ผู้จัดตารางเปิด `/provider/scheduler/reviewers` — รายชื่อนี้ **ตั้งใจ** รวมผู้ตรวจแปลงด้วย
 *      (`reviewerRoles = [DOCUMENT_REVIEWER, AUDITOR]`, scheduler-assign-reviewer-handler.js:272)
 *   2. มอบหมายผู้ตรวจแปลงคนหนึ่งเป็นผู้ตรวจเอกสาร → 200 · `reviewerId` ถูกเขียนจริง
 *      สถานะขยับเป็น ASSIGNED_FOR_REVIEW จริง
 *   3. คนนั้นเข้าระบบ → `GET /provider/applications` คืน **0 รายการ**
 *
 * สาเหตุ: สาขา AUDITOR ของตัวกรองการมองเห็นดูแค่ `auditorId` / `headAuditorId` /
 * `(sameReviewerAuditor && reviewerId)` · การมอบหมายผู้ตรวจเอกสารเขียนแค่ `reviewerId`
 * และปล่อย `sameReviewerAuditor: false` (ธงนั้นแปลว่า *คนเดียวกันทำทั้งสองบทบาทของคำขอนี้*
 * ซึ่งยังไม่จริง ณ เวลามอบหมาย — ธงไม่ได้ผิด สาขาการมองเห็นต่างหากที่แคบไป)
 *
 * ⇒ งานถูกมอบหมายให้คนที่มองไม่เห็นมัน · เปิดได้ถ้ารู้ id เท่านั้น ซึ่งไม่ใช่วิธีที่คนทำงาน
 * เป็นสภาพเดียวกับที่ seed เคยสร้างไว้: งานที่ไม่มีใครหยิบได้
 *
 * ทางแก้: ให้ผู้ตรวจแปลงเห็นคำขอที่ `reviewerId` เป็นตัวเอง — **กฎเดียวกับที่สาขา
 * DOCUMENT_REVIEWER ใช้อยู่แล้ว** ("คุณเห็นสิ่งที่มอบหมายให้คุณ") ไม่ใช่กฎใหม่ และรั่วไม่ได้
 * เพราะมันแสดงคำขอให้เฉพาะคนที่ผู้จัดตารางมอบหมายให้เท่านั้น · ธง sameReviewerAuditor
 * ไม่ถูกแตะ มันยังคงหมายความตามชื่อของมัน
 */
'use strict';

const { applicationVisibilityFilter } = require('../../shared/application-visibility');

const auditor = { id: 'auditor-1', canonicalRole: 'field_inspector' };
const reviewer = { id: 'reviewer-1', canonicalRole: 'document_reviewer' };

/**
 * ประเมินตัวกรองกับ "แถว" จริง แทนการดูรูปร่างของมัน
 *
 * เวอร์ชันแรกของเทสนี้แผ่ OR/AND ออกมาแล้วถามว่ามีเงื่อนไข `reviewerId` อยู่ไหม — **มันผ่าน
 * ทั้งที่ยังไม่ได้แก้อะไร** เพราะการแผ่ทำให้เงื่อนไขที่ถูกครอบด้วย `AND: [{sameReviewerAuditor:
 * true}, {reviewerId}]` ดูเหมือนเงื่อนไขเดี่ยว · การถามว่า "แถวนี้ผ่านตัวกรองไหม" ตอบคำถามจริง
 * ที่เราสนใจ และโกหกแบบนั้นไม่ได้
 */
function matches(filter, row) {
    if (!filter || typeof filter !== 'object') { return true; }
    if (Array.isArray(filter.OR)) { return filter.OR.some((f) => matches(f, row)); }
    if (Array.isArray(filter.AND)) { return filter.AND.every((f) => matches(f, row)); }
    return Object.entries(filter).every(([k, v]) => {
        if (k === 'OR' || k === 'AND') { return true; }
        if (v && typeof v === 'object' && 'path' in v) { return false; }  // legacy JSON fallback
        return row[k] === v;
    });
}

describe('ผู้ตรวจแปลงที่ถูกมอบหมายให้ตรวจเอกสาร', () => {
    /** แถวจริงที่ประตูมอบหมายเขียนไว้: reviewerId ถูกตั้ง ธง sameReviewerAuditor ยังเป็น false */
    const assignedToMeForReview = {
        reviewerId: 'auditor-1', auditorId: null, headAuditorId: null, sameReviewerAuditor: false,
    };

    test('เห็นคำขอที่มอบหมายให้ตัวเองตรวจเอกสาร แม้ธง sameReviewerAuditor ยังเป็น false', () => {
        expect(matches(applicationVisibilityFilter(auditor), assignedToMeForReview)).toBe(true);
    });

    test('ยังเห็นงานตรวจแปลงของตัวเองตามเดิม — ไม่ได้แลกอะไรไป', () => {
        const f = applicationVisibilityFilter(auditor);
        expect(matches(f, { auditorId: 'auditor-1' })).toBe(true);
        expect(matches(f, { headAuditorId: 'auditor-1' })).toBe(true);
        expect(matches(f, { sameReviewerAuditor: true, reviewerId: 'auditor-1' })).toBe(true);
    });

    test('ไม่เห็นงานของคนอื่น — ทั้งงานตรวจเอกสารและงานตรวจแปลง', () => {
        const f = applicationVisibilityFilter(auditor);
        expect(matches(f, { reviewerId: 'someone-else', auditorId: null, headAuditorId: null, sameReviewerAuditor: false })).toBe(false);
        expect(matches(f, { auditorId: 'someone-else' })).toBe(false);
        expect(matches(f, {})).toBe(false);
    });

    test('ผู้ตรวจแปลงที่ไม่มี id ยังถูกปฏิเสธแบบ fail-closed', () => {
        expect(JSON.stringify(applicationVisibilityFilter({ canonicalRole: 'field_inspector' })))
            .toContain('__no_user_id__');
    });

    test('กฎของผู้ตรวจเอกสารไม่เปลี่ยน', () => {
        const f = applicationVisibilityFilter(reviewer);
        expect(matches(f, { reviewerId: 'reviewer-1' })).toBe(true);
        expect(matches(f, { reviewerId: 'someone-else' })).toBe(false);
    });
});
