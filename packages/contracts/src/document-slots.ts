import { z } from 'zod';
import { enumValues } from './enum-values.ts';

// ช่องเอกสารแนบ หนึ่งช่อง = หนึ่งเอกสารที่กรมติ๊ก (docs/glossary.md §4) ชุดปิด เพิ่มช่องต้องแก้ glossary ใน PR เดียวกัน
export const DocumentSlotCode = {
  NATIONAL_ID_COPY: 'NATIONAL_ID_COPY',
  HOUSE_REGISTRATION_COPY: 'HOUSE_REGISTRATION_COPY',
  COMMUNITY_ENTERPRISE_REGISTRATION: 'COMMUNITY_ENTERPRISE_REGISTRATION',
  COMMUNITY_MEMBER_LIST: 'COMMUNITY_MEMBER_LIST',
  COMMUNITY_ASSIGNMENT_LETTER: 'COMMUNITY_ASSIGNMENT_LETTER',
  PRODUCER_SUPERVISION_LETTER: 'PRODUCER_SUPERVISION_LETTER',
  JURISTIC_REGISTRATION: 'JURISTIC_REGISTRATION',
  JURISTIC_DIRECTOR_LIST: 'JURISTIC_DIRECTOR_LIST',
  JURISTIC_AUTHORITY_LETTER: 'JURISTIC_AUTHORITY_LETTER',
  POWER_OF_ATTORNEY: 'POWER_OF_ATTORNEY',
  POA_GRANTOR_ID_COPY: 'POA_GRANTOR_ID_COPY',
  LAND_RIGHTS_DOCUMENT: 'LAND_RIGHTS_DOCUMENT',
  LANDLORD_CONSENT_LETTER: 'LANDLORD_CONSENT_LETTER',
  SITE_MAP_WITH_COORDINATES: 'SITE_MAP_WITH_COORDINATES',
  BUILDING_PLAN_AND_PHOTOS: 'BUILDING_PLAN_AND_PHOTOS',
  FIELD_AND_SURROUNDINGS_PHOTOS: 'FIELD_AND_SURROUNDINGS_PHOTOS',
  PRODUCTION_SITE_PHOTOS: 'PRODUCTION_SITE_PHOTOS',
  PRODUCTION_AND_UTILISATION_PLAN: 'PRODUCTION_AND_UTILISATION_PLAN',
  SECURITY_MEASURES_PLAN: 'SECURITY_MEASURES_PLAN',
  RESIDUE_UTILISATION_PLAN: 'RESIDUE_UTILISATION_PLAN',
  SOP_MANUAL: 'SOP_MANUAL',
  CONTROLLED_HERB_LICENSE_RESEARCH: 'CONTROLLED_HERB_LICENSE_RESEARCH',
  CONTROLLED_HERB_LICENSE_EXPORT: 'CONTROLLED_HERB_LICENSE_EXPORT',
  CONTROLLED_HERB_LICENSE_COMMERCIAL: 'CONTROLLED_HERB_LICENSE_COMMERCIAL',
  PREVIOUS_CERTIFICATE_ORIGINAL: 'PREVIOUS_CERTIFICATE_ORIGINAL',
  RENEWAL_CULTIVATION_PLAN: 'RENEWAL_CULTIVATION_PLAN',
  RENEWAL_UTILISATION_PLAN: 'RENEWAL_UTILISATION_PLAN',
  OPERATION_SUMMARY_REPORT: 'OPERATION_SUMMARY_REPORT',
  POLICE_REPORT: 'POLICE_REPORT',
  DAMAGED_CERTIFICATE: 'DAMAGED_CERTIFICATE',
  WATER_TEST_RESULT: 'WATER_TEST_RESULT',
  SOIL_TEST_RESULT: 'SOIL_TEST_RESULT',
  LAB_CERTIFICATE: 'LAB_CERTIFICATE',
  ADDITIONAL_DOCUMENTS: 'ADDITIONAL_DOCUMENTS',
  KATORLOR1_GENERATED: 'KATORLOR1_GENERATED',
} as const;
export type DocumentSlotCode = (typeof DocumentSlotCode)[keyof typeof DocumentSlotCode];
export const documentSlotCodeSchema = z.enum(enumValues(DocumentSlotCode));

