import { z } from 'zod';
import { calendarDateSchema } from './document-requirement-rules.ts';
import { documentSlotCodeSchema, licenseDeclarationStatusSchema } from './document-slots.ts';
import { enumValues } from './enum-values.ts';
import {
  ApplicantType,
  applicantTypeSchema,
  areaTypeSchema,
  certificationScopeSchema,
  landTenureSchema,
  purposeSchema,
  requestTypeSchema,
} from './enums.ts';

// ชื่อ field ทุกตัวของฟอร์มคำขอ (ApplicationForm) นิยามที่นี่ที่เดียว ฟอร์ม Server Action ฐานข้อมูล และ Katorlor1Renderer อ่านชุดเดียวกัน
// ร่าง (draft) ยอมให้ว่างได้ทุกช่อง ความครบถ้วนตัดสินที่ขั้นที่ 6 ด้วย requiredApplicantFields() และ requirement lens

const trimmed = z.string().trim();
const optionalText = (max: number) =>
  trimmed
    .max(max)
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .optional();

// เลขประจำตัวประชาชนไทย 13 หลัก ตรวจ checksum หลักที่ 13
export function isValidThaiNationalId(digits: string): boolean {
  if (!/^\d{13}$/.test(digits)) return false;
  let sum = 0;
  for (let index = 0; index < 12; index += 1) {
    sum += Number(digits[index]) * (13 - index);
  }
  const check = (11 - (sum % 11)) % 10;
  return check === Number(digits[12]);
}

export const thaiNationalIdSchema = z
  .string()
  .transform((value) => value.replace(/[\s-]/g, ''))
  .refine(isValidThaiNationalId, 'เลขประจำตัวประชาชนไม่ถูกต้อง ตรวจสอบ 13 หลักอีกครั้ง');

export const thaiPostalCodeSchema = trimmed.regex(/^\d{5}$/, 'รหัสไปรษณีย์ต้องมี 5 หลัก');
export const thaiPhoneSchema = z
  .string()
  .transform((value) => value.replace(/[\s-]/g, ''))
  .refine((value) => /^0\d{8,9}$/.test(value), 'หมายเลขโทรศัพท์ต้องเริ่มด้วย 0 และมี 9 ถึง 10 หลัก');

export const applicationFormStepSchema = z.coerce.number().int().min(1).max(6);
export type ApplicationFormStep = 1 | 2 | 3 | 4 | 5 | 6;
export const APPLICATION_FORM_STEPS: readonly ApplicationFormStep[] = [1, 2, 3, 4, 5, 6];

// ขั้นที่ 1 ประเภทคำขอและผู้ยื่น
export const applicationStep1Schema = z.object({
  requestType: requestTypeSchema,
  certificationScope: certificationScopeSchema,
  plantCode: trimmed.min(1),
  applicantType: applicantTypeSchema,
  isAttorneyInFact: z.boolean(),
  previousCertificateNumber: optionalText(40),
});
export type ApplicationStep1Input = z.infer<typeof applicationStep1Schema>;

// ขั้นที่ 2 ตัวตนผู้ขอรับรอง (กทล.1 ส่วนที่ ๑) ร่างยอมให้ว่าง
export const applicantIdentityDraftSchema = z.object({
  legalName: optionalText(200),
  registrationNumber: optionalText(60),
  representativeName: optionalText(200),
  nationality: optionalText(60),
  nationalId: z
    .string()
    .transform((value) => value.replace(/[\s-]/g, ''))
    .refine((value) => value === '' || isValidThaiNationalId(value), 'เลขประจำตัวประชาชนไม่ถูกต้อง')
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .optional(),
  houseRegistrationNo: optionalText(20),
  addressLine: optionalText(200),
  subdistrict: optionalText(100),
  district: optionalText(100),
  province: optionalText(100),
  postalCode: optionalText(5),
  mobilePhone: optionalText(20),
  email: optionalText(120),
  lineId: optionalText(60),
  attorneyPositionTh: optionalText(120),
});
export type ApplicantIdentityDraft = z.infer<typeof applicantIdentityDraftSchema>;

export type ApplicantIdentityField = keyof ApplicantIdentityDraft;

const COMMON_REQUIRED_IDENTITY_FIELDS: readonly ApplicantIdentityField[] = [
  'legalName',
  'addressLine',
  'subdistrict',
  'district',
  'province',
  'postalCode',
  'mobilePhone',
];

// ช่องบังคับของส่วนที่ ๑ ต่อประเภทผู้ขอรับรอง (ตามแบบ กทล.1 ข้อ ๑.๑ ถึง ๑.๓)
export function requiredApplicantFields(
  applicantType: ApplicantType,
  isAttorneyInFact: boolean,
): readonly ApplicantIdentityField[] {
  const byType: Record<ApplicantType, readonly ApplicantIdentityField[]> = {
    [ApplicantType.COMMUNITY_ENTERPRISE]: [
      'representativeName',
      'nationalId',
      'nationality',
      'registrationNumber',
      'houseRegistrationNo',
    ],
    [ApplicantType.INDIVIDUAL]: ['nationalId'],
    [ApplicantType.JURISTIC_PERSON]: ['representativeName', 'registrationNumber'],
  };
  return [
    ...COMMON_REQUIRED_IDENTITY_FIELDS,
    ...byType[applicantType],
    ...(isAttorneyInFact ? (['attorneyPositionTh'] as const) : []),
  ];
}

