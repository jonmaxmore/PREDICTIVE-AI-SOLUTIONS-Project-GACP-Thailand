import {
  ApplicantType,
  AreaType,
  CertificationScope,
  type DocumentRequirementRule,
  DocumentSlotCode,
  LandTenure,
  Purpose,
  RequestType,
  RequirementLevel,
} from '@gacp/contracts';
import { describe, expect, it } from 'vitest';
import {
  missingRequiredSlots,
  type RequirementContext,
  RequirementResolutionErrorCode,
  requiredSlotCodes,
  resolveDocumentRequirements,
} from './document-requirements.ts';

// กฎชุดเล็กสำหรับทดสอบเครื่องยนต์ (การจับคู่มิติ วันมีผล การรวมกฎ กลุ่มทางเลือก) ชุดกฎจริงอยู่ใน packages/db/seeds
function rule(
  code: string,
  slotCode: DocumentSlotCode,
  overrides: Partial<DocumentRequirementRule> = {},
): DocumentRequirementRule {
  return {
    code: `RULE_${code}`,
    plantCode: 'cannabis',
    slotCode,
    requirementLevel: RequirementLevel.REQUIRED,
    applicantTypes: null,
    requestTypes: null,
    certificationScopes: null,
    purposes: null,
    areaTypes: null,
    landTenures: null,
    attorneyInFact: null,
    alternativeGroupCode: null,
    reasonTh: `เหตุผล ${code}`,
    sourceTh: 'ทดสอบ',
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
    ...overrides,
  };
}

const rules: DocumentRequirementRule[] = [
  rule('ID_ALL', DocumentSlotCode.NATIONAL_ID_COPY),
  rule('POA', DocumentSlotCode.POWER_OF_ATTORNEY, { attorneyInFact: true }),
  rule('COMMUNITY_REG', DocumentSlotCode.COMMUNITY_ENTERPRISE_REGISTRATION, {
    applicantTypes: [ApplicantType.COMMUNITY_ENTERPRISE],
  }),
  rule('LANDLORD', DocumentSlotCode.LANDLORD_CONSENT_LETTER, {
    landTenures: [LandTenure.RENTED, LandTenure.OWNER_PERMITTED],
  }),
  rule('BUILDING', DocumentSlotCode.BUILDING_PLAN_AND_PHOTOS, {
    areaTypes: [AreaType.INDOOR, AreaType.GREENHOUSE],
  }),
  rule('FIELD', DocumentSlotCode.FIELD_AND_SURROUNDINGS_PHOTOS, {
    areaTypes: [AreaType.OUTDOOR, AreaType.OTHER],
  }),
  rule('EXPORT_LICENSE', DocumentSlotCode.CONTROLLED_HERB_LICENSE_EXPORT, {
    purposes: [Purpose.EXPORT],
  }),
  rule('COMMERCIAL_LICENSE', DocumentSlotCode.CONTROLLED_HERB_LICENSE_COMMERCIAL, {
    certificationScopes: [CertificationScope.PROCESSING],
  }),
  rule('WATER_OPTIONAL', DocumentSlotCode.WATER_TEST_RESULT, {
    requirementLevel: RequirementLevel.OPTIONAL,
  }),
  rule('POLICE', DocumentSlotCode.POLICE_REPORT, {
    requestTypes: [RequestType.REPLACEMENT],
    alternativeGroupCode: 'REPLACEMENT_PROOF',
  }),
  rule('DAMAGED', DocumentSlotCode.DAMAGED_CERTIFICATE, {
    requestTypes: [RequestType.REPLACEMENT],
    alternativeGroupCode: 'REPLACEMENT_PROOF',
  }),
  rule('OLD_EXPIRED', DocumentSlotCode.LAB_CERTIFICATE, {
    effectiveFrom: '2025-01-01',
    effectiveTo: '2026-01-01',
  }),
  rule('FUTURE', DocumentSlotCode.SOIL_TEST_RESULT, { effectiveFrom: '2027-01-01' }),
  rule('SECOND_REASON_FOR_FIELD', DocumentSlotCode.FIELD_AND_SURROUNDINGS_PHOTOS, {
    requirementLevel: RequirementLevel.OPTIONAL,
    reasonTh: 'เหตุผลเพิ่มเติม',
  }),
];

