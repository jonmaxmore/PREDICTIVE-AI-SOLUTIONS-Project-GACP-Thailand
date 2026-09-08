import { z } from 'zod';
import { enumValues } from './enum-values.ts';

// บทบาทผู้ใช้ 7 แบบ (docs/glossary.md §2) หนึ่งคนถือได้หลายบทบาท ไม่มีบทบาทผสม
export const UserRole = {
  APPLICANT: 'APPLICANT',
  FINANCE_OFFICER: 'FINANCE_OFFICER',
  DISPATCHER: 'DISPATCHER',
  DOCUMENT_REVIEWER: 'DOCUMENT_REVIEWER',
  FIELD_INSPECTOR: 'FIELD_INSPECTOR',
  CERTIFICATE_APPROVER: 'CERTIFICATE_APPROVER',
  SYSTEM_ADMIN: 'SYSTEM_ADMIN',
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];
export const userRoleSchema = z.enum(enumValues(UserRole));

// ผู้กระทำใน transition/audit: คน (มีบทบาท) หรือระบบ (webhook, Automation)
export const ActorKind = {
  USER: 'USER',
  SYSTEM: 'SYSTEM',
} as const;
export type ActorKind = (typeof ActorKind)[keyof typeof ActorKind];

// นิติฐานะผู้ขอรับรอง ตาม กทล.1 ส่วนที่ ๑
export const ApplicantType = {
  INDIVIDUAL: 'INDIVIDUAL',
  JURISTIC_PERSON: 'JURISTIC_PERSON',
  COMMUNITY_ENTERPRISE: 'COMMUNITY_ENTERPRISE',
} as const;
export type ApplicantType = (typeof ApplicantType)[keyof typeof ApplicantType];
export const applicantTypeSchema = z.enum(enumValues(ApplicantType));

export const RequestType = {
  NEW: 'NEW',
  RENEWAL: 'RENEWAL',
  REPLACEMENT: 'REPLACEMENT',
} as const;
export type RequestType = (typeof RequestType)[keyof typeof RequestType];
export const requestTypeSchema = z.enum(enumValues(RequestType));

export const CertificationScope = {
  CULTIVATION: 'CULTIVATION',
  PROCESSING: 'PROCESSING',
} as const;
export type CertificationScope = (typeof CertificationScope)[keyof typeof CertificationScope];
export const certificationScopeSchema = z.enum(enumValues(CertificationScope));

export const Purpose = {
  MEDICAL: 'MEDICAL',
  EXPORT: 'EXPORT',
} as const;
export type Purpose = (typeof Purpose)[keyof typeof Purpose];
export const purposeSchema = z.enum(enumValues(Purpose));

// ลักษณะพื้นที่ (กทล.1 ส่วนที่ ๒) เป็น checkbox ติ๊กได้หลายช่อง จึงใช้เป็น set เสมอ
export const AreaType = {
  OUTDOOR: 'OUTDOOR',
  INDOOR: 'INDOOR',
  GREENHOUSE: 'GREENHOUSE',
  OTHER: 'OTHER',
} as const;
export type AreaType = (typeof AreaType)[keyof typeof AreaType];
export const areaTypeSchema = z.enum(enumValues(AreaType));

export const LandTenure = {
  OWNED: 'OWNED',
  STATE_PERMITTED: 'STATE_PERMITTED',
  RENTED: 'RENTED',
  OWNER_PERMITTED: 'OWNER_PERMITTED',
} as const;
export type LandTenure = (typeof LandTenure)[keyof typeof LandTenure];
export const landTenureSchema = z.enum(enumValues(LandTenure));

// งวดค่าธรรมเนียม: งวดที่ 1 ตรวจเอกสาร งวดที่ 2 ตรวจประเมิน ณ แปลง
export const FeeStage = {
  DOCUMENT_REVIEW: 'DOCUMENT_REVIEW',
  ONSITE_INSPECTION: 'ONSITE_INSPECTION',
} as const;
export type FeeStage = (typeof FeeStage)[keyof typeof FeeStage];
export const feeStageSchema = z.enum(enumValues(FeeStage));

// สถานะคำขอ ชุดเดียว เปลี่ยนผ่าน ApplicationWorkflow.transition() เท่านั้น (docs/glossary.md §3)
export const ApplicationStatus = {
  DRAFT: 'DRAFT',
  AWAITING_DOCUMENT_REVIEW_FEE: 'AWAITING_DOCUMENT_REVIEW_FEE',
  SUBMITTED: 'SUBMITTED',
  UNDER_DOCUMENT_REVIEW: 'UNDER_DOCUMENT_REVIEW',
  REVISION_REQUESTED: 'REVISION_REQUESTED',
  DOCUMENTS_ACCEPTED: 'DOCUMENTS_ACCEPTED',
  AWAITING_INSPECTION_FEE: 'AWAITING_INSPECTION_FEE',
  AWAITING_INSPECTION: 'AWAITING_INSPECTION',
  INSPECTION_SCHEDULED: 'INSPECTION_SCHEDULED',
  UNDER_INSPECTION: 'UNDER_INSPECTION',
  AWAITING_APPROVAL: 'AWAITING_APPROVAL',
  CERTIFIED: 'CERTIFIED',
  REJECTED: 'REJECTED',
  NOT_CERTIFIED: 'NOT_CERTIFIED',
  WITHDRAWN: 'WITHDRAWN',
  REVOKED: 'REVOKED',
  EXPIRED: 'EXPIRED',
} as const;
export type ApplicationStatus = (typeof ApplicationStatus)[keyof typeof ApplicationStatus];
export const applicationStatusSchema = z.enum(enumValues(ApplicationStatus));

export const TERMINAL_APPLICATION_STATUSES: ReadonlySet<ApplicationStatus> = new Set([
  ApplicationStatus.REJECTED,
  ApplicationStatus.NOT_CERTIFIED,
  ApplicationStatus.WITHDRAWN,
  ApplicationStatus.REVOKED,
  ApplicationStatus.EXPIRED,
]);

export const IdentityProvider = {
  THAID: 'THAID',
  MORPHROM: 'MORPHROM',
  DEV_LOCAL: 'DEV_LOCAL',
} as const;
export type IdentityProvider = (typeof IdentityProvider)[keyof typeof IdentityProvider];
