import { describe, expect, it } from 'vitest';
import {
  applicantIdentityDraftSchema,
  isValidThaiNationalId,
  licenseDeclarationInputSchema,
  requiredApplicantFields,
  siteAndLandDraftSchema,
  thaiPhoneSchema,
} from './application-form.ts';
import { ApplicantType } from './enums.ts';

describe('เลขประจำตัวประชาชน', () => {
  it('ตรวจ checksum หลักที่ 13', () => {
    // เลขสมมติที่ checksum ถูกต้อง: ผลรวมถ่วงน้ำหนัก 146 → 146 mod 11 = 3 → (11 - 3) mod 10 = 8
    expect(isValidThaiNationalId('1101700230708')).toBe(true);
    expect(isValidThaiNationalId('1101700230705')).toBe(false);
    expect(isValidThaiNationalId('110170023070')).toBe(false);
    expect(isValidThaiNationalId('abcdefghijklm')).toBe(false);
  });

  it('ร่างยอมให้ว่าง แต่ถ้ากรอกต้องถูกต้อง และตัดขีดกับช่องว่างออก', () => {
    expect(applicantIdentityDraftSchema.parse({ nationalId: '' }).nationalId).toBeNull();
    expect(applicantIdentityDraftSchema.parse({ nationalId: '1-1017-00230-70-8' }).nationalId).toBe(
      '1101700230708',
    );
    expect(applicantIdentityDraftSchema.safeParse({ nationalId: '1234567890123' }).success).toBe(
      false,
    );
  });
});

describe('ช่องบังคับของส่วนที่ ๑', () => {
  it('วิสาหกิจชุมชนต้องมีประธาน เลขบัตร รหัส สวช.01 และเลขรหัสประจำบ้าน', () => {
    const fields = requiredApplicantFields(ApplicantType.COMMUNITY_ENTERPRISE, false);
    expect(fields).toEqual(
      expect.arrayContaining([
        'representativeName',
        'nationalId',
        'registrationNumber',
        'houseRegistrationNo',
      ]),
    );
    expect(fields).not.toContain('attorneyPositionTh');
  });

  it('ผู้รับมอบอำนาจต้องระบุตำแหน่ง และบุคคลธรรมดาไม่ต้องมีเลขทะเบียน', () => {
    const fields = requiredApplicantFields(ApplicantType.INDIVIDUAL, true);
    expect(fields).toContain('attorneyPositionTh');
    expect(fields).toContain('nationalId');
    expect(fields).not.toContain('registrationNumber');
  });
});

describe('สถานที่และที่ดิน', () => {
  it('แปลงตัวเลขจากข้อความและปฏิเสธค่าที่ไม่ใช่ตัวเลข', () => {
    const parsed = siteAndLandDraftSchema.parse({
      areaSquareMetres: '640',
      plantsPerCycle: '120',
      cyclesPerYear: '',
      areaTypes: ['OUTDOOR', 'INDOOR'],
    });
    expect(parsed.areaSquareMetres).toBe(640);
    expect(parsed.plantsPerCycle).toBe(120);
    expect(parsed.cyclesPerYear).toBeNull();
    expect(
      siteAndLandDraftSchema.safeParse({ areaTypes: [], plantsPerCycle: '12.5' }).success,
    ).toBe(false);
  });

  it('เบอร์โทรไทยตัดช่องว่างและขีด', () => {
    expect(thaiPhoneSchema.parse('081-234 5678')).toBe('0812345678');
    expect(thaiPhoneSchema.safeParse('12345').success).toBe(false);
  });
});

describe('สถานะใบอนุญาต', () => {
  it('ใช้ได้กับช่องใบอนุญาตเท่านั้น', () => {
    expect(
      licenseDeclarationInputSchema.safeParse({
        slotCode: 'CONTROLLED_HERB_LICENSE_EXPORT',
        status: 'APPLIED',
        receiptNumber: 'ชม 0123/2569',
      }).success,
    ).toBe(true);
    expect(
      licenseDeclarationInputSchema.safeParse({ slotCode: 'SOP_MANUAL', status: 'HAVE' }).success,
    ).toBe(false);
  });
});
