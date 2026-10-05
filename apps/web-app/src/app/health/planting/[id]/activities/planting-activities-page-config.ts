import {
  formatActivityScope,
  formatActivityType,
} from '@/lib/planting-labels';
import { bangkokDateParts } from '@/lib/format/thai-date';

// R8 (design note 2026-08-20-planting-tnt-design) retired
// per-plant tracking permanently: an activity can be logged for the whole
// cycle or for one plot, and PLANT_UNIT is no longer offered because there
// is no plant to attach it to.
export const SCOPE_OPTIONS = [
  { value: 'CYCLE', label: formatActivityScope('CYCLE') },
  { value: 'PLOT', label: formatActivityScope('PLOT') },
];

export const ACTIVITY_TYPE_OPTIONS = [
  { value: 'IRRIGATION', label: formatActivityType('IRRIGATION') },
  { value: 'FERTILIZER', label: formatActivityType('FERTILIZER') },
  { value: 'PEST_CONTROL', label: formatActivityType('PEST_CONTROL') },
  { value: 'WEED_CONTROL', label: formatActivityType('WEED_CONTROL') },
  { value: 'INSPECTION', label: formatActivityType('INSPECTION') },
  { value: 'INCIDENT', label: formatActivityType('INCIDENT') },
  { value: 'OTHER', label: formatActivityType('OTHER') },
];

export type ActivityForm = {
  scope: 'CYCLE' | 'PLOT';
  plotId: string;
  activityType: string;
  activityDate: Date | null;
  quantity: number | undefined;
  unit: string;
  method: string;
  weather: string;
  /** ชื่อปุ๋ย/สารเคมี/ผลิตภัณฑ์ที่ใช้ — คอลัมน์ productName มีใน schema มาตลอดแต่ไม่มีใครถาม */
  productName: string;
  /**
   * ชื่อผู้ปฏิบัติงานจริง — คนที่ลงมือทำ ไม่ใช่คนที่กดบันทึก (มติ operator 2026-09-07 แบบ ก.)
   * ไม่บังคับกรอก: แรงงานรายวันส่วนใหญ่ไม่มีบัญชี บังคับเมื่อไรคือบันทึกไม่ได้เลย
   */
  performedBy: string;
  note: string;
};

/**
 * ตัวเลือกมาตรฐานของช่องที่เคยเป็นช่องกรอกอิสระล้วน (operator 2026-09-07:
 * "ไม่ได้มีตัวเลือก และเป็นแบบกรอกหมดเลยหรอ") — ใช้เป็น datalist: เลือกจากรายการ
 * ได้ทันที และยังพิมพ์คำอื่นได้เมื่องานจริงไม่อยู่ในรายการ ไม่มีการบังคับคำ
 */
export const WEATHER_SUGGESTIONS = ['แดดจัด', 'มีเมฆมาก', 'ฝนตกเล็กน้อย', 'ฝนตกหนัก', 'อากาศเย็น', 'ลมแรง'];
export const METHOD_SUGGESTIONS = ['รดน้ำระบบน้ำหยด', 'สปริงเกลอร์', 'รดด้วยมือ', 'ฉีดพ่น', 'หว่าน', 'หยอดโคนต้น', 'ถอน/ตัดด้วยมือ'];
export const UNIT_SUGGESTIONS = ['ลิตร', 'มิลลิลิตร', 'กิโลกรัม', 'กรัม', 'ต้น', 'ครั้ง'];
/** ชนิดกิจกรรมที่การบันทึก "ใช้สารอะไร" สำคัญเป็นพิเศษตาม GACP */
export const PRODUCT_RELEVANT_TYPES = new Set(['FERTILIZER', 'PEST_CONTROL', 'WEED_CONTROL']);

export type UploadedAttachment = {
  documentId: string;
  fileName: string;
  fileUrl: string;
};

export const INITIAL_ACTIVITY_FORM: ActivityForm = {
  scope: 'PLOT',
  plotId: '',
  activityType: 'IRRIGATION',
  activityDate: new Date(),
  quantity: undefined,
  unit: '',
  method: '',
  weather: '',
  productName: '',
  performedBy: '',
  note: '',
};

export function toDateInputValue(date: Date | null): string {
  if (!date) {
    return '';
  }

  // The Bangkok day of the activity — the same day fromDateInputValue reads back.
  return bangkokDateParts(date)?.isoDate ?? '';
}

export function fromDateInputValue(value: string): Date | null {
  if (!value) {
    return null;
  }
  // 00:00 in Bangkok on the picked day, whatever the browser's clock zone.
  return new Date(`${value}T00:00:00+07:00`);
}
