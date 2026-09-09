import { AreaType, FeeBasis, type FeeSchedule, FeeStage, RequestType } from '@gacp/contracts';
import { describe, expect, it } from 'vitest';
import { buildQuotation, FeeScheduleResolutionErrorCode, resolveFeeSchedule } from './quotation.ts';

// อัตราสมมติที่สะท้อนตารางจริง 2026-09-05 เพื่อทดสอบเครื่องยนต์ ตารางจริงอยู่ใน packages/db/seeds
const schedules: FeeSchedule[] = [
  {
    code: 'FEE_TEST_DOCUMENT_REVIEW_NEW',
    plantCode: 'cannabis',
    feeStage: FeeStage.DOCUMENT_REVIEW,
    requestTypes: [RequestType.NEW],
    feeBasis: FeeBasis.PER_CULTIVATION_FORMAT,
    lineTitleTh: 'ค่าตรวจเอกสารและประเมินคำขอ',
    stateFeeSatang: 500_000,
    serviceFeeSatang: 50_000,
    vatRateBasisPoints: 700,
    quotationValidDays: 30,
    sourceTh: 'ทดสอบ',
    effectiveFrom: '2026-09-05',
    effectiveTo: null,
  },
  {
    code: 'FEE_TEST_ONSITE_INSPECTION_NEW',
    plantCode: 'cannabis',
    feeStage: FeeStage.ONSITE_INSPECTION,
    requestTypes: [RequestType.NEW],
    feeBasis: FeeBasis.PER_CULTIVATION_FORMAT,
    lineTitleTh: 'ค่าตรวจประเมิน ณ แปลงปลูก',
    stateFeeSatang: 2_500_000,
    serviceFeeSatang: 250_000,
    vatRateBasisPoints: 700,
    quotationValidDays: 30,
    sourceTh: 'ทดสอบ',
    effectiveFrom: '2026-09-05',
    effectiveTo: null,
  },
  {
    code: 'FEE_TEST_RENEWAL',
    plantCode: 'cannabis',
    feeStage: FeeStage.DOCUMENT_REVIEW,
    requestTypes: [RequestType.RENEWAL],
    feeBasis: FeeBasis.PER_CULTIVATION_FORMAT,
    lineTitleTh: 'ค่าต่ออายุใบรับรอง',
    stateFeeSatang: 3_000_000,
    serviceFeeSatang: 300_000,
    vatRateBasisPoints: 700,
    quotationValidDays: 30,
    sourceTh: 'ทดสอบ',
    effectiveFrom: '2026-09-05',
    effectiveTo: null,
  },
  {
    code: 'FEE_TEST_OLD_RATE',
    plantCode: 'cannabis',
    feeStage: FeeStage.DOCUMENT_REVIEW,
    requestTypes: [RequestType.NEW],
    feeBasis: FeeBasis.PER_CULTIVATION_FORMAT,
    lineTitleTh: 'อัตราเก่า',
    stateFeeSatang: 1,
    serviceFeeSatang: 1,
    vatRateBasisPoints: 700,
    quotationValidDays: 30,
    sourceTh: 'ทดสอบ',
    effectiveFrom: '2026-01-01',
    effectiveTo: '2026-09-05',
  },
];

const labels = {
  [AreaType.OUTDOOR]: 'กลางแจ้ง',
  [AreaType.INDOOR]: 'โรงเรือนระบบปิด',
  [AreaType.GREENHOUSE]: 'โรงเรือนทั่วไป',
  [AreaType.OTHER]: 'อื่น ๆ',
} as const;

