/**
 * ทุกคำถามที่ wizard ถาม ต้องมีที่ให้คำตอบไปลง
 *
 * `WIZARD_OWNED_FORM_DATA_KEYS` เป็นด่านความปลอดภัยโดยตั้งใจ — คีย์ที่ไม่อยู่ในรายการ
 * เขียนไม่ได้ และนั่นถูกแล้ว แต่ผลข้างเคียงคือ **คีย์ที่ลืมใส่จะถูกทิ้งเงียบ ๆ**: ไม่มี error
 * ไม่มี 400 การบันทึกตอบ 200 และคำตอบของผู้ยื่นก็หายไประหว่างทาง
 *
 * เกิดขึ้นแล้วจริงกับ wizard หกขั้น (2026-09-06): ขั้นที่ 1 ถามประเภทคำขอ ขอบเขตการรับรอง
 * และประเภทผู้ยื่น · ขั้นที่ 4 ถามพันธุ์และการแปรรูป · ทั้งเจ็ดฟิลด์ไม่อยู่ในรายการนี้ ⇒
 * เดินผ่านทั้งหกขั้นแล้วกดบันทึก คำขอที่เซิร์ฟเวอร์เก็บไว้ไม่รู้ว่าเป็นคำขอประเภทไหนด้วยซ้ำ
 *
 * เทสนี้อ่าน **ชนิดของสถานะฝั่งเบราว์เซอร์** เป็นแหล่งความจริงของ "wizard ถามอะไรบ้าง"
 * แล้วบังคับว่าทุกฟิลด์ต้องอยู่ขั้วใดขั้วหนึ่ง: เขียนได้ หรือประกาศไว้ชัดว่าไม่เก็บและเพราะอะไร
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { pickWizardOwnedFormData } = require('../../routes/api/helpers/application-constants');

const STATE_TYPES = path.join(
    __dirname, '..', '..', '..', 'web-app', 'src', 'app', 'health', 'applications', 'new',
    '_steps', 'hooks', 'use-application-flow-store.state-types.ts',
);

/**
 * ฟิลด์ของสถานะที่ **ไม่ใช่คำตอบ** จึงไม่ต้องเดินทางไปเซิร์ฟเวอร์
 * ทุกบรรทัดต้องบอกได้ว่าทำไม — รายการนี้คือที่ทางของการยกเว้น ไม่ใช่ที่ซ่อนของที่ลืม
 */
const NOT_AN_ANSWER = Object.freeze({
    currentStep: 'ส่งแยกเป็น payload.step และเซิร์ฟเวอร์ตัดสินเองว่าไปถึงขั้นไหนได้',
    // สองข้อนี้ **เป็นคำตอบของผู้ยื่น** แต่เป็นคำตอบที่ผู้ยื่นเขียนเองไม่ได้ — ทั้งคู่เป็นมิติที่
    // **ลด** ข้อกำหนดได้ (REPLACEMENT ถูกตัดสินด้วยสองแถวแทนทั้งชุด ส่วนที่ ๓ · PLANTING ข้าม
    // ใบอนุญาตสมุนไพรควบคุมที่ PROCESSING ต้องมี) ⇒ ผู้ยื่นที่เขียนได้ = เลือกกฎที่จะตัดสินตัวเอง
    // (shared/form-data-ownership.js:94) · wizard ถามคำถาม ส่วนประตูที่ "ตรวจแล้วจึงเขียน" คือคน
    // เขียน และประตูนั้นยังไม่มี — F-APPV2-02
    requestType: 'มิติของกฎที่ลดข้อกำหนดได้ — ต้องมีประตูที่ตรวจก่อนเขียน (F-APPV2-02)',
    certScope: 'มิติของกฎที่ลดข้อกำหนดได้ — ต้องมีประตูที่ตรวจก่อนเขียน (F-APPV2-02)',
    syncStatus: 'สถานะการบันทึกของฝั่งเบราว์เซอร์',
    // สามข้อนี้เป็นบัญชีภายในของการบันทึกฝั่งเบราว์เซอร์ อยู่ใน NOT_SENT_KEYS
    // (web-app use-auto-save.ts HASH_EXEMPT_KEYS) จึงไม่เคยถูกส่งออกไป
    hydrationEpoch: 'บัญชีการบันทึกฝั่งเบราว์เซอร์ (นับรอบการโหลดร่าง O1) ไม่เคยถูกส่ง',
    resumePending: 'บัญชีการบันทึกฝั่งเบราว์เซอร์ (พักบันทึกระหว่างโหลดร่าง รอบ 2) ไม่เคยถูกส่งและไม่ถูกเก็บลง IndexedDB',
    ownerUserId: 'บัญชีฝั่งเบราว์เซอร์ว่าคำตอบเป็นของผู้ใช้คนไหน (รอบ 5b) ไม่เคยถูกส่ง',
    applicationId: 'เซิร์ฟเวอร์เป็นคนออกให้',
    applicationNumber: 'เซิร์ฟเวอร์เป็นคนออกให้',
    createdAt: 'เซิร์ฟเวอร์ประทับเอง',
    updatedAt: 'เซิร์ฟเวอร์ประทับเอง',
    milestone1: 'ใบเสนอราคาและยอดเงินของงวดที่ 1 — ระบบการเงินเป็นเจ้าของ ผู้ยื่นเขียนไม่ได้ (L3) '
        + 'สโตร์ถือไว้เพื่อ "แสดง" สิ่งที่เซิร์ฟเวอร์ตอบมาเท่านั้น',
    estimatedFee: 'ค่าธรรมเนียมคำนวณจากตารางอัตราที่มีวันที่กำกับ ไม่ใช่ค่าที่ผู้ยื่นส่งมา',
});