const communityEnterpriseScenario: RequirementContext = {
  plantCode: 'cannabis',
  applicantType: ApplicantType.COMMUNITY_ENTERPRISE,
  requestType: RequestType.NEW,
  certificationScope: CertificationScope.CULTIVATION,
  purposes: [Purpose.MEDICAL, Purpose.EXPORT],
  areaTypes: [AreaType.INDOOR, AreaType.OUTDOOR],
  landTenure: LandTenure.RENTED,
  isAttorneyInFact: true,
  asOf: '2026-09-09',
};

describe('resolveDocumentRequirements', () => {
  it('ฉากจบ Phase 1: วิสาหกิจ เช่า Indoor+Outdoor ส่งออก มอบอำนาจ ได้ทุกช่องที่เกี่ยว', () => {
    const result = resolveDocumentRequirements(communityEnterpriseScenario, rules);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect([...requiredSlotCodes(result.requirements)].sort()).toEqual(
      [
        DocumentSlotCode.NATIONAL_ID_COPY,
        DocumentSlotCode.POWER_OF_ATTORNEY,
        DocumentSlotCode.COMMUNITY_ENTERPRISE_REGISTRATION,
        DocumentSlotCode.LANDLORD_CONSENT_LETTER,
        DocumentSlotCode.BUILDING_PLAN_AND_PHOTOS,
        DocumentSlotCode.FIELD_AND_SURROUNDINGS_PHOTOS,
        DocumentSlotCode.CONTROLLED_HERB_LICENSE_EXPORT,
      ].sort(),
    );
    const optional = result.requirements.filter(
      (requirement) => requirement.requirementLevel === RequirementLevel.OPTIONAL,
    );
    expect(optional.map((requirement) => requirement.slotCode)).toEqual([
      DocumentSlotCode.WATER_TEST_RESULT,
    ]);
  });

  it('กฎบังคับชนะกฎไม่บังคับของช่องเดียวกัน และรวมเหตุผลทุกกฎ', () => {
    const result = resolveDocumentRequirements(communityEnterpriseScenario, rules);
    if (!result.ok) throw new Error('unexpected');
    const field = result.requirements.find(
      (requirement) => requirement.slotCode === DocumentSlotCode.FIELD_AND_SURROUNDINGS_PHOTOS,
    );
    expect(field?.requirementLevel).toBe(RequirementLevel.REQUIRED);
    expect(field?.reasonsTh).toEqual(['เหตุผล FIELD', 'เหตุผลเพิ่มเติม']);
    expect(field?.ruleCodes).toEqual(['RULE_FIELD', 'RULE_SECOND_REASON_FOR_FIELD']);
  });

  it('บุคคลธรรมดา เจ้าของที่ดิน กลางแจ้ง การแพทย์ ไม่มอบอำนาจ ไม่ถูกขอเกินกรณี', () => {
    const result = resolveDocumentRequirements(
      {
        ...communityEnterpriseScenario,
        applicantType: ApplicantType.INDIVIDUAL,
        purposes: [Purpose.MEDICAL],
        areaTypes: [AreaType.OUTDOOR],
        landTenure: LandTenure.OWNED,
        isAttorneyInFact: false,
      },
      rules,
    );
    if (!result.ok) throw new Error('unexpected');
    expect([...requiredSlotCodes(result.requirements)].sort()).toEqual(
      [DocumentSlotCode.NATIONAL_ID_COPY, DocumentSlotCode.FIELD_AND_SURROUNDINGS_PHOTOS].sort(),
    );
  });

  it('ขอบข่ายแปรรูปขอใบอนุญาตจำหน่าย/แปรรูปเพื่อการค้า และลักษณะพื้นที่ อื่น ๆ ขอภาพแปลง', () => {
    const result = resolveDocumentRequirements(
      {
        ...communityEnterpriseScenario,
        certificationScope: CertificationScope.PROCESSING,
        areaTypes: [AreaType.OTHER],
        purposes: [Purpose.MEDICAL],
      },
      rules,
    );
    if (!result.ok) throw new Error('unexpected');
    const codes = requiredSlotCodes(result.requirements);
    expect(codes).toContain(DocumentSlotCode.CONTROLLED_HERB_LICENSE_COMMERCIAL);
    expect(codes).toContain(DocumentSlotCode.FIELD_AND_SURROUNDINGS_PHOTOS);
    expect(codes).not.toContain(DocumentSlotCode.BUILDING_PLAN_AND_PHOTOS);
    expect(codes).not.toContain(DocumentSlotCode.CONTROLLED_HERB_LICENSE_EXPORT);
  });

  it('วันมีผล: กฎที่หมดอายุและกฎในอนาคตไม่ถูกใช้', () => {
    const result = resolveDocumentRequirements(communityEnterpriseScenario, rules);
    if (!result.ok) throw new Error('unexpected');
    const codes = result.requirements.map((requirement) => requirement.slotCode);
    expect(codes).not.toContain(DocumentSlotCode.LAB_CERTIFICATE);
    expect(codes).not.toContain(DocumentSlotCode.SOIL_TEST_RESULT);

    const later = resolveDocumentRequirements(
      { ...communityEnterpriseScenario, asOf: '2027-06-01' },
      rules,
    );
    if (!later.ok) throw new Error('unexpected');
    expect(later.requirements.map((requirement) => requirement.slotCode)).toContain(
      DocumentSlotCode.SOIL_TEST_RESULT,
    );
  });

  it('พืชที่ไม่มีชุดกฎที่มีผล = ตัดสินไม่ได้ ไม่ใช่ผ่อนปรน', () => {
    const result = resolveDocumentRequirements(
      { ...communityEnterpriseScenario, plantCode: 'turmeric' },
      rules,
    );
    expect(result).toEqual({ ok: false, code: RequirementResolutionErrorCode.NO_ACTIVE_RULES });
  });
});

