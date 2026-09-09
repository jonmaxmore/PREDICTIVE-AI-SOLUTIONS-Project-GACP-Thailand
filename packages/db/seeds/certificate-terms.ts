import type { CertificateTerm, PublicHoliday } from '@gacp/contracts';

// อายุใบรับรอง ฉบับร่าง 36 เดือน ยืนยันกับกรมก่อนเปิดใช้จริง (แผน §11 ข้อ 7)
export const certificateTermSeeds: readonly CertificateTerm[] = [
  {
    code: 'TERM_CANNABIS_DEFAULT',
    plantCode: 'cannabis',
    certificationScopes: null,
    requestTypes: null,
    validityMonths: 36,
    sourceTh: 'ร่างตามแนวปฏิบัติการรับรอง GACP ทั่วไป · รอยืนยันกับกรม',
    effectiveFrom: '2026-09-09',
    effectiveTo: null,
  },
];

// วันหยุดราชการ พ.ศ. 2569 ฉบับร่างตามประกาศทั่วไป SYSTEM_ADMIN ปรับตามประกาศคณะรัฐมนตรีประจำปี
// วันหยุดที่ตกเสาร์อาทิตย์ ระบบชดเชยให้เองผ่าน substituteHolidays()
export const publicHolidaySeeds: readonly PublicHoliday[] = [
  { date: '2026-01-01', nameTh: 'วันขึ้นปีใหม่' },
  { date: '2026-03-03', nameTh: 'วันมาฆบูชา' },
  { date: '2026-04-06', nameTh: 'วันจักรี' },
  { date: '2026-04-13', nameTh: 'วันสงกรานต์' },
  { date: '2026-04-14', nameTh: 'วันสงกรานต์' },
  { date: '2026-04-15', nameTh: 'วันสงกรานต์' },
  { date: '2026-05-01', nameTh: 'วันแรงงานแห่งชาติ' },
  { date: '2026-05-04', nameTh: 'วันฉัตรมงคล' },
  { date: '2026-05-31', nameTh: 'วันวิสาขบูชา' },
  { date: '2026-06-03', nameTh: 'วันเฉลิมพระชนมพรรษาสมเด็จพระนางเจ้าฯ พระบรมราชินี' },
  { date: '2026-07-28', nameTh: 'วันเฉลิมพระชนมพรรษาพระบาทสมเด็จพระเจ้าอยู่หัว' },
  { date: '2026-07-29', nameTh: 'วันอาสาฬหบูชา' },
  { date: '2026-07-30', nameTh: 'วันเข้าพรรษา' },
  { date: '2026-08-12', nameTh: 'วันแม่แห่งชาติ' },
  { date: '2026-10-13', nameTh: 'วันนวมินทรมหาราช' },
  { date: '2026-10-23', nameTh: 'วันปิยมหาราช' },
  { date: '2026-12-05', nameTh: 'วันพ่อแห่งชาติและวันชาติ' },
  { date: '2026-12-10', nameTh: 'วันรัฐธรรมนูญ' },
  { date: '2026-12-31', nameTh: 'วันสิ้นปี' },
];
