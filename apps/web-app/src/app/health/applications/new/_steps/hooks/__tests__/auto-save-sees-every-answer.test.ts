/**
 * การแก้ไขที่เครื่องมองไม่เห็น = คำตอบที่หายไปเงียบ ๆ
 *
 * `buildStateHash` เป็นตัวตัดสินว่า "มีอะไรเปลี่ยนไหม" ถ้าแฮชเท่าเดิม autosave ไม่ยิง
 * ร่างคำขอไม่ถูกสร้าง `applicationId` ไม่มี และขั้น 2/3/5 ที่ดึงรายการเอกสารด้วย id นั้น
 * ก็ไม่แสดงการ์ดเอกสารสักใบ — ผู้ยื่นเห็นแบบฟอร์มเปล่า ๆ โดยไม่มีข้อความบอกว่าทำไม
 *
 * มันเคยเป็น **รายการอนุญาต** ที่พิมพ์ชื่อฟิลด์ไว้ด้วยมือ และรายการนั้นค้างอยู่ที่ wizard รุ่นเก่า
 * เจอตอนเดินจริงผ่านเบราว์เซอร์ 2026-09-06: ตอบขั้นที่ 1 ครบทั้งสามคำถามแล้วรอ 6 วินาที
 * ป้ายยังเขียนว่า "พร้อมบันทึก" ไม่เคยเปลี่ยนเป็น "บันทึกแล้ว" — ไม่มีอะไรถูกบันทึกเลย
 *
 * เจ็ดฟิลด์ที่หายไป: requestType · certScope · applicantType · previousCertificateNumber
 * (ขั้น 1) · varieties · varietiesNote · processing (ขั้น 4)
 *
 * เทสนี้จึงไม่ตรวจ "เจ็ดชื่อนี้อยู่ในรายการไหม" เพราะนั่นคือรายการเดิมที่ค้างได้อีก แต่ตรวจว่า
 * **ฟิลด์ใดก็ตามของสถานะ เมื่อเปลี่ยนแล้วต้องทำให้แฮชเปลี่ยน** ยกเว้นรายการทำบัญชีที่ระบุชัด
 */
import { describe, expect, it } from '@jest/globals';
import { buildStateHash, HASH_EXEMPT_KEYS, wizardHasStarted, answersForDraft } from '../use-auto-save';

/** สถานะตั้งต้นแบบที่ wizard ใช้จริง — ค่าไม่ต้องสมจริง ขอแค่มีครบทุกคีย์ */
const BASE = {
    currentStep: 1,
    plantId: 'cannabis',
    requestType: 'NEW',
    certScope: 'PLANTING',
    applicantType: 'COMMUNITY_ENTERPRISE',
    previousCertificateNumber: null,
    serviceType: 'NEW',
    serviceTypes: [],
    certificationPurposes: [],
    siteTypes: [],
    consentedPDPA: false,
    acknowledgedStandards: false,
    applicantData: null,
    farmData: null,
    plots: [],
    lots: [],
    documents: [],
    varieties: [],
    varietiesNote: null,
    processing: null,
    cultivationMethods: [],
    // รายการทำบัญชี — เปลี่ยนเพราะการบันทึกเอง ไม่ใช่เพราะผู้ใช้พิมพ์อะไร
    syncStatus: 'idle',
    applicationId: undefined,
    applicationNumber: undefined,
    createdAt: undefined,
    updatedAt: undefined,
} as unknown as Parameters<typeof buildStateHash>[0];

/** ค่าที่ต่างจากเดิมแน่นอน ไม่ว่าฟิลด์นั้นจะเป็นชนิดใด */
function mutate(value: unknown): unknown {
    if (Array.isArray(value)) return [...value, 'changed'];
    if (typeof value === 'number') return value + 1;
    if (typeof value === 'boolean') return !value;
    if (value === null || value === undefined) return 'changed';
    if (typeof value === 'object') return { ...(value as object), changed: true };
    return `${String(value)}-changed`;
}

describe('autosave มองเห็นทุกคำตอบที่ wizard เขียน', () => {
    const answerKeys = Object.keys(BASE).filter((k) => !HASH_EXEMPT_KEYS.includes(k));

    it.each(answerKeys)('เปลี่ยน %s แล้วแฮชต้องเปลี่ยน', (key) => {
        const before = buildStateHash(BASE);
        const after = buildStateHash({ ...BASE, [key]: mutate((BASE as Record<string, unknown>)[key]) } as typeof BASE);
        expect(after).not.toBe(before);
    });

    it.each(HASH_EXEMPT_KEYS)('%s เป็นรายการทำบัญชี เปลี่ยนแล้วแฮชต้องนิ่ง', (key) => {
        const before = buildStateHash(BASE);
        const after = buildStateHash({ ...BASE, [key]: mutate((BASE as Record<string, unknown>)[key]) } as typeof BASE);
        // ถ้าฟิลด์เหล่านี้นับเป็นการแก้ไข การบันทึกหนึ่งครั้งจะทำให้เกิดการบันทึกครั้งถัดไปไม่รู้จบ
        expect(after).toBe(before);
    });

    it('ทั้งเจ็ดฟิลด์ที่เคยหายไป ถูกมองเห็นแล้ว', () => {
        const wasMissing = ['requestType', 'certScope', 'applicantType', 'previousCertificateNumber',
            'varieties', 'varietiesNote', 'processing'];
        const blind = wasMissing.filter((key) => buildStateHash({
            ...BASE, [key]: mutate((BASE as Record<string, unknown>)[key]),
        } as typeof BASE) === buildStateHash(BASE));
        expect(blind).toEqual([]);
    });
});

