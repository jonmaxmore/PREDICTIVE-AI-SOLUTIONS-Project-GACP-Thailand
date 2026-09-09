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

// ชุดกฎเอกสารบังคับของกัญชา ตามแบบ กทล.1 ส่วนที่ ๓ + รายการตรวจของเจ้าหน้าที่ข้อ 1.1 (แผน §3)
// มีผลตั้งแต่ 2026-09-09 (วันวางระบบ) append-only: เปลี่ยนกฎ = ปิด effectiveTo แถวเดิม แล้วเพิ่มแถวใหม่
// ข้อที่ยัง "รอ ruling" (แผน §11) ใช้ค่าที่แนะนำและระบุไว้ใน sourceTh

const EFFECTIVE_FROM = '2026-09-09';
const PLANT = 'cannabis';
const NEW_AND_RENEWAL = [RequestType.NEW, RequestType.RENEWAL];

type RuleInput = Pick<DocumentRequirementRule, 'code' | 'slotCode' | 'reasonTh' | 'sourceTh'> &
  Partial<
    Pick<
      DocumentRequirementRule,
      | 'requirementLevel'
      | 'applicantTypes'
      | 'requestTypes'
      | 'certificationScopes'
      | 'purposes'
      | 'areaTypes'
      | 'landTenures'
      | 'attorneyInFact'
      | 'alternativeGroupCode'
    >
  >;

function rule(input: RuleInput): DocumentRequirementRule {
  return {
    plantCode: PLANT,
    requirementLevel: RequirementLevel.REQUIRED,
    applicantTypes: null,
    requestTypes: null,
    certificationScopes: null,
    purposes: null,
    areaTypes: null,
    landTenures: null,
    attorneyInFact: null,
    alternativeGroupCode: null,
    effectiveFrom: EFFECTIVE_FROM,
    effectiveTo: null,
    ...input,
  };
}