/** อ่านชื่อฟิลด์จาก interface WizardState — แหล่งความจริงเดียวว่า wizard ถืออะไรอยู่ */
function wizardStateFields() {
    const src = fs.readFileSync(STATE_TYPES, 'utf8');
    const start = src.indexOf('interface WizardState');
    expect(start).toBeGreaterThan(-1);
    const body = src.slice(src.indexOf('{', start), src.indexOf('\n}', start));
    return body.split('\n')
        .map((line) => line.match(/^\s{4}([a-zA-Z][a-zA-Z0-9]*)\??:/))
        .filter(Boolean)
        .map((m) => m[1]);
}

describe('คำตอบของ wizard ทุกข้อ มีที่ให้ลงบนเซิร์ฟเวอร์', () => {
    const fields = wizardStateFields();

    test('อ่านชนิดของสถานะได้จริง ไม่ใช่รายการว่าง', () => {
        expect(fields.length).toBeGreaterThan(20);
        expect(fields).toContain('requestType');
    });

    test('ไม่มีฟิลด์ไหนหายไปเงียบ ๆ — เขียนได้ หรือประกาศว่าไม่เก็บ', () => {
        const probe = {};
        fields.forEach((f) => { probe[f] = `ค่าของ-${f}`; });
        const kept = pickWizardOwnedFormData(probe);

        const dropped = fields.filter((f) => !(f in kept) && !(f in NOT_AN_ANSWER));
        expect(dropped).toEqual([]);
    });

    test('ห้าฟิลด์ของขั้น 1 และขั้น 4 ที่ผู้ยื่นเขียนได้ เขียนลงได้จริง', () => {
        const answers = {
            applicantType: 'JURISTIC', previousCertificateNumber: 'GACP-TH-2569-ABCDEF',
            varieties: [{ name: 'พันธุ์ทดสอบ' }], varietiesNote: 'หมายเหตุ',
            processing: { method: 'อบแห้ง' },
        };
        expect(pickWizardOwnedFormData(answers)).toEqual(answers);
    });

    test('requestType และ certScope ผู้ยื่นเขียนเองไม่ได้ — เป็นการเลือกกฎที่จะตัดสินตัวเอง', () => {
        expect(pickWizardOwnedFormData({ requestType: 'REPLACEMENT', certScope: 'PLANTING' })).toEqual({});
    });

    test('ของที่เซิร์ฟเวอร์เป็นเจ้าของ ยังเขียนทับไม่ได้เหมือนเดิม', () => {
        const forged = { status: 'APPROVED', estimatedFee: 1, workflowState: 'x', submittedAt: '2020-01-01' };
        expect(pickWizardOwnedFormData(forged)).toEqual({});
    });
});
