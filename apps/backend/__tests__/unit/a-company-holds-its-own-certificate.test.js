/**
 * มติ operator 2026-09-07: "บริษัท และวิสาหกิจชุมชน ผู้ถือจะต้องเป็นบริษัท หรือวิสาหกิจชุมชน
 * ห้ามเป็นบุคคล"
 *
 * ที่มา (F-HOLDER-01): เดินหน้าจอจริงจนได้ใบรับรองสามใบ สองใบเป็นคำขอของนิติบุคคลและ
 * วิสาหกิจชุมชน แต่ทะเบียนบันทึก `holderType: INDIVIDUAL` และชื่อผู้ถือเป็นชื่อคนที่ล็อกอิน
 * เพราะ `Application.entityId` ยังชี้ Entity ส่วนตัวที่สร้างตอนสมัครสมาชิก และตัวตัดสินผู้ถือ
 * อ่าน entity นั้นตรง ๆ แล้วตกไปใช้ชื่อคนเมื่อไม่มี entity
 *
 * ใบรับรองคือเอกสารที่บอกว่าใครเป็นผู้ถือ — ออกให้ "นาย ก" ทั้งที่ผู้ขอคือ "บริษัท ข จำกัด"
 * คือข้อมูลผิดบนทะเบียนของรัฐ และมีผลต่อการโอน การเพิกถอน และความรับผิด
 *
 * ตัวตัดสินจึงต้องปฏิเสธ ไม่ใช่เดาแทน: ระบบไม่สร้างตัวตนทางกฎหมายให้ใครเอง
 * (ทางที่ถูกมีอยู่แล้ว — /health/workspaces/new สร้าง Entity ชนิด JURISTIC / COMMUNITY_ENTERPRISE)
 */
'use strict';

const certService = require('../../services/certificate-service');

const { resolveHolderForIssuance } = certService;

const person = { id: 'u-1', firstName: 'บุญมี', lastName: 'คิวเอฟาร์ม' };
const app = (patch = {}) => ({
    id: 'app-1', applicant: person, entity: null, submitterId: null, formData: {}, ...patch,
});

describe('ผู้ถือใบรับรองต้องเป็นผู้ยื่นที่คำขอประกาศไว้', () => {
    it('บุคคลธรรมดา: ผู้ถือคือคน — ไม่เปลี่ยน', () => {
        const held = resolveHolderForIssuance(app({ formData: { applicantType: 'INDIVIDUAL' } }), null);
        expect(held.holderDisplayName).toBe('บุญมี คิวเอฟาร์ม');
        expect(held.holderType).toBe('LEGACY_PERSON');
    });

    it('นิติบุคคลที่ยื่นในนามบริษัท: ผู้ถือคือบริษัท', () => {
        const held = resolveHolderForIssuance(app({
            formData: { applicantType: 'JURISTIC' },
            entity: { type: 'JURISTIC', displayName: 'บริษัท ไร่ในร่ม จำกัด' },
        }), null);
        expect(held.holderDisplayName).toBe('บริษัท ไร่ในร่ม จำกัด');
        expect(held.holderType).toBe('JURISTIC');
    });

    it('นิติบุคคลที่ยื่นในนามบุคคล: ปฏิเสธ ไม่ออกใบให้คน', () => {
        expect(() => resolveHolderForIssuance(app({ formData: { applicantType: 'JURISTIC' } }), null))
            .toThrow(/CERTIFICATE_HOLDER_MISMATCH|ผู้ถือ/);
    });

    it('วิสาหกิจชุมชนที่ยื่นในนามบุคคล: ปฏิเสธเหมือนกัน', () => {
        expect(() => resolveHolderForIssuance(
            app({ formData: { applicantType: 'COMMUNITY_ENTERPRISE' } }), null,
        )).toThrow(/CERTIFICATE_HOLDER_MISMATCH|ผู้ถือ/);
    });

    it('ปฏิเสธด้วยเมื่อ entity มีอยู่ แต่เป็นคนละชนิดกับที่คำขอประกาศ', () => {
        expect(() => resolveHolderForIssuance(app({
            formData: { applicantType: 'JURISTIC' },
            entity: { type: 'INDIVIDUAL', displayName: 'บุญมี คิวเอฟาร์ม' },
        }), null)).toThrow(/CERTIFICATE_HOLDER_MISMATCH|ผู้ถือ/);
    });

    it('ประเภทผู้ถือไม่ตรงกับที่ประกาศ (นิติบุคคล vs บุคคลธรรมดา): ข้อความบอกว่าประเภทไม่ตรง', () => {
        try {
            resolveHolderForIssuance(app({
                formData: { applicantType: 'JURISTIC' },
                entity: { type: 'INDIVIDUAL', displayName: 'บุญมี คิวเอฟาร์ม' },
            }), null);
            throw new Error('should have refused');
        } catch (error) {
            expect(error.code).toBe('CERTIFICATE_HOLDER_MISMATCH');
            expect(error.message).toBe('ไม่สามารถออกใบรับรองได้ เนื่องจากประเภทผู้ยื่นที่ระบุในคำขอไม่ตรงกับประเภทของผู้ถือที่ผูกกับคำขอนี้ ส่งคำขอกลับให้ผู้ยื่นแก้ไข หรือแจ้งผู้ดูแลระบบ');
            expect(error.message).not.toMatch(/ใบรับรองเดิม/);
        }
        expect(require('../../shared/error-codes').ERROR_CODES.CERTIFICATE_HOLDER_MISMATCH.messageEn)
            .toMatch(/applicant type .* does not match the type of the holder/i);
    });

    it('การปฏิเสธบอกเป็นภาษาไทยว่าต้องทำอะไรต่อ', () => {
        try {
            resolveHolderForIssuance(app({ formData: { applicantType: 'JURISTIC' } }), null);
            throw new Error('should have refused');
        } catch (error) {
            expect(error.code).toBe('CERTIFICATE_HOLDER_MISMATCH');
            expect(error.statusCode).toBe(422);
            expect(error.message).toMatch(/[ก-๙]/);
            // Round 2 (review I1b): issuance runs on a reviewed application, not a draft, and
            // the reader is usually staff. Coordinator ruling 2026-10-03, read from the catalogue.
            // Round 3: the refusal is a TYPE mismatch (declared applicant type vs the holder's type),
            // not a comparison with an earlier certificate.
            const ISSUANCE_TH = 'ไม่สามารถออกใบรับรองได้ เนื่องจากประเภทผู้ยื่นที่ระบุในคำขอไม่ตรงกับประเภทของผู้ถือที่ผูกกับคำขอนี้ ส่งคำขอกลับให้ผู้ยื่นแก้ไข หรือแจ้งผู้ดูแลระบบ';
            expect(error.message).toBe(ISSUANCE_TH);
            expect(require('../../shared/error-codes').ERROR_CODES.CERTIFICATE_HOLDER_MISMATCH.messageTh).toBe(ISSUANCE_TH);
            expect(error.message).not.toMatch(/ฉบับร่าง|พื้นที่ทำงาน|สลับ/);
        }
    });
});

