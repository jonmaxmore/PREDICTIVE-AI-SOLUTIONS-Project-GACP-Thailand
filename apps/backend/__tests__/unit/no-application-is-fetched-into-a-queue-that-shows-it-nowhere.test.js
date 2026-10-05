'use strict';

/**
 * ทุกสถานะที่คิวผู้ตรวจเอกสาร "ดึงมา" ต้องมีที่ยืนบนหน้าจอ
 *
 * หัวไฟล์ reviewer-queue-where.js เขียนไว้เองว่ารายการสถานะนี้คือ "the document-review
 * pipeline, as the dashboard partitions it" — แต่หน้าจอแบ่งจริงแค่สามกอง และ KPI นับอีกสอง
 * สถานะ · เทียบกันแล้วเหลือ `AUDIT_FEE_PAID` ที่ถูกดึงมาจากฐานข้อมูล แล้ว **ไม่ปรากฏที่ไหนเลย**
 * ไม่อยู่ในกองไหน ไม่ถูกนับใน KPI ไหน · คำขอที่ผู้ตรวจอนุมัติไปแล้วและเกษตรกรเพิ่งจ่ายงวดสอง
 * จึงหายไปจากหน้าจอของคนที่รับผิดชอบมัน โดยไม่มีอะไรบอก
 *
 * และอีกทางหนึ่ง: ตัวแบ่งกอง `pendingReview` กรอง `DOC_FEE_PAID` ซึ่งคำสั่งค้นไม่เคยดึงมา
 * (reviewer.js:99) — เป็นกิ่งตายที่อ่านแล้วเข้าใจผิดว่าหน้านี้แสดงงานที่จ่ายเงินแล้วรอจ่ายงาน
 * ทั้งที่งานนั้นอยู่หน้าจ่ายงานของผู้ประสานงาน
 *
 * เทสนี้บังคับให้สองฝั่งเป็นชุดเดียวกันเสมอ ไม่ใช่สองรายการที่บังเอิญตรงกันวันนี้
 */

const {
    REVIEWER_QUEUE_STATUSES,
    REVIEWER_QUEUE_PARTITIONS,
} = require('../../services/application-service/reviewer-queue-where');

const shownSomewhere = () => new Set(Object.values(REVIEWER_QUEUE_PARTITIONS).flat());

describe('คิวผู้ตรวจเอกสาร — ดึงมาเท่าที่แสดง', () => {
    it('ทุกสถานะที่ดึงมา มีที่ยืนอย่างน้อยหนึ่งที่', () => {
        const shown = shownSomewhere();
        const orphans = REVIEWER_QUEUE_STATUSES.filter((s) => !shown.has(s));
        expect(orphans).toEqual([]);
    });

    it('ทุกสถานะที่หน้าจอจะแสดง ถูกดึงมาจริง — ไม่มีกิ่งตาย', () => {
        const fetched = new Set(REVIEWER_QUEUE_STATUSES);
        const neverFetched = [...shownSomewhere()].filter((s) => !fetched.has(s));
        expect(neverFetched).toEqual([]);
    });

    it('สามกองของหน้าจอยังอยู่ครบ และแยกจากกัน', () => {
        for (const key of ['pendingReview', 'awaitingRevision', 'approvedWaitingPhase2']) {
            expect(Array.isArray(REVIEWER_QUEUE_PARTITIONS[key])).toBe(true);
            expect(REVIEWER_QUEUE_PARTITIONS[key].length).toBeGreaterThan(0);
        }
        const counts = new Map();
        for (const s of Object.values(REVIEWER_QUEUE_PARTITIONS).flat()) {
            counts.set(s, (counts.get(s) || 0) + 1);
        }
        expect([...counts.entries()].filter(([, n]) => n > 1)).toEqual([]);
    });

    it('งานที่หมดเวลายังนับใน KPI ตามเดิม', () => {
        expect(REVIEWER_QUEUE_PARTITIONS.overdueOrExpired).toEqual(
            expect.arrayContaining(['EXPIRED', 'CANCEL_EXPIRED']),
        );
    });

    it('หน้าจอแบ่งกองจากรายการเดียวกันนี้ ไม่ได้พิมพ์สถานะซ้ำไว้เอง', () => {
        const src = require('fs').readFileSync(
            require('path').join(__dirname, '..', '..', 'routes', 'api', 'provider', 'handlers', 'reviewer.js'),
            'utf8',
        );
        expect(src).toContain('REVIEWER_QUEUE_PARTITIONS');
        expect(src).not.toMatch(/\['ASSIGNED_FOR_REVIEW',\s*'DOC_FEE_PAID'\]/);
    });
});
