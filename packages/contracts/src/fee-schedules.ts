import { z } from 'zod';
import { calendarDateSchema } from './document-requirement-rules.ts';
import { enumValues } from './enum-values.ts';
import { feeStageSchema, requestTypeSchema } from './enums.ts';

// ฐานคิดค่าธรรมเนียม: คูณตามจำนวนรูปแบบการปลูกที่ติ๊ก (operator 2026-09-08) หรือคิดต่อคำขอ
export const FeeBasis = {
  PER_CULTIVATION_FORMAT: 'PER_CULTIVATION_FORMAT',
  PER_APPLICATION: 'PER_APPLICATION',
} as const;
export type FeeBasis = (typeof FeeBasis)[keyof typeof FeeBasis];
export const feeBasisSchema = z.enum(enumValues(FeeBasis));

const satangSchema = z.number().int().min(0);

// ตารางอัตรา (แถวใน fee_schedules) มีวันมีผล เงินเป็นสตางค์ VAT เป็น basis points ไม่มีตัวเลขในโค้ด
export const feeScheduleSchema = z.object({
  code: z.string().regex(/^FEE_[A-Z0-9_]+$/),
  plantCode: z.string().min(1),
  feeStage: feeStageSchema,
  requestTypes: z.array(requestTypeSchema).min(1),
  feeBasis: feeBasisSchema,
  lineTitleTh: z.string().min(1),
  stateFeeSatang: satangSchema,
  serviceFeeSatang: satangSchema,
  vatRateBasisPoints: z.number().int().min(0).max(10000),
  quotationValidDays: z.number().int().min(1),
  sourceTh: z.string().min(1),
  effectiveFrom: calendarDateSchema,
  effectiveTo: calendarDateSchema.nullable(),
});
export type FeeSchedule = z.infer<typeof feeScheduleSchema>;
