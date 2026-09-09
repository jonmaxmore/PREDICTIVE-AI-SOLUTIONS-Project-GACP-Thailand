import { z } from 'zod';
import { calendarDateSchema } from './document-requirement-rules.ts';
import { certificationScopeSchema, requestTypeSchema } from './enums.ts';

// อายุใบรับรอง (แถวใน certificate_terms) มีวันมีผล ยืนยันกับกรมก่อนเปิดใช้จริง (แผน §11 ข้อ 7)
export const certificateTermSchema = z.object({
  code: z.string().regex(/^TERM_[A-Z0-9_]+$/),
  plantCode: z.string().min(1),
  certificationScopes: z.array(certificationScopeSchema).min(1).nullable(),
  requestTypes: z.array(requestTypeSchema).min(1).nullable(),
  validityMonths: z.number().int().min(1).max(120),
  sourceTh: z.string().min(1),
  effectiveFrom: calendarDateSchema,
  effectiveTo: calendarDateSchema.nullable(),
});
export type CertificateTerm = z.infer<typeof certificateTermSchema>;

// วันหยุดราชการ (แถวใน public_holidays) ใช้คำนวณวันทำการของกำหนดส่งและอายุใบเสนอราคา
export const publicHolidaySchema = z.object({
  date: calendarDateSchema,
  nameTh: z.string().min(1),
});
export type PublicHoliday = z.infer<typeof publicHolidaySchema>;
