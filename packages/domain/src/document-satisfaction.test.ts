import { DocumentSlotCode, LicenseDeclarationStatus } from '@gacp/contracts';
import { describe, expect, it } from 'vitest';
import { LicenseSlotState, licenseSlotState, satisfiedSlotCodes } from './document-satisfaction.ts';

const licenseSlots = new Set([
  DocumentSlotCode.CONTROLLED_HERB_LICENSE_EXPORT,
  DocumentSlotCode.CONTROLLED_HERB_LICENSE_COMMERCIAL,
]);

describe('satisfiedSlotCodes', () => {
  it('ช่องธรรมดาครบเมื่อมีไฟล์ ช่องใบอนุญาตต้องมีทั้งสถานะและหลักฐาน', () => {
    const satisfied = satisfiedSlotCodes(
      [
        { slotCode: DocumentSlotCode.NATIONAL_ID_COPY, fileCount: 1 },
        { slotCode: DocumentSlotCode.SOP_MANUAL, fileCount: 0 },
        { slotCode: DocumentSlotCode.CONTROLLED_HERB_LICENSE_EXPORT, fileCount: 1 },
        { slotCode: DocumentSlotCode.CONTROLLED_HERB_LICENSE_COMMERCIAL, fileCount: 1 },
      ],
      licenseSlots,
      [
        {
          slotCode: DocumentSlotCode.CONTROLLED_HERB_LICENSE_EXPORT,
          status: LicenseDeclarationStatus.APPLIED,
          receiptNumber: 'ชม 0123/2569',
        },
      ],
    );
    expect(satisfied.has(DocumentSlotCode.NATIONAL_ID_COPY)).toBe(true);
    expect(satisfied.has(DocumentSlotCode.SOP_MANUAL)).toBe(false);
    expect(satisfied.has(DocumentSlotCode.CONTROLLED_HERB_LICENSE_EXPORT)).toBe(true);
    // มีไฟล์แต่ไม่แจ้งสถานะ = ยังไม่ครบ
    expect(satisfied.has(DocumentSlotCode.CONTROLLED_HERB_LICENSE_COMMERCIAL)).toBe(false);
  });
});

describe('licenseSlotState', () => {
  it('แนบแล้วต้องมีไฟล์ ยื่นแล้วรอผลต้องมีเลขรับและหลักฐาน ยังไม่ได้ยื่นชัดเจน', () => {
    const slotCode = DocumentSlotCode.CONTROLLED_HERB_LICENSE_EXPORT;
    expect(licenseSlotState(undefined, 1)).toBe(LicenseSlotState.UNDECLARED);
    expect(
      licenseSlotState({ slotCode, status: LicenseDeclarationStatus.HAVE, receiptNumber: null }, 1),
    ).toBe(LicenseSlotState.ATTACHED);
    expect(
      licenseSlotState({ slotCode, status: LicenseDeclarationStatus.HAVE, receiptNumber: null }, 0),
    ).toBe(LicenseSlotState.UNDECLARED);
    expect(
      licenseSlotState(
        { slotCode, status: LicenseDeclarationStatus.APPLIED, receiptNumber: 'x' },
        1,
      ),
    ).toBe(LicenseSlotState.PENDING_DECISION);
    expect(
      licenseSlotState(
        { slotCode, status: LicenseDeclarationStatus.APPLIED, receiptNumber: null },
        1,
      ),
    ).toBe(LicenseSlotState.UNDECLARED);
    expect(
      licenseSlotState({ slotCode, status: LicenseDeclarationStatus.NONE, receiptNumber: null }, 0),
    ).toBe(LicenseSlotState.NOT_FILED);
  });
});