/**
 * ก่อนแฮชจะมีความหมาย autosave ต้องยอมบันทึกก่อน
 *
 * เงื่อนไขเดิมคือ `!state.plantId` — สมเหตุสมผลกับ wizard รุ่นเก่าที่เลือกพืชเป็น "ขั้นที่ 1"
 * แต่รุ่นหกขั้นย้ายการเลือกพืชไปไว้ **ขั้นที่ 4** · ด่านนี้จึงกลายเป็น "ห้ามบันทึกอะไรเลย
 * จนกว่าจะเดินไปถึงขั้น 4" ⇒ คำตอบของขั้น 1-3 ไม่เคยถูกบันทึก ปิดแท็บแล้วหายหมด และ
 * `applicationId` ไม่เกิด ⇒ ขั้น 2 กับ 3 ที่ดึงรายการเอกสารด้วย id นั้นไม่แสดงการ์ดสักใบ
 *
 * ด่านนี้มีไว้กันการสร้างร่างเปล่าจากคนที่แค่เปิดหน้าดู — ความหมายนั้นยังต้องอยู่
 * สิ่งที่เปลี่ยนคือ "เริ่มกรอกแล้ว" วัดจากคำถามแรกของ wizard ที่ผู้ใช้อยู่ ไม่ใช่จากพืช
 */
describe('autosave รู้ว่าผู้ยื่นเริ่มกรอกแล้วหรือยัง', () => {
    const blank = { requestType: null, plantId: null, applicationId: undefined } as never;

    it('เปิดหน้าดูเฉย ๆ ยังไม่ตอบอะไร = ยังไม่เริ่ม ไม่ต้องสร้างร่าง', () => {
        expect(wizardHasStarted(blank)).toBe(false);
    });

    it('ตอบคำถามแรกของขั้น 1 (ประเภทคำขอ) = เริ่มแล้ว แม้ยังไม่ได้เลือกพืช', () => {
        expect(wizardHasStarted({ ...(blank as object), requestType: 'NEW' } as never)).toBe(true);
    });

    it('ร่างเก่าที่เลือกพืชไว้แล้วแต่ไม่มี requestType ก็ยังบันทึกต่อได้', () => {
        expect(wizardHasStarted({ ...(blank as object), plantId: 'cannabis' } as never)).toBe(true);
    });

    it('คำขอที่มี id อยู่แล้ว ต้องบันทึกได้เสมอ — ไม่งั้นการแก้ไขของเก่าหายเงียบ', () => {
        expect(wizardHasStarted({ ...(blank as object), applicationId: 'app-1' } as never)).toBe(true);
    });
});

/**
 * สิ่งที่ถูกส่งขึ้นเซิร์ฟเวอร์ ต้องเป็นคำตอบทั้งหมดที่ผู้ยื่นให้ไว้
 *
 * `formData` ที่ autosave ส่ง เคยเป็นรายการอนุญาตพิมพ์มืออีกชุดหนึ่ง (ชุดที่สามในเส้นทางนี้)
 * และก็ค้างอยู่ที่ wizard รุ่นเก่าเหมือนกัน ⇒ ต่อให้ตัวตรวจการแก้ไขเห็นแล้ว และด่านเริ่มต้น
 * ยอมให้บันทึกแล้ว คำตอบของขั้น 1 กับขั้น 4 ก็ยังไม่ถูกส่งไปไหนอยู่ดี
 */
describe('payload ที่ส่งขึ้นเซิร์ฟเวอร์ พาคำตอบไปครบ', () => {
    const state = {
        requestType: 'RENEWAL',
        certScope: 'PROCESSING',
        applicantType: 'JURISTIC',
        previousCertificateNumber: 'GACP-TH-2569-ABCDEF',
        varieties: [{ name: 'พันธุ์ทดสอบ' }],
        varietiesNote: 'หมายเหตุพันธุ์',
        processing: { method: 'อบแห้ง' },
        plantId: 'cannabis',
        farmData: { farmName: 'สวนทดสอบ' },
        // รายการทำบัญชี ต้องไม่ถูกส่งไปเขียนทับของเซิร์ฟเวอร์
        syncStatus: 'PENDING',
        applicationId: 'app-1',
        updatedAt: '2026-09-06T00:00:00Z',
    } as never;

    it('ทั้งเจ็ดฟิลด์ที่ขั้น 1 และ 4 เขียน ถูกส่งไปด้วย', () => {
        const sent = answersForDraft(state) as Record<string, unknown>;
        expect(sent.requestType).toBe('RENEWAL');
        expect(sent.certScope).toBe('PROCESSING');
        expect(sent.applicantType).toBe('JURISTIC');
        expect(sent.previousCertificateNumber).toBe('GACP-TH-2569-ABCDEF');
        expect(sent.varieties).toEqual([{ name: 'พันธุ์ทดสอบ' }]);
        expect(sent.varietiesNote).toBe('หมายเหตุพันธุ์');
        expect(sent.processing).toEqual({ method: 'อบแห้ง' });
    });

    it('ของเดิมยังไปครบ', () => {
        const sent = answersForDraft(state) as Record<string, unknown>;
        expect(sent.plantId).toBe('cannabis');
        expect(sent.farmData).toEqual({ farmName: 'สวนทดสอบ' });
    });

    it('รายการทำบัญชีของฝั่งเรา ไม่ถูกส่งไปเขียนทับของเซิร์ฟเวอร์', () => {
        const sent = answersForDraft(state) as Record<string, unknown>;
        HASH_EXEMPT_KEYS.forEach((key) => expect(sent[key]).toBeUndefined());
    });
});
