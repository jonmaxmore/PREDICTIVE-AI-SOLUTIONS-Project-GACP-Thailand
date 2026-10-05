const CULTIVATION_METHOD_LABELS: Record<string, string> = {
  OUTDOOR: 'กลางแจ้ง',
  GREENHOUSE: 'โรงเรือน',
  INDOOR: 'อาคาร/โรงเรือนระบบปิด',
  INDOOR_CONTROLLED: 'อาคาร/โรงเรือนระบบปิด',
  SELF_GROWN: 'ปลูกเอง',
};

// สถานะล็อตบรรจุ — คำที่ schema ประกาศไว้ (trace.prisma:44: CREATED, PACKAGED, TESTED, SHIPPED)
// เดิมหน้า tracking/lots แปลเฉพาะ PACKAGED แล้วปล่อยค่าอื่นเป็น enum ดิบบนป้าย
const LOT_STATUS_LABELS: Record<string, string> = {
  CREATED: 'สร้างแล้ว',
  PACKAGED: 'บรรจุแล้ว',
  TESTED: 'ตรวจแล็บแล้ว',
  SHIPPED: 'จัดส่งแล้ว',
};

export function lotStatusLabel(status: string | null | undefined): string {
  const key = String(status || '').trim().toUpperCase();
  return LOT_STATUS_LABELS[key] || key || '-';
}

const ACTIVITY_TYPE_LABELS: Record<string, string> = {
  IRRIGATION: 'ให้น้ำ',
  FERTILIZER: 'ให้ปุ๋ย',
  PEST_CONTROL: 'ควบคุมศัตรูพืช',
  WEED_CONTROL: 'กำจัดวัชพืช',
  INSPECTION: 'ตรวจประเมินแปลง',
  INCIDENT: 'เหตุผิดปกติ',
  OTHER: 'อื่น ๆ',
};

// R8 (design note 2026-08-20-planting-tnt-design) retired
// per-plant tracking permanently, so PLANT_UNIT can no longer be chosen
// anywhere. Its label stays for READ ONLY: activities logged before the
// retirement still carry that scope, and printing the raw enum at a farmer
// would be worse than naming what the record historically was.
const ACTIVITY_SCOPE_LABELS: Record<string, string> = {
  CYCLE: 'ทั้งรอบปลูก',
  PLOT: 'เฉพาะแปลง',
  PLANT_UNIT: 'เฉพาะรายต้น (ข้อมูลเดิม)',
};

/**
 * สถานะรอบปลูก — ป้ายไทย + โทนสีของ Badge
 *
 * ชุดค่าเดียวกับ enum ใน prisma/schema/cultivation.prisma (PlantingCycle.status)
 * `tone` เป็นชื่อโทนของ Badge primitive ไม่ใช่ชื่อสีดิบ เพื่อให้จอที่ใช้ค่านี้
 * ได้สีจาก token เดียวกันทั้งระบบ และสถานะไม่ได้สื่อด้วยสีอย่างเดียว
 * (มีข้อความไทยกำกับเสมอ ตาม DESIGN.md)
 */
const CYCLE_STATUS_LABELS: Record<string, { label: string; tone: 'neutral' | 'info' | 'success' | 'warning' }> = {
  PLANNING: { label: 'วางแผน', tone: 'neutral' },
  PLANTED: { label: 'ปลูกแล้ว', tone: 'info' },
  GROWING: { label: 'กำลังเติบโต', tone: 'info' },
  READY_HARVEST: { label: 'พร้อมเก็บเกี่ยว', tone: 'warning' },
  HARVESTED: { label: 'เก็บเกี่ยวแล้ว', tone: 'success' },
  COMPLETED: { label: 'ปิดรอบแล้ว', tone: 'success' },
};

export const CYCLE_STATUS_CODES = Object.keys(CYCLE_STATUS_LABELS);

export function formatCycleStatus(status: string | null | undefined): {
  label: string;
  tone: 'neutral' | 'info' | 'success' | 'warning';
} {
  const normalized = String(status || '').trim().toUpperCase();
  // สถานะที่ไม่รู้จักพิมพ์ค่าดิบออกไป ดีกว่าเงียบ: ค่าที่หลุดจาก enum คือของจริง
  // ที่อยู่ในฐานข้อมูล และเจ้าหน้าที่ต้องเห็นว่ามันมีอยู่
  return CYCLE_STATUS_LABELS[normalized] || { label: normalized || '-', tone: 'neutral' };
}

/**
 * รหัสกิจกรรมทั้งหมดที่ระบบรู้จัก — คีย์ของแผนที่ป้ายด้านบน ไม่ใช่รายการที่สอง
 * จอที่ต้องทำตัวกรองจะได้ไม่ต้องพิมพ์ค่า enum ซ้ำไว้ที่ตัวเอง
 */