describe('missingRequiredSlots', () => {
  it('กลุ่มทางเลือก: ใบแทนต้องมีใบแจ้งความหรือใบรับรองที่ชำรุด อย่างใดอย่างหนึ่ง', () => {
    const result = resolveDocumentRequirements(
      { ...communityEnterpriseScenario, requestType: RequestType.REPLACEMENT },
      rules,
    );
    if (!result.ok) throw new Error('unexpected');
    const nothing = missingRequiredSlots(result.requirements, new Set());
    expect(nothing).toContain(DocumentSlotCode.POLICE_REPORT);
    expect(nothing).toContain(DocumentSlotCode.DAMAGED_CERTIFICATE);

    const withPolice = missingRequiredSlots(
      result.requirements,
      new Set([DocumentSlotCode.POLICE_REPORT]),
    );
    expect(withPolice).not.toContain(DocumentSlotCode.POLICE_REPORT);
    expect(withPolice).not.toContain(DocumentSlotCode.DAMAGED_CERTIFICATE);
    expect(withPolice).toContain(DocumentSlotCode.NATIONAL_ID_COPY);
  });

  it('ช่องไม่บังคับไม่เคยนับว่าขาด', () => {
    const result = resolveDocumentRequirements(communityEnterpriseScenario, rules);
    if (!result.ok) throw new Error('unexpected');
    const missing = missingRequiredSlots(result.requirements, new Set());
    expect(missing).not.toContain(DocumentSlotCode.WATER_TEST_RESULT);
    expect(missing).toHaveLength(7);
  });
});