// กลุ่มของช่อง ใช้จัดหน้าจอและหน้าตรวจ ไม่ใช่ตัวตัดสินว่าบังคับหรือไม่ (ตัวตัดสินคือ DocumentRequirementRule)
export const DocumentSlotGroup = {
  IDENTITY: 'IDENTITY',
  QUALIFICATION: 'QUALIFICATION',
  POWER_OF_ATTORNEY: 'POWER_OF_ATTORNEY',
  LAND_AND_SITE: 'LAND_AND_SITE',
  PLANS: 'PLANS',
  CONTROLLED_HERB_LICENSE: 'CONTROLLED_HERB_LICENSE',
  RENEWAL: 'RENEWAL',
  REPLACEMENT: 'REPLACEMENT',
  OPTIONAL: 'OPTIONAL',
  GENERATED: 'GENERATED',
} as const;
export type DocumentSlotGroup = (typeof DocumentSlotGroup)[keyof typeof DocumentSlotGroup];
export const documentSlotGroupSchema = z.enum(enumValues(DocumentSlotGroup));

// ขั้นของฟอร์มที่ช่องนี้ปรากฏ (ApplicationFormStep 1..6) ช่องระบบสร้างอยู่ขั้นที่ 6
const formStepSchema = z.number().int().min(1).max(6);

// สถานะที่ผู้ยื่นแจ้งสำหรับช่องใบอนุญาตสมุนไพรควบคุม (แนบใบอนุญาตแล้ว / ยื่นคำขอแล้วรอผล / ยังไม่ได้ยื่น)
export const LicenseDeclarationStatus = {
  HAVE: 'HAVE',
  APPLIED: 'APPLIED',
  NONE: 'NONE',
} as const;
export type LicenseDeclarationStatus =
  (typeof LicenseDeclarationStatus)[keyof typeof LicenseDeclarationStatus];
export const licenseDeclarationStatusSchema = z.enum(enumValues(LicenseDeclarationStatus));

// หัวข้อย่อยที่เจ้าหน้าที่ติ๊กภายในคู่มือ SOP (กทล.1 ส่วนที่ ๓ A8)
export const SopSubItemCode = {
  SITE_PREPARATION: 'SITE_PREPARATION',
  PLANTING: 'PLANTING',
  CROP_CARE: 'CROP_CARE',
  PEST_MANAGEMENT: 'PEST_MANAGEMENT',
  FERTILISER_AND_SOIL_AMENDMENT: 'FERTILISER_AND_SOIL_AMENDMENT',
  HARVEST: 'HARVEST',
  STORAGE: 'STORAGE',
  PRIMARY_PROCESSING: 'PRIMARY_PROCESSING',
  PERSONNEL_HYGIENE: 'PERSONNEL_HYGIENE',
  TRACEABILITY: 'TRACEABILITY',
  SITE_SANITATION: 'SITE_SANITATION',
} as const;
export type SopSubItemCode = (typeof SopSubItemCode)[keyof typeof SopSubItemCode];
export const sopSubItemCodeSchema = z.enum(enumValues(SopSubItemCode));

export const ACCEPTED_DOCUMENT_MIME_TYPES = {
  PDF: 'application/pdf',
  JPEG: 'image/jpeg',
  PNG: 'image/png',
  WEBP: 'image/webp',
  DOCX: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
} as const;

// นิยามช่องเอกสาร (แถวใน document_slots) ข้อความไทยอยู่ในคอลัมน์ *_th ตาม glossary §5
export const documentSlotDefinitionSchema = z.object({
  code: documentSlotCodeSchema,
  group: documentSlotGroupSchema,
  formStep: formStepSchema,
  sortOrder: z.number().int().min(0),
  labelTh: z.string().min(1),
  whatIsItTh: z.string().min(1),
  howToObtainTh: z.string().min(1).nullable(),
  acceptedMimeTypes: z.array(z.string().min(1)).min(1),
  maxFiles: z.number().int().min(1).max(20),
  maxFileBytes: z.number().int().min(1),
  requiresIssuedDate: z.boolean(),
  issuedWithinDays: z.number().int().min(1).nullable(),
  isLicense: z.boolean(),
  subItemCodes: z.array(sopSubItemCodeSchema).nullable(),
  isSystemGenerated: z.boolean(),
});
export type DocumentSlotDefinition = z.infer<typeof documentSlotDefinitionSchema>;