export const documentRequirementRuleSeeds: readonly DocumentRequirementRule[] = [
  // ตัวตน ทุกประเภทผู้ยื่น ทุกประเภทคำขอ (P1)
  rule({
    code: 'RULE_NATIONAL_ID_COPY_ALL',
    slotCode: DocumentSlotCode.NATIONAL_ID_COPY,
    reasonTh: 'ทุกคำขอต้องมีสำเนาบัตรของผู้มีอำนาจลงนาม',
    sourceTh: 'กทล.1 ส่วนที่ ๓ และรายการตรวจของเจ้าหน้าที่ข้อ 1.1',
  }),
  rule({
    code: 'RULE_HOUSE_REGISTRATION_COPY_ALL',
    slotCode: DocumentSlotCode.HOUSE_REGISTRATION_COPY,
    reasonTh: 'ทุกคำขอต้องมีสำเนาทะเบียนบ้านของผู้มีอำนาจลงนาม แยกช่องจากบัตร',
    sourceTh: 'กทล.1 ส่วนที่ ๓ และรายการตรวจของเจ้าหน้าที่ข้อ 1.1 (P4 แยกช่อง)',
  }),

  // คุณสมบัติตามประเภทผู้ขอรับรอง ทุกประเภทคำขอ (P2)
  rule({
    code: 'RULE_COMMUNITY_ENTERPRISE_REGISTRATION',
    slotCode: DocumentSlotCode.COMMUNITY_ENTERPRISE_REGISTRATION,
    applicantTypes: [ApplicantType.COMMUNITY_ENTERPRISE],
    reasonTh: 'เพราะคุณเป็นวิสาหกิจชุมชน',
    sourceTh: 'กทล.1 ส่วนที่ ๓ (วิสาหกิจชุมชน)',
  }),
  rule({
    code: 'RULE_COMMUNITY_MEMBER_LIST',
    slotCode: DocumentSlotCode.COMMUNITY_MEMBER_LIST,
    applicantTypes: [ApplicantType.COMMUNITY_ENTERPRISE],
    reasonTh: 'เพราะคุณเป็นวิสาหกิจชุมชน',
    sourceTh: 'กทล.1 ส่วนที่ ๓ (วิสาหกิจชุมชน) P6 แยกช่องจากหนังสือจดทะเบียน',
  }),
  rule({
    code: 'RULE_COMMUNITY_ASSIGNMENT_LETTER',
    slotCode: DocumentSlotCode.COMMUNITY_ASSIGNMENT_LETTER,
    applicantTypes: [ApplicantType.COMMUNITY_ENTERPRISE],
    reasonTh: 'เพราะคุณเป็นวิสาหกิจชุมชน',
    sourceTh: 'กทล.1 ส่วนที่ ๓ (วิสาหกิจชุมชน)',
  }),
  rule({
    code: 'RULE_PRODUCER_SUPERVISION_LETTER',
    slotCode: DocumentSlotCode.PRODUCER_SUPERVISION_LETTER,
    applicantTypes: [ApplicantType.INDIVIDUAL],
    reasonTh: 'เพราะคุณเป็นบุคคลธรรมดา',
    sourceTh: 'กทล.1 ส่วนที่ ๓ (บุคคลธรรมดา)',
  }),
  rule({
    code: 'RULE_JURISTIC_REGISTRATION',
    slotCode: DocumentSlotCode.JURISTIC_REGISTRATION,
    applicantTypes: [ApplicantType.JURISTIC_PERSON],
    reasonTh: 'เพราะคุณเป็นนิติบุคคล',
    sourceTh: 'กทล.1 ส่วนที่ ๓ (นิติบุคคล) P15 ออกไม่เกิน 6 เดือน',
  }),
  rule({
    code: 'RULE_JURISTIC_DIRECTOR_LIST',
    slotCode: DocumentSlotCode.JURISTIC_DIRECTOR_LIST,
    applicantTypes: [ApplicantType.JURISTIC_PERSON],
    reasonTh: 'เพราะคุณเป็นนิติบุคคล',
    sourceTh: 'กทล.1 ส่วนที่ ๓ (นิติบุคคล) P6 แยกช่อง',
  }),
  rule({
    code: 'RULE_JURISTIC_AUTHORITY_LETTER',
    slotCode: DocumentSlotCode.JURISTIC_AUTHORITY_LETTER,
    applicantTypes: [ApplicantType.JURISTIC_PERSON],
    reasonTh: 'เพราะคุณเป็นนิติบุคคล',
    sourceTh: 'กทล.1 ส่วนที่ ๓ (นิติบุคคล)',
  }),

  // มอบอำนาจ (P5)
  rule({
    code: 'RULE_POWER_OF_ATTORNEY',
    slotCode: DocumentSlotCode.POWER_OF_ATTORNEY,
    attorneyInFact: true,
    reasonTh: 'เพราะผู้ยื่นเป็นผู้รับมอบอำนาจ',
    sourceTh: 'หลักการข้อ 4: มอบอำนาจเป็นเอกสารแนบตามกรณี (P5)',
  }),
  rule({
    code: 'RULE_POA_GRANTOR_ID_COPY',
    slotCode: DocumentSlotCode.POA_GRANTOR_ID_COPY,
    attorneyInFact: true,
    reasonTh: 'เพราะผู้ยื่นเป็นผู้รับมอบอำนาจ',
    sourceTh: 'หลักการข้อ 4: มอบอำนาจเป็นเอกสารแนบตามกรณี (P5)',
  }),

  // ที่ดินและสถานที่ (คำขอใหม่ และต่ออายุตามข้อแนะนำ P3 รอ ruling)
  rule({
    code: 'RULE_LAND_RIGHTS_DOCUMENT',
    slotCode: DocumentSlotCode.LAND_RIGHTS_DOCUMENT,
    requestTypes: NEW_AND_RENEWAL,
    reasonTh: 'ทุกคำขอต้องแสดงสิทธิในที่ดินที่ใช้ปลูกหรือแปรรูป',
    sourceTh: 'กทล.1 ส่วนที่ ๓ A1 · ต่ออายุตามข้อแนะนำ P3 (รอ ruling แผน §11 ข้อ 2)',
  }),
  rule({
    code: 'RULE_LANDLORD_CONSENT_LETTER',
    slotCode: DocumentSlotCode.LANDLORD_CONSENT_LETTER,
    requestTypes: NEW_AND_RENEWAL,
    landTenures: [LandTenure.RENTED, LandTenure.OWNER_PERMITTED],
    reasonTh: 'เพราะคุณเช่าหรือขอใช้ที่ดินของผู้อื่น',
    sourceTh: 'กทล.1 ส่วนที่ ๓ A2 · ขอใช้ที่ดินโดยไม่เช่า (P9)',
  }),
  rule({
    code: 'RULE_SITE_MAP_WITH_COORDINATES',
    slotCode: DocumentSlotCode.SITE_MAP_WITH_COORDINATES,
    requestTypes: NEW_AND_RENEWAL,
    reasonTh: 'เจ้าหน้าที่ใช้นัดตรวจแปลง',
    sourceTh: 'กทล.1 ส่วนที่ ๓ A3',
  }),
  rule({
    code: 'RULE_BUILDING_PLAN_AND_PHOTOS',
    slotCode: DocumentSlotCode.BUILDING_PLAN_AND_PHOTOS,
    requestTypes: NEW_AND_RENEWAL,
    areaTypes: [AreaType.INDOOR, AreaType.GREENHOUSE],
    reasonTh: 'เพราะคุณเลือกโรงเรือน',
    sourceTh: 'กทล.1 ส่วนที่ ๓ A4',
  }),
  rule({
    code: 'RULE_FIELD_AND_SURROUNDINGS_PHOTOS',
    slotCode: DocumentSlotCode.FIELD_AND_SURROUNDINGS_PHOTOS,
    requestTypes: NEW_AND_RENEWAL,
    areaTypes: [AreaType.OUTDOOR, AreaType.OTHER],
    reasonTh: 'เพราะคุณเลือกกลางแจ้งหรือลักษณะพื้นที่อื่น',
    sourceTh: 'กทล.1 ส่วนที่ ๓ A4′ · ลักษณะพื้นที่อื่นใช้ขั้นต่ำนี้ตามข้อแนะนำ P8 (รอ ruling)',
  }),
  rule({
    code: 'RULE_PRODUCTION_SITE_PHOTOS',
    slotCode: DocumentSlotCode.PRODUCTION_SITE_PHOTOS,
    requestTypes: NEW_AND_RENEWAL,
    reasonTh: 'ทุกคำขอต้องแสดงสถานที่ผลิตและเก็บเกี่ยว',
    sourceTh: 'กทล.1 ส่วนที่ ๓ A7',
  }),

  // แผนงานและ SOP (คำขอใหม่)
  rule({
    code: 'RULE_PRODUCTION_AND_UTILISATION_PLAN',
    slotCode: DocumentSlotCode.PRODUCTION_AND_UTILISATION_PLAN,
    requestTypes: [RequestType.NEW],
    reasonTh: 'คำขอใหม่ต้องมีแผนการผลิตและใช้ประโยชน์',
    sourceTh: 'กทล.1 ส่วนที่ ๓ A5',
  }),
  rule({
    code: 'RULE_SECURITY_MEASURES_PLAN',
    slotCode: DocumentSlotCode.SECURITY_MEASURES_PLAN,
    requestTypes: [RequestType.NEW],
    reasonTh: 'คำขอใหม่ต้องมีมาตรการรักษาความปลอดภัย',
    sourceTh: 'กทล.1 ส่วนที่ ๓ A6 (แยกสองช่อง)',
  }),
  rule({
    code: 'RULE_RESIDUE_UTILISATION_PLAN',
    slotCode: DocumentSlotCode.RESIDUE_UTILISATION_PLAN,
    requestTypes: [RequestType.NEW],
    reasonTh: 'คำขอใหม่ต้องระบุวิธีจัดการส่วนที่เหลือจากการผลิต',
    sourceTh: 'กทล.1 ส่วนที่ ๓ A6 (แยกสองช่อง)',
  }),
  rule({
    code: 'RULE_SOP_MANUAL',
    slotCode: DocumentSlotCode.SOP_MANUAL,
    requestTypes: [RequestType.NEW],
    reasonTh: 'คำขอใหม่ต้องมีคู่มือการปฏิบัติงาน',
    sourceTh: 'กทล.1 ส่วนที่ ๓ A8',
  }),

  // ใบอนุญาตสมุนไพรควบคุม (operator 2026-09-08) เงื่อนไขยืนยันกับประกาศฯ ฉบับปัจจุบันก่อนเปิดใช้ (แผน §11 ข้อ 6)
  rule({
    code: 'RULE_CONTROLLED_HERB_LICENSE_EXPORT',
    slotCode: DocumentSlotCode.CONTROLLED_HERB_LICENSE_EXPORT,
    requestTypes: NEW_AND_RENEWAL,
    purposes: [Purpose.EXPORT],
    reasonTh: 'เพราะคุณเลือกวัตถุประสงค์ส่งออก',
    sourceTh: 'ประกาศกระทรวงสาธารณสุข เรื่องสมุนไพรควบคุม (กัญชา) พ.ศ. 2568 · แบบ ภท.10',
  }),
  rule({
    code: 'RULE_CONTROLLED_HERB_LICENSE_COMMERCIAL',
    slotCode: DocumentSlotCode.CONTROLLED_HERB_LICENSE_COMMERCIAL,
    requestTypes: NEW_AND_RENEWAL,
    certificationScopes: [CertificationScope.PROCESSING],
    reasonTh: 'เพราะคุณขอรับรองขอบข่ายแปรรูป',
    sourceTh: 'ประกาศกระทรวงสาธารณสุข เรื่องสมุนไพรควบคุม (กัญชา) พ.ศ. 2568 · แบบ ภท.11',
  }),
  rule({
    code: 'RULE_CONTROLLED_HERB_LICENSE_RESEARCH_OPTIONAL',
    slotCode: DocumentSlotCode.CONTROLLED_HERB_LICENSE_RESEARCH,
    requirementLevel: RequirementLevel.OPTIONAL,
    requestTypes: NEW_AND_RENEWAL,
    reasonTh: 'แนบถ้ามีใบอนุญาตศึกษาวิจัย',
    sourceTh: 'แบบ ภท.9 · เงื่อนไขบังคับรอยืนยันกับประกาศฯ (แผน §11 ข้อ 6)',
  }),

  // ต่ออายุ
  rule({
    code: 'RULE_PREVIOUS_CERTIFICATE_ORIGINAL',
    slotCode: DocumentSlotCode.PREVIOUS_CERTIFICATE_ORIGINAL,
    requestTypes: [RequestType.RENEWAL],
    reasonTh: 'เพราะคุณขอต่ออายุใบรับรอง',
    sourceTh: 'ข้อกำหนดและเงื่อนไขฯ (ต่ออายุ)',
  }),
  rule({
    code: 'RULE_RENEWAL_CULTIVATION_PLAN',
    slotCode: DocumentSlotCode.RENEWAL_CULTIVATION_PLAN,
    requestTypes: [RequestType.RENEWAL],
    reasonTh: 'เพราะคุณขอต่ออายุใบรับรอง',
    sourceTh: 'ข้อกำหนดและเงื่อนไขฯ (ต่ออายุ)',
  }),
  rule({
    code: 'RULE_RENEWAL_UTILISATION_PLAN',
    slotCode: DocumentSlotCode.RENEWAL_UTILISATION_PLAN,
    requestTypes: [RequestType.RENEWAL],
    reasonTh: 'เพราะคุณขอต่ออายุใบรับรอง',
    sourceTh: 'ข้อกำหนดและเงื่อนไขฯ (ต่ออายุ)',
  }),
  rule({
    code: 'RULE_OPERATION_SUMMARY_REPORT',
    slotCode: DocumentSlotCode.OPERATION_SUMMARY_REPORT,
    requestTypes: [RequestType.RENEWAL],
    reasonTh: 'เพราะคุณขอต่ออายุใบรับรอง',
    sourceTh: 'ข้อกำหนดและเงื่อนไขฯ (ต่ออายุ)',
  }),

  // ใบแทน: อย่างใดอย่างหนึ่ง
  rule({
    code: 'RULE_POLICE_REPORT',
    slotCode: DocumentSlotCode.POLICE_REPORT,
    requestTypes: [RequestType.REPLACEMENT],
    alternativeGroupCode: 'REPLACEMENT_PROOF',
    reasonTh: 'เพราะคุณขอใบแทน (กรณีสูญหาย)',
    sourceTh: 'ข้อกำหนดและเงื่อนไขฯ (ใบแทน)',
  }),
  rule({
    code: 'RULE_DAMAGED_CERTIFICATE',
    slotCode: DocumentSlotCode.DAMAGED_CERTIFICATE,
    requestTypes: [RequestType.REPLACEMENT],
    alternativeGroupCode: 'REPLACEMENT_PROOF',
    reasonTh: 'เพราะคุณขอใบแทน (กรณีชำรุด)',
    sourceTh: 'ข้อกำหนดและเงื่อนไขฯ (ใบแทน)',
  }),

  // ไม่บังคับ
  rule({
    code: 'RULE_WATER_TEST_RESULT_OPTIONAL',
    slotCode: DocumentSlotCode.WATER_TEST_RESULT,
    requirementLevel: RequirementLevel.OPTIONAL,
    requestTypes: NEW_AND_RENEWAL,
    reasonTh: 'ช่วยให้วันตรวจแปลงเร็วขึ้น',
    sourceTh: 'ไม่อยู่ใน กทล.1 ส่วนที่ ๓ เป็นเอกสารของวันตรวจ',
  }),
  rule({
    code: 'RULE_SOIL_TEST_RESULT_OPTIONAL',
    slotCode: DocumentSlotCode.SOIL_TEST_RESULT,
    requirementLevel: RequirementLevel.OPTIONAL,
    requestTypes: NEW_AND_RENEWAL,
    reasonTh: 'ช่วยให้วันตรวจแปลงเร็วขึ้น',
    sourceTh: 'ไม่อยู่ใน กทล.1 ส่วนที่ ๓ เป็นเอกสารของวันตรวจ',
  }),
  rule({
    code: 'RULE_LAB_CERTIFICATE_OPTIONAL',
    slotCode: DocumentSlotCode.LAB_CERTIFICATE,
    requirementLevel: RequirementLevel.OPTIONAL,
    requestTypes: NEW_AND_RENEWAL,
    reasonTh: 'แนบถ้ามีผลวิเคราะห์ผลผลิตรอบก่อน',
    sourceTh: 'กลุ่ม ค รอ ruling (แผน §11 ข้อ 5)',
  }),
  rule({
    code: 'RULE_ADDITIONAL_DOCUMENTS_OPTIONAL',
    slotCode: DocumentSlotCode.ADDITIONAL_DOCUMENTS,
    requirementLevel: RequirementLevel.OPTIONAL,
    reasonTh: 'สิ่งที่คุณอยากให้เจ้าหน้าที่เห็นเพิ่มเติม',
    sourceTh: 'ไม่มีผลต่อการส่งคำขอ',
  }),
];
