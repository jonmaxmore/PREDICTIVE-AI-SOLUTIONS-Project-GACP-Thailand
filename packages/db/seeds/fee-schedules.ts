import { FeeBasis, type FeeSchedule, FeeStage, RequestType } from '@gacp/contracts';

// ตารางอัตรา fee-model 2026-09-05 (operator): ก้อนเดียวหน้าบ้าน คูณตามจำนวนรูปแบบการปลูก VAT 7% เต็มทั้งก้อน
// งวดที่ 1 = 5,000 + 500 = 5,500 + VAT 385 = 5,885 บาท · งวดที่ 2 = 25,000 + 2,500 = 27,500 + VAT 1,925 = 29,425 บาท
// ต่ออายุเก็บครั้งเดียว = 30,000 + 3,000 = 33,000 + VAT 2,310 = 35,310 บาท · ใบแทน: ยังไม่มีอัตรา (รอ ruling)

const PLANT = 'cannabis';
const EFFECTIVE_FROM = '2026-09-05';
const VAT_RATE_BASIS_POINTS = 700;
const QUOTATION_VALID_DAYS = 30;
const SOURCE =
  'fee-model 2026-09-05 (operator) · VAT เต็มทั้งก้อน · คูณตามรูปแบบการปลูก (operator 2026-09-08)';

export const feeScheduleSeeds: readonly FeeSchedule[] = [
  {
    code: 'FEE_CANNABIS_DOCUMENT_REVIEW_NEW',
    plantCode: PLANT,
    feeStage: FeeStage.DOCUMENT_REVIEW,
    requestTypes: [RequestType.NEW],
    feeBasis: FeeBasis.PER_CULTIVATION_FORMAT,
    lineTitleTh: 'ค่าตรวจเอกสารและประเมินคำขอ',
    stateFeeSatang: 500_000,
    serviceFeeSatang: 50_000,
    vatRateBasisPoints: VAT_RATE_BASIS_POINTS,
    quotationValidDays: QUOTATION_VALID_DAYS,
    sourceTh: SOURCE,
    effectiveFrom: EFFECTIVE_FROM,
    effectiveTo: null,
  },
  {
    code: 'FEE_CANNABIS_ONSITE_INSPECTION_NEW',
    plantCode: PLANT,
    feeStage: FeeStage.ONSITE_INSPECTION,
    requestTypes: [RequestType.NEW],
    feeBasis: FeeBasis.PER_CULTIVATION_FORMAT,
    lineTitleTh: 'ค่าตรวจประเมิน ณ แปลงปลูก',
    stateFeeSatang: 2_500_000,
    serviceFeeSatang: 250_000,
    vatRateBasisPoints: VAT_RATE_BASIS_POINTS,
    quotationValidDays: QUOTATION_VALID_DAYS,
    sourceTh: SOURCE,
    effectiveFrom: EFFECTIVE_FROM,
    effectiveTo: null,
  },
  {
    code: 'FEE_CANNABIS_RENEWAL',
    plantCode: PLANT,
    feeStage: FeeStage.DOCUMENT_REVIEW,
    requestTypes: [RequestType.RENEWAL],
    feeBasis: FeeBasis.PER_CULTIVATION_FORMAT,
    lineTitleTh: 'ค่าต่ออายุใบรับรอง ตรวจเอกสารและตรวจประเมิน ณ แปลงปลูก',
    stateFeeSatang: 3_000_000,
    serviceFeeSatang: 300_000,
    vatRateBasisPoints: VAT_RATE_BASIS_POINTS,
    quotationValidDays: QUOTATION_VALID_DAYS,
    sourceTh: `${SOURCE} · ต่ออายุงวดเดียว`,
    effectiveFrom: EFFECTIVE_FROM,
    effectiveTo: null,
  },
];