describe('resolveFeeSchedule', () => {
  it('เลือกอัตราที่มีผล ณ วันยื่น ไม่ใช่อัตราเก่า', () => {
    const result = resolveFeeSchedule(schedules, {
      plantCode: 'cannabis',
      feeStage: FeeStage.DOCUMENT_REVIEW,
      requestType: RequestType.NEW,
      asOf: '2026-09-09',
    });
    expect(result.ok && result.schedule.code).toBe('FEE_TEST_DOCUMENT_REVIEW_NEW');
  });

  it('ไม่มีอัตราสำหรับใบแทน = ออกใบเสนอราคาไม่ได้ ไม่เดาราคา', () => {
    const result = resolveFeeSchedule(schedules, {
      plantCode: 'cannabis',
      feeStage: FeeStage.DOCUMENT_REVIEW,
      requestType: RequestType.REPLACEMENT,
      asOf: '2026-09-09',
    });
    expect(result).toEqual({
      ok: false,
      code: FeeScheduleResolutionErrorCode.NO_ACTIVE_FEE_SCHEDULE,
    });
  });

  it('อัตราซ้อนกันสองแถว = ข้อผิดพลาดของข้อมูล ต้องไม่เลือกเอง', () => {
    const duplicated = [
      ...schedules,
      { ...schedules[0], code: 'FEE_TEST_DUPLICATE' } as FeeSchedule,
    ];
    const result = resolveFeeSchedule(duplicated, {
      plantCode: 'cannabis',
      feeStage: FeeStage.DOCUMENT_REVIEW,
      requestType: RequestType.NEW,
      asOf: '2026-09-09',
    });
    expect(result).toEqual({
      ok: false,
      code: FeeScheduleResolutionErrorCode.MULTIPLE_ACTIVE_FEE_SCHEDULES,
    });
  });
});

describe('buildQuotation', () => {
  const documentReview = schedules[0] as FeeSchedule;
  const onsiteInspection = schedules[1] as FeeSchedule;
  const renewal = schedules[2] as FeeSchedule;

  it('งวดที่ 1 สองรูปแบบการปลูก = 11,770.00 บาท บรรทัดต่อรูปแบบ ชื่อเต็มความ', () => {
    const draft = buildQuotation(documentReview, {
      areaTypes: [AreaType.OUTDOOR, AreaType.INDOOR, AreaType.OUTDOOR],
      areaTypeLabelsTh: labels,
      issuedOn: '2026-09-09',
    });
    expect(draft.lines.map((line) => line.titleTh)).toEqual([
      'ค่าตรวจเอกสารและประเมินคำขอ · รูปแบบการปลูก กลางแจ้ง',
      'ค่าตรวจเอกสารและประเมินคำขอ · รูปแบบการปลูก โรงเรือนระบบปิด',
    ]);
    expect(draft.totals.subtotalSatang).toBe(1_100_000);
    expect(draft.totals.vatSatang).toBe(77_000);
    expect(draft.totals.netSatang).toBe(1_177_000);
    expect(draft.validUntil).toBe('2026-10-09');
  });

  it('งวดที่ 2 สองรูปแบบ = 58,850.00 บาท และรูปแบบเดียว = 29,425.00 บาท', () => {
    const two = buildQuotation(onsiteInspection, {
      areaTypes: [AreaType.OUTDOOR, AreaType.INDOOR],
      areaTypeLabelsTh: labels,
      issuedOn: '2026-10-01',
    });
    expect(two.totals.netSatang).toBe(5_885_000);
    const one = buildQuotation(onsiteInspection, {
      areaTypes: [AreaType.GREENHOUSE],
      areaTypeLabelsTh: labels,
      issuedOn: '2026-10-01',
    });
    expect(one.totals.netSatang).toBe(2_942_500);
  });

  it('ต่ออายุเก็บครั้งเดียว 35,310.00 บาทต่อรูปแบบ', () => {
    const draft = buildQuotation(renewal, {
      areaTypes: [AreaType.OUTDOOR],
      areaTypeLabelsTh: labels,
      issuedOn: '2026-09-09',
    });
    expect(draft.totals.netSatang).toBe(3_531_000);
  });

  it('ไม่มีรูปแบบการปลูก = ออกใบไม่ได้', () => {
    expect(() =>
      buildQuotation(documentReview, {
        areaTypes: [],
        areaTypeLabelsTh: labels,
        issuedOn: '2026-09-09',
      }),
    ).toThrow(RangeError);
  });
});
