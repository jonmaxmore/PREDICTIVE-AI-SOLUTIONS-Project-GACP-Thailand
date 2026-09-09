import { z } from 'zod';
import { calendarDateSchema } from './document-requirement-rules.ts';
import { enumValues } from './enum-values.ts';

// หมวดของรายการตรวจ ณ แปลง ตามโครง GACP (มกษ. 3502-2561 + ข้อกำหนดกัญชา) ชุดปิด ข้อความไทยอยู่ในข้อมูล
export const InspectionChecklistCategory = {
  SITE_AND_ENVIRONMENT: 'SITE_AND_ENVIRONMENT',
  WATER: 'WATER',
  PLANTING_MATERIAL: 'PLANTING_MATERIAL',
  CULTIVATION_PRACTICE: 'CULTIVATION_PRACTICE',
  FERTILISER_AND_SOIL: 'FERTILISER_AND_SOIL',
  PLANT_PROTECTION: 'PLANT_PROTECTION',
  HARVEST: 'HARVEST',
  POST_HARVEST_AND_PRIMARY_PROCESSING: 'POST_HARVEST_AND_PRIMARY_PROCESSING',
  PACKAGING_AND_LABELLING: 'PACKAGING_AND_LABELLING',
  STORAGE_AND_TRANSPORT: 'STORAGE_AND_TRANSPORT',
  PERSONNEL_HYGIENE: 'PERSONNEL_HYGIENE',
  FACILITIES_AND_EQUIPMENT: 'FACILITIES_AND_EQUIPMENT',
  DOCUMENTATION_AND_TRACEABILITY: 'DOCUMENTATION_AND_TRACEABILITY',
  SECURITY_AND_ACCESS_CONTROL: 'SECURITY_AND_ACCESS_CONTROL',
} as const;
export type InspectionChecklistCategory =
  (typeof InspectionChecklistCategory)[keyof typeof InspectionChecklistCategory];
export const inspectionChecklistCategorySchema = z.enum(enumValues(InspectionChecklistCategory));

// รายการตรวจหนึ่งข้อ (แถวใน inspection_checklist_items) มีวันมีผล ข้อ critical ตกข้อเดียว = ผลรวมไม่ผ่าน
export const inspectionChecklistItemSchema = z.object({
  code: z.string().regex(/^CHECK_[A-Z0-9_]+$/),
  plantCode: z.string().min(1),
  category: inspectionChecklistCategorySchema,
  sortOrder: z.number().int().min(0),
  textTh: z.string().min(1),
  guidanceTh: z.string().min(1).nullable(),
  isCritical: z.boolean(),
  requiresPhotoEvidence: z.boolean(),
  sourceTh: z.string().min(1),
  effectiveFrom: calendarDateSchema,
  effectiveTo: calendarDateSchema.nullable(),
});
export type InspectionChecklistItem = z.infer<typeof inspectionChecklistItemSchema>;
