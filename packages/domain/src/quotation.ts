import type { CalendarDate, FeeSchedule, FeeStage, RequestType } from '@gacp/contracts';
import { AreaType, FeeBasis } from '@gacp/contracts';
import { addCalendarDays } from './business-days.ts';
import { isRuleActiveOn } from './document-requirements.ts';
import { calculateQuotationTotals, type QuotationTotals, type Satang } from './money.ts';

// ใบเสนอราคาก้อนเดียวต่องวด: บรรทัดต่อรูปแบบการปลูก (operator 2026-09-08) ตัวเลขทุกตัวมาจาก FeeSchedule ไม่มีในโค้ด

export const FeeScheduleResolutionErrorCode = {
  NO_ACTIVE_FEE_SCHEDULE: 'NO_ACTIVE_FEE_SCHEDULE',
  MULTIPLE_ACTIVE_FEE_SCHEDULES: 'MULTIPLE_ACTIVE_FEE_SCHEDULES',
} as const;
export type FeeScheduleResolutionErrorCode =
  (typeof FeeScheduleResolutionErrorCode)[keyof typeof FeeScheduleResolutionErrorCode];

export type FeeScheduleQuery = {
  readonly plantCode: string;
  readonly feeStage: FeeStage;
  readonly requestType: RequestType;
  readonly asOf: CalendarDate;
};

export type FeeScheduleResolution =
  | { readonly ok: true; readonly schedule: FeeSchedule }
  | { readonly ok: false; readonly code: FeeScheduleResolutionErrorCode };

export function resolveFeeSchedule(
  schedules: readonly FeeSchedule[],
  query: FeeScheduleQuery,
): FeeScheduleResolution {
  const matches = schedules.filter(
    (schedule) =>
      schedule.plantCode === query.plantCode &&
      schedule.feeStage === query.feeStage &&
      schedule.requestTypes.includes(query.requestType) &&
      isRuleActiveOn(schedule, query.asOf),
  );
  if (matches.length === 0) {
    return { ok: false, code: FeeScheduleResolutionErrorCode.NO_ACTIVE_FEE_SCHEDULE };
  }
  if (matches.length > 1) {
    return { ok: false, code: FeeScheduleResolutionErrorCode.MULTIPLE_ACTIVE_FEE_SCHEDULES };
  }
  return { ok: true, schedule: matches[0] as FeeSchedule };
}

export type QuotationLine = {
  readonly titleTh: string;
  readonly areaType: AreaType | null;
  readonly stateFeeSatang: Satang;
  readonly serviceFeeSatang: Satang;
  readonly lineTotalSatang: Satang;
};

export type QuotationDraft = {
  readonly feeScheduleCode: string;
  readonly feeStage: FeeStage;
  readonly lines: readonly QuotationLine[];
  readonly totals: QuotationTotals;
  readonly vatRateBasisPoints: number;
  readonly issuedOn: CalendarDate;
  readonly validUntil: CalendarDate;
};

export type BuildQuotationInput = {
  readonly areaTypes: readonly AreaType[];
  // ข้อความไทยของรูปแบบการปลูกมาจาก catalog ของแอป ไม่อยู่ในโดเมน
  readonly areaTypeLabelsTh: Readonly<Record<AreaType, string>>;
  readonly issuedOn: CalendarDate;
};

const AREA_TYPE_ORDER: readonly AreaType[] = Object.values(AreaType);

function distinctAreaTypesInOrder(areaTypes: readonly AreaType[]): AreaType[] {
  return AREA_TYPE_ORDER.filter((areaType) => areaTypes.includes(areaType));
}

export function buildQuotation(schedule: FeeSchedule, input: BuildQuotationInput): QuotationDraft {
  const lines: QuotationLine[] = [];
  if (schedule.feeBasis === FeeBasis.PER_CULTIVATION_FORMAT) {
    const formats = distinctAreaTypesInOrder(input.areaTypes);
    if (formats.length === 0) {
      throw new RangeError('ต้องเลือกรูปแบบการปลูกอย่างน้อยหนึ่งรูปแบบก่อนออกใบเสนอราคา');
    }
    for (const areaType of formats) {
      lines.push({
        titleTh: `${schedule.lineTitleTh} · รูปแบบการปลูก ${input.areaTypeLabelsTh[areaType]}`,
        areaType,
        stateFeeSatang: schedule.stateFeeSatang,
        serviceFeeSatang: schedule.serviceFeeSatang,
        lineTotalSatang: schedule.stateFeeSatang + schedule.serviceFeeSatang,
      });
    }
  } else {
    lines.push({
      titleTh: schedule.lineTitleTh,
      areaType: null,
      stateFeeSatang: schedule.stateFeeSatang,
      serviceFeeSatang: schedule.serviceFeeSatang,
      lineTotalSatang: schedule.stateFeeSatang + schedule.serviceFeeSatang,
    });
  }
  const totals = calculateQuotationTotals(lines, schedule.vatRateBasisPoints);
  return {
    feeScheduleCode: schedule.code,
    feeStage: schedule.feeStage,
    lines,
    totals,
    vatRateBasisPoints: schedule.vatRateBasisPoints,
    issuedOn: input.issuedOn,
    validUntil: addCalendarDays(input.issuedOn, schedule.quotationValidDays),
  };
}
