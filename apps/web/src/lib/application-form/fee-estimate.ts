import 'server-only';
import { AreaType, type FeeSchedule, FeeStage, type RequestType } from '@gacp/contracts';
import { loadFeeSchedules } from '@gacp/db';
import { buildQuotation, type QuotationDraft, resolveFeeSchedule } from '@gacp/domain';
import { todayCalendarDateInBangkok } from '@gacp/ui';
import { database } from '@/lib/database.ts';
import { areaTypeShortLabels } from '@/messages/th.ts';

// ยอดโดยประมาณที่แสดงระหว่างกรอกฟอร์ม อ่านจาก fee_schedules ผ่าน domain เท่านั้น (ไม่มีตัวเลขในโค้ด)
// ยอดจริงล็อกเมื่อยืนยันคำรับรองในขั้นถัดไปของการพัฒนา (M3)

export type FeeEstimate = {
  readonly stage: FeeStage;
  readonly schedule: FeeSchedule;
  // หนึ่งรูปแบบการปลูก ใช้บอกอัตราต่อรูปแบบ
  readonly perFormat: QuotationDraft;
  // ตามลักษณะพื้นที่ที่เลือกจริง (null เมื่อยังไม่เลือก)
  readonly forSelection: QuotationDraft | null;
};

export async function loadFeeEstimates(
  plantCode: string,
  requestType: RequestType,
  areaTypes: readonly AreaType[],
): Promise<readonly FeeEstimate[]> {
  const schedules = await loadFeeSchedules(database, plantCode);
  const asOf = todayCalendarDateInBangkok();
  const estimates: FeeEstimate[] = [];
  for (const stage of [FeeStage.DOCUMENT_REVIEW, FeeStage.ONSITE_INSPECTION]) {
    const resolved = resolveFeeSchedule(schedules, {
      plantCode,
      feeStage: stage,
      requestType,
      asOf,
    });
    if (!resolved.ok) continue;
    const perFormat = buildQuotation(resolved.schedule, {
      areaTypes: [AreaType.OUTDOOR],
      areaTypeLabelsTh: areaTypeShortLabels,
      issuedOn: asOf,
    });
    const forSelection =
      areaTypes.length > 0
        ? buildQuotation(resolved.schedule, {
            areaTypes,
            areaTypeLabelsTh: areaTypeShortLabels,
            issuedOn: asOf,
          })
        : null;
    estimates.push({ stage, schedule: resolved.schedule, perFormat, forSelection });
  }
  return estimates;
}
