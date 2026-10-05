/**
 * ผู้ยื่นที่เป็นนิติบุคคลและวิสาหกิจชุมชน ยื่นคำขอไม่ได้เลย — ประตูถามคีย์ที่หน้าจอไม่เคยเขียน
 *
 * เจอด้วยการเดินหน้าจอจริงบน scratch stack (2026-09-07): กรอกครบทุกช่องที่ขั้น 2 ขอ ติ๊กคำรับรอง
 * ครบ 6 ข้อ ปุ่มยื่นกดได้ แล้วโดนตีกลับว่า "เลขทะเบียนนิติบุคคล จำเป็น · ชื่อผู้มีอำนาจลงนาม จำเป็น"
 * ทั้งที่ไม่มีช่องชื่อนั้นบนหน้าจอให้กรอก
 *
 * ต้นเหตุ: ขั้น 2 ของ wizard หกขั้นเก็บ `companyName` / `authorizedSignatory` / `taxId`
 * (step2-identity-config.ts:57-67) แต่ตัวแปลงคีย์ในไฟล์นี้อ่าน `registrationNumber` และ
 * `directorName` ซึ่งเป็นคำของ wizard ตัวเก่า · ฝั่งวิสาหกิจชุมชนก็เหมือนกัน: หน้าจอเขียน
 * `communityRegistrationNo` ประตูอ่าน `communityRegNumber` / `registrationSVC01`
 *
 * เป็นคลาสเดียวกับที่ step 5 ในไฟล์เดียวกันเคยโดนและแก้ไปแล้ว (siteName/siteAddress) —
 * คอมเมนต์ของ step 5 อธิบายไว้เองว่า "the validator and the paper must describe one filing"
 * ⇒ ส่วนที่ ๑ ของ กทล.๑ ต้องได้ชั้นแปลงคีย์แบบเดียวกัน
 *
 * เลขทะเบียนนิติบุคคลกับเลขประจำตัวผู้เสียภาษีเป็นเลขเดียวกันในไทย — schema ของไฟล์นี้เขียนไว้เอง
 * ("In Thailand a company's registration number IS its corporate tax ID") การอ่าน taxId มาเป็น
 * registration_number จึงไม่ใช่การเดา แต่คือสิ่งที่กฎหมายบอกว่ามันเป็น
 */
'use strict';

const {
    normalizeCanonicalToSteps,
    validateCanonicalSubmission,
} = require('../../validation/canonical-application-validator');

/** สิ่งที่ wizard หกขั้นเขียนจริง — คัดมาจากฐานข้อมูลของ walk 2026-09-07 */
const JURISTIC_FROM_THE_SCREEN = {
    applicantType: 'JURISTIC',
    applicantData: {
        companyName: 'บริษัท ไร่ในร่ม จำกัด',
        authorizedSignatory: 'สมศักดิ์ ผู้มีอำนาจลงนาม',
        taxId: '0105561000003',
        address: '88/2 หมู่ 4 ต.หนองหาร อ.สันทราย จ.เชียงใหม่ 50290',
        phone: '0812345678',
        email: 'juristic.qa@example.co.th',
    },
};

const COMMUNITY_FROM_THE_SCREEN = {
    applicantType: 'COMMUNITY_ENTERPRISE',
    applicantData: {
        communityName: 'วิสาหกิจชุมชนโรงเรือนสมุนไพร',
        presidentName: 'สมหญิง ประธานกลุ่ม',
        presidentIdCard: '1000000000076',
        nationality: 'ไทย',
        communityRegistrationNo: '5-50-09-03/1-0001',
        houseCode: '1234567890123',
        address: '88/2 หมู่ 4 ต.หนองหาร อ.สันทราย จ.เชียงใหม่',
        phone: '0812345678',
    },
};

describe('ส่วนที่ ๑ ของ กทล.๑ — ประตูต้องอ่านคำเดียวกับที่หน้าจอเขียน', () => {
    it('นิติบุคคล: เลขทะเบียนมาจากช่องที่หน้าจอมีจริง', () => {
        const steps = normalizeCanonicalToSteps(JURISTIC_FROM_THE_SCREEN);
        expect(steps[4].company_name).toBe('บริษัท ไร่ในร่ม จำกัด');
        expect(steps[4].registration_number).toBe('0105561000003');
        expect(steps[4].director_name).toBe('สมศักดิ์ ผู้มีอำนาจลงนาม');
    });

    it('วิสาหกิจชุมชน: รหัสทะเบียน สวช.01 มาจากช่องที่หน้าจอมีจริง', () => {
        const steps = normalizeCanonicalToSteps(COMMUNITY_FROM_THE_SCREEN);
        expect(steps[4].community_name).toBe('วิสาหกิจชุมชนโรงเรือนสมุนไพร');
        expect(steps[4].president_name).toBe('สมหญิง ประธานกลุ่ม');
        expect(steps[4].community_reg_number).toBe('5-50-09-03/1-0001');
    });

    it('คำของ wizard ตัวเก่ายังชนะเสมอ — คำขอที่กำลังเดินอยู่ต้องไม่เปลี่ยนความหมาย', () => {
        const steps = normalizeCanonicalToSteps({
            applicantType: 'JURISTIC',
            applicantData: {
                companyName: 'บริษัทเก่า',
                registrationNumber: '0105561000011',
                directorName: 'ผู้ลงนามเดิม',
                taxId: '0105561000003',
                authorizedSignatory: 'ผู้ลงนามใหม่',
            },
        });
        expect(steps[4].registration_number).toBe('0105561000011');
        expect(steps[4].director_name).toBe('ผู้ลงนามเดิม');
    });

    it('ประเภทผู้ยื่นที่หน้าจอเขียนคือคำที่ประตูรับ — COMMUNITY_ENTERPRISE', () => {
        // schema ของฐานข้อมูล (entity.prisma:35) และทะเบียนกฎ (requirement_rules.holderType)
        // ใช้ COMMUNITY_ENTERPRISE ทั้งคู่ · ประตู submit เป็นที่เดียวที่ยังพูด COMMUNITY
        const steps = normalizeCanonicalToSteps(COMMUNITY_FROM_THE_SCREEN);
        expect(steps[4].applicant_type).toBe('COMMUNITY_ENTERPRISE');
        const result = validateCanonicalSubmission(COMMUNITY_FROM_THE_SCREEN);
        const messages = JSON.stringify(result?.errorsByStep?.[4] || []);
        expect(messages).not.toContain('ประเภทผู้ยื่นคำขอไม่ถูกต้อง');
    });

    it('ประตู submit ไม่ปฏิเสธคำขอนิติบุคคลด้วยเหตุผลที่หน้าจอไม่มีช่องให้แก้', () => {
        const result = validateCanonicalSubmission(JURISTIC_FROM_THE_SCREEN);
        const messages = JSON.stringify(result?.errors || result || {});
        expect(messages).not.toContain('เลขทะเบียนนิติบุคคล');
        expect(messages).not.toContain('ชื่อผู้มีอำนาจลงนาม');
    });
});