/**
 * และต้องรู้ตั้งแต่ยื่น ไม่ใช่ตอนออกใบ
 *
 * การปฏิเสธที่ตัวออกใบรับรองคือชั้นสุดท้ายที่กันไม่ให้ทะเบียนบันทึกผิด แต่ถ้ามันเป็นชั้นเดียว
 * เกษตรกรจะจ่ายครบทั้งสองงวด รอตรวจเอกสาร รอตรวจแปลง แล้วเพิ่งรู้ว่าต้องยื่นใหม่ทั้งใบ
 * ⇒ ประตูยื่นต้องปฏิเสธก่อน ตอนที่ยังแก้ได้โดยไม่เสียอะไร
 */
describe('ประตูยื่นบอกตั้งแต่ต้นทาง', () => {
    const {
        holderMismatchIssue,
    } = require('../../services/application-requirements-service');

    it('นิติบุคคลที่ยื่นในนามบุคคล → blockingIssue ที่อ่านรู้เรื่อง', () => {
        const issue = holderMismatchIssue({ applicantType: 'JURISTIC' }, 'INDIVIDUAL');
        expect(issue).not.toBeNull();
        expect(issue.code).toBe('APPLICANT_TYPE_NOT_THE_HOLDER');
        expect(issue.messageTH).toMatch(/นิติบุคคล/);
        expect(issue.messageTH).toBe('คำขอนี้ระบุผู้ยื่นเป็นนิติบุคคล แต่ผูกอยู่กับบุคคล ผู้ถือใบรับรองต้องเป็นนิติบุคคลเอง กรุณาลบฉบับร่างนี้ แล้วเริ่มคำขอใหม่โดยเลือกยื่นในนามนิติบุคคล');
    });

    it('วิสาหกิจชุมชนก็เหมือนกัน', () => {
        const issue = holderMismatchIssue({ applicantType: 'COMMUNITY_ENTERPRISE' }, 'INDIVIDUAL');
        expect(issue?.code).toBe('APPLICANT_TYPE_NOT_THE_HOLDER');
        expect(issue.messageTH).toMatch(/วิสาหกิจชุมชน/);
    });

    it('ไม่มีตัวตนเลย ก็ยังปฏิเสธ — เงียบไม่ใช่คำอนุญาต', () => {
        expect(holderMismatchIssue({ applicantType: 'JURISTIC' }, null)?.code)
            .toBe('APPLICANT_TYPE_NOT_THE_HOLDER');
    });

    it('ยื่นในนามผู้ถือที่ถูกต้อง → ไม่มีการปฏิเสธข้อนี้', () => {
        expect(holderMismatchIssue({ applicantType: 'JURISTIC' }, 'JURISTIC')).toBeNull();
        expect(holderMismatchIssue({ applicantType: 'COMMUNITY_ENTERPRISE' }, 'COMMUNITY_ENTERPRISE')).toBeNull();
    });

    it('บุคคลธรรมดาไม่ถูกแตะ', () => {
        expect(holderMismatchIssue({ applicantType: 'INDIVIDUAL' }, 'INDIVIDUAL')).toBeNull();
        expect(holderMismatchIssue({ applicantType: 'INDIVIDUAL' }, null)).toBeNull();
        expect(holderMismatchIssue({}, null)).toBeNull();
    });

    it('เลนส์เรียกใช้ตัวนี้จริง ไม่ใช่มีไว้เฉย ๆ', () => {
        const src = require('fs').readFileSync(
            require('path').join(__dirname, '..', '..', 'services', 'application-requirements-service.js'),
            'utf8',
        );
        // เรียกใช้ แล้วผลของมันถูกดันเข้า blockingIssues จริง ไม่ใช่ประกาศไว้เฉย ๆ
        expect(src).toContain('holderMismatchIssue(formDataOf(application), dims.holderType)');
        expect(src).toContain('blockingIssues.push(holderIssue)');
    });
});
