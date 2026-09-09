import { z } from 'zod';
import { documentSlotCodeSchema } from './document-slots.ts';
import { enumValues } from './enum-values.ts';
import {
  applicantTypeSchema,
  areaTypeSchema,
  certificationScopeSchema,
  landTenureSchema,
  purposeSchema,
  requestTypeSchema,
} from './enums.ts';

export const RequirementLevel = {
  REQUIRED: 'REQUIRED',
  OPTIONAL: 'OPTIONAL',
} as const;
export type RequirementLevel = (typeof RequirementLevel)[keyof typeof RequirementLevel];
export const requirementLevelSchema = z.enum(enumValues(RequirementLevel));

// วันที่ปฏิทิน (ไม่มีเวลา) ใช้กับทุกตารางที่มีวันมีผล
export const calendarDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'ต้องเป็น YYYY-MM-DD');
export type CalendarDate = z.infer<typeof calendarDateSchema>;

// กฎเอกสารบังคับ (แถวใน document_requirement_rules) append-only มีวันมีผล
// ทุกมิติเป็น null = ใช้กับทุกค่า ถ้าเป็น array = ใช้เมื่อคำขอมีค่าใด ๆ ในรายการ (มิติที่เป็น set เช่น areaTypes ใช้ "มีร่วมกันอย่างน้อยหนึ่งค่า")
export const documentRequirementRuleSchema = z.object({
  code: z.string().regex(/^RULE_[A-Z0-9_]+$/),
  plantCode: z.string().min(1),
  slotCode: documentSlotCodeSchema,
  requirementLevel: requirementLevelSchema,
  applicantTypes: z.array(applicantTypeSchema).min(1).nullable(),
  requestTypes: z.array(requestTypeSchema).min(1).nullable(),
  certificationScopes: z.array(certificationScopeSchema).min(1).nullable(),
  purposes: z.array(purposeSchema).min(1).nullable(),
  areaTypes: z.array(areaTypeSchema).min(1).nullable(),
  landTenures: z.array(landTenureSchema).min(1).nullable(),
  attorneyInFact: z.boolean().nullable(),
  // ช่องที่อยู่กลุ่มทางเลือกเดียวกัน แนบครบเพียงช่องใดช่องหนึ่งก็ผ่าน (เช่น ใบแจ้งความ หรือ ใบรับรองที่ชำรุด)
  alternativeGroupCode: z.string().min(1).nullable(),
  reasonTh: z.string().min(1),
  sourceTh: z.string().min(1),
  effectiveFrom: calendarDateSchema,
  effectiveTo: calendarDateSchema.nullable(),
});
export type DocumentRequirementRule = z.infer<typeof documentRequirementRuleSchema>;