export const ACTIVITY_TYPE_CODES = Object.keys(ACTIVITY_TYPE_LABELS);

/**
 * ขอบเขตที่ยัง "บันทึกใหม่" ได้ · PLANT_UNIT ไม่อยู่ในนี้เพราะ R8 ปิดการติดตามรายต้น
 * ไปแล้ว แต่ป้ายของมันยังอยู่ด้านบนเพื่ออ่านข้อมูลเดิมที่บันทึกไว้ก่อนหน้านั้น
 */
export const LOGGABLE_ACTIVITY_SCOPE_CODES = ['CYCLE', 'PLOT'];

export function formatCultivationMethod(code: string | null | undefined): string {
  const normalized = String(code || '').trim().toUpperCase();
  return CULTIVATION_METHOD_LABELS[normalized] || normalized || '-';
}

export function formatCultivationMethods(codes: Array<string | null | undefined>): string {
  const labels = codes
    .map((code) => formatCultivationMethod(code))
    .filter((label) => Boolean(label) && label !== '-');

  if (labels.length === 0) {
    return '-';
  }

  return Array.from(new Set(labels)).join(', ');
}

export function formatActivityType(type: string | null | undefined): string {
  const normalized = String(type || '').trim().toUpperCase();
  return ACTIVITY_TYPE_LABELS[normalized] || normalized || '-';
}

export function formatActivityScope(scope: string | null | undefined): string {
  const normalized = String(scope || '').trim().toUpperCase();
  return ACTIVITY_SCOPE_LABELS[normalized] || normalized || '-';
}

export function toPlantingUserMessage(message: string | null | undefined): string {
  const raw = String(message || '').trim();
  const normalized = raw.toLowerCase();

  if (!raw) {
    return 'ไม่สามารถดำเนินการได้ กรุณาลองใหม่อีกครั้ง';
  }

  if (normalized.includes('no certificate linked')) {
    return 'ยังไม่พบใบรับรองที่เชื่อมโยงกับรอบปลูกนี้';
  }
  if (normalized.includes('active certificate is required before creating planting cycle')) {
    return 'ต้องมีใบรับรองที่ยังใช้งานได้ก่อนเปิดรอบปลูก';
  }
  if (normalized.includes('active certificate is required before harvest')) {
    return 'ต้องมีใบรับรองที่ยังใช้งานได้ก่อนบันทึกเก็บเกี่ยว';
  }
  if (normalized.includes('certificate is not active')) {
    return 'ใบรับรองของฟาร์มนี้ยังไม่อยู่ในสถานะใช้งาน';
  }
  if (normalized.includes('certificate has expired')) {
    return 'ใบรับรองของฟาร์มนี้หมดอายุแล้ว กรุณาต่ออายุก่อน';
  }
  // The three per-plant server messages that used to be translated here
  // (units required before harvest / cannot generate after harvest / quota
  // exhausted) are gone: R8 retired per-plant tracking, so no call this app
  // makes can raise them any more.

  if (normalized.includes('allocated area for plot') && normalized.includes('exceeds plot size')) {
    return 'พื้นที่ที่กำหนดเกินพื้นที่จริงของแปลง';
  }
  if (normalized.includes('some selected plots are invalid')) {
    return 'พบแปลงที่ไม่ถูกต้องสำหรับฟาร์มนี้';
  }
  if (normalized.includes('farm not found')) {
    return 'ไม่พบข้อมูลฟาร์มของบัญชีนี้';
  }
  if (normalized.includes('plotharvests must include all cycle plots')) {
    return 'การเก็บเกี่ยวแบบหลายแปลงต้องระบุน้ำหนักและบรรจุภัณฑ์ให้ครบทุกแปลง';
  }
  if (normalized.includes('packagingrows is required')) {
    return 'กรุณาระบุรายละเอียดบรรจุภัณฑ์ของแต่ละแปลง';
  }
  if (normalized.includes('packaging total weight exceeds freshweightkg')) {
    return 'น้ำหนักรวมในบรรจุภัณฑ์มากกว่าน้ำหนักสดที่ระบุ';
  }
  if (normalized.includes('cycleplotid does not belong to this cycle')) {
    return 'พบข้อมูลแปลงที่ไม่อยู่ในรอบปลูกนี้';
  }
  if (normalized.includes('this cycle has already been harvested')) {
    return 'รอบปลูกนี้ถูกเก็บเกี่ยวแล้ว';
  }
  if (normalized.includes('planting cycle not found')) {
    return 'ไม่พบข้อมูลรอบปลูก';
  }

  return raw;
}
