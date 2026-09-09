import { z } from 'zod';

// สิ่งที่เราเก็บจากผู้ให้บริการยืนยันตัวตน เฉพาะ field ที่ใช้ ไม่เก็บ token
// ThaID: claims ใน id_token ตาม scope openid pid name given_name family_name ial
export const thaidIdentityClaimsSchema = z.object({
  sub: z.string().min(1),
  pid: z
    .string()
    .regex(/^\d{13}$/)
    .optional(),
  name: z.string().min(1).optional(),
  // biome-ignore lint/style/useNamingConvention: ชื่อ claim มาตรฐาน OpenID Connect
  given_name: z.string().min(1).optional(),
  // biome-ignore lint/style/useNamingConvention: ชื่อ claim มาตรฐาน OpenID Connect
  family_name: z.string().min(1).optional(),
  ial: z.string().min(1).optional(),
});
export type ThaidIdentityClaims = z.infer<typeof thaidIdentityClaimsSchema>;

// สังกัดหนึ่งรายการจาก profile ของ Provider ID (MOPH เรียกหน่วยงานว่า organization เราเรียก agency ตาม glossary)
export const providerAffiliationSchema = z.object({
  businessId: z.string().min(1),
  agencyCode: z.string().min(1).nullable(),
  agencyNameTh: z.string().min(1).nullable(),
  position: z.string().min(1).nullable(),
  positionType: z.string().min(1).nullable(),
  licenseId: z.string().min(1).nullable(),
});
export type ProviderAffiliation = z.infer<typeof providerAffiliationSchema>;

// profile ของ Provider ID หลัง normalize (ไม่มี token ไม่มีที่อยู่)
export const morphromProviderProfileSchema = z.object({
  accountId: z.string().min(1),
  hashCid: z.string().min(1).nullable(),
  providerId: z.string().min(1),
  nameTh: z.string().min(1).nullable(),
  affiliations: z.array(providerAffiliationSchema),
});
export type MorphromProviderProfile = z.infer<typeof morphromProviderProfileSchema>;

// ผลการเข้าสู่ระบบด้วย Health ID ที่ต้องรู้เพื่อสร้างตัวตน
export const morphromHealthIdIdentitySchema = z.object({
  accountId: z.string().min(1),
  displayName: z.string().min(1).nullable(),
  hashCid: z.string().min(1).nullable(),
});
export type MorphromHealthIdIdentity = z.infer<typeof morphromHealthIdIdentitySchema>;