// ขั้นที่ 3 สถานที่และที่ดิน (กทล.1 ส่วนที่ ๒ ข้อ ๑ ถึง ๒) ร่างยอมให้ว่าง
const optionalDecimal = z
  .string()
  .trim()
  .transform((value) => (value === '' ? null : Number(value)))
  .refine((value) => value === null || Number.isFinite(value), 'ต้องเป็นตัวเลข')
  .nullable()
  .optional();
const optionalInteger = z
  .string()
  .trim()
  .transform((value) => (value === '' ? null : Number(value)))
  .refine(
    (value) => value === null || (Number.isInteger(value) && value >= 0),
    'ต้องเป็นจำนวนเต็มไม่ติดลบ',
  )
  .nullable()
  .optional();

export const siteAndLandDraftSchema = z.object({
  siteAddressLine: optionalText(200),
  siteSubdistrict: optionalText(100),
  siteDistrict: optionalText(100),
  siteProvince: optionalText(100),
  sitePostalCode: optionalText(5),
  sitePhone: optionalText(20),
  latitude: optionalDecimal,
  longitude: optionalDecimal,
  landDocumentType: optionalText(100),
  landDocumentNumber: optionalText(60),
  landVolume: optionalText(30),
  landPage: optionalText(30),
  landIssuedBy: optionalText(200),
  areaSquareMetres: optionalDecimal,
  plantsPerCycle: optionalInteger,
  cyclesPerYear: optionalInteger,
  areaTypes: z.array(areaTypeSchema).max(4),
  areaTypeOther: optionalText(120),
  landTenure: landTenureSchema.nullable().optional(),
  landlordName: optionalText(200),
  leaseEndsOn: calendarDateSchema.nullable().optional(),
});
export type SiteAndLandDraft = z.infer<typeof siteAndLandDraftSchema>;

export const REQUIRED_SITE_AND_LAND_FIELDS: readonly (keyof SiteAndLandDraft)[] = [
  'siteAddressLine',
  'siteSubdistrict',
  'siteDistrict',
  'siteProvince',
  'sitePostalCode',
  'sitePhone',
  'latitude',
  'longitude',
  'landDocumentType',
  'landDocumentNumber',
  'landIssuedBy',
  'areaSquareMetres',
  'plantsPerCycle',
  'cyclesPerYear',
  'areaTypes',
  'landTenure',
];

// ขั้นที่ 4 พันธุ์และวัตถุประสงค์ (กทล.1 ส่วนที่ ๒ ข้อ ๓)
export const PlantMaterialKind = {
  SEED: 'SEED',
  OTHER_PART: 'OTHER_PART',
  PROCESSING_PART: 'PROCESSING_PART',
} as const;
export type PlantMaterialKind = (typeof PlantMaterialKind)[keyof typeof PlantMaterialKind];
export const plantMaterialKindSchema = z.enum(enumValues(PlantMaterialKind));

export const MaterialOrigin = {
  DOMESTIC: 'DOMESTIC',
  IMPORTED: 'IMPORTED',
} as const;
export type MaterialOrigin = (typeof MaterialOrigin)[keyof typeof MaterialOrigin];
export const materialOriginSchema = z.enum(enumValues(MaterialOrigin));

export const plantMaterialInputSchema = z.object({
  kind: plantMaterialKindSchema,
  varietyName: trimmed.min(1, 'กรุณาระบุชื่อพันธุ์หรือสายพันธุ์').max(200),
  origin: materialOriginSchema,
  originCountry: optionalText(100),
  source: trimmed.min(1, 'กรุณาระบุแหล่งที่มา').max(200),
  quantity: optionalDecimal,
  unit: optionalText(30),
});
export type PlantMaterialInput = z.infer<typeof plantMaterialInputSchema>;

export const purposesDraftSchema = z.object({
  purposes: z.array(purposeSchema).max(2),
});

// เกิน 2 รายการ Katorlor1Renderer สร้างภาคผนวก ก
export const KATORLOR1_PLANT_MATERIAL_ROWS = 2;

// ขั้นที่ 5 สถานะใบอนุญาตสมุนไพรควบคุมที่ผู้ยื่นแจ้ง
export const licenseDeclarationInputSchema = z
  .object({
    slotCode: documentSlotCodeSchema,
    status: licenseDeclarationStatusSchema,
    licenseNumber: optionalText(60),
    issuedOn: calendarDateSchema.nullable().optional(),
    expiresOn: calendarDateSchema.nullable().optional(),
    receiptNumber: optionalText(60),
    filedWithTh: optionalText(200),
    filedOn: calendarDateSchema.nullable().optional(),
    expectedDecisionOn: calendarDateSchema.nullable().optional(),
  })
  .refine((value) => value.slotCode.startsWith('CONTROLLED_HERB_LICENSE_'), {
    path: ['slotCode'],
    message: 'ใช้ได้กับช่องใบอนุญาตสมุนไพรควบคุมเท่านั้น',
  });
export type LicenseDeclarationInput = z.infer<typeof licenseDeclarationInputSchema>;

// อัปโหลดเอกสารเข้าช่อง (ท่อเดียวของทั้งระบบ)
export const documentUploadInputSchema = z.object({
  applicationId: z.uuid(),
  slotCode: documentSlotCodeSchema,
  issuedOn: calendarDateSchema.nullable().optional(),
});
export type DocumentUploadInput = z.infer<typeof documentUploadInputSchema>;

export const documentRemoveInputSchema = z.object({
  applicationId: z.uuid(),
  documentId: z.uuid(),
});
