import type { HarvestData } from '../hooks/use-application-flow-store';

export interface QualityWorkflowStep {
  key: string;
  title: string;
  detail: string;
}

export const DEFAULT_QC_CHECKS = {
  hasSOPs: false,
  hasQualityLog: false,
  hasContaminationPrevention: false,
  hasPestManagement: false,
  hasWasteManagement: false,
  hasTraceability: false,
} as const;

export type QcCheckKey = keyof typeof DEFAULT_QC_CHECKS;

export interface PackagingOption {
  value: NonNullable<HarvestData['packagingType']>;
  label: string;
  description: string;
}

export interface GacpControlOption {
  key: QcCheckKey;
  label: string;
  dtamRef: string;
  helpText: string;
}

export const HARVEST_METHOD_OPTIONS = [
  { value: 'MANUAL', label: 'เก็บด้วยมือ', description: 'เก็บเกี่ยวด้วยแรงงานคน เหมาะกับพืชคุณภาพสูง' },
  { value: 'MACHINE', label: 'เก็บด้วยเครื่องจักร', description: 'ใช้เครื่องจักร/อุปกรณ์ช่วยเก็บเกี่ยว' },
] as const;

export const HARVEST_MATURITY_OPTIONS = [
  { value: 'EARLY', label: 'ระยะต้น (Early)' },
  { value: 'PEAK', label: 'ระยะเต็มที่ (Peak)' },
  { value: 'LATE', label: 'ระยะปลาย (Late)' },
];

export const TRIM_METHOD_OPTIONS = [
  { value: 'WET', label: 'ตัดแต่งสด (Wet Trim)' },
  { value: 'DRY', label: 'ตัดแต่งแห้ง (Dry Trim)' },
];

export const DRYING_METHOD_OPTIONS = [
  { value: 'HANGING', label: 'แขวนแห้ง' },
  { value: 'RACK', label: 'ตากบนชั้นตากแห้ง' },
  { value: 'SUN', label: 'ตากแดด' },
  { value: 'GREENHOUSE', label: 'ตากในโรงเรือน' },
  { value: 'OVEN', label: 'อบด้วยตู้อบ' },
  { value: 'DEHYDRATOR', label: 'เครื่องขจัดความชื้น' },
  { value: 'OTHER', label: 'อื่น ๆ' },
];

export const DRYING_AIRFLOW_OPTIONS = [
  { value: 'NATURAL', label: 'ลมธรรมชาติ' },
  { value: 'FAN_INDIRECT', label: 'พัดลม (ไม่ส่งตรง)' },
  { value: 'HVAC', label: 'ระบบปรับอากาศ (HVAC)' },
];

export const STORAGE_OPTIONS = [
  { value: 'CONTROLLED', label: 'ห้องควบคุมอุณหภูมิ' },
  { value: 'AMBIENT', label: 'อุณหภูมิห้องปกติ' },
  { value: 'SILO', label: 'ไซโล/ถังเก็บ' },
];

export const CURING_CONTAINER_OPTIONS = [
  { value: 'GLASS_JAR', label: 'โหลแก้ว' },
  { value: 'VACUUM_BAG', label: 'ถุงสุญญากาศ' },
  { value: 'NITROGEN_BAG', label: 'ถุงบรรจุไนโตรเจน' },
  { value: 'HUMIDITY_CONTROLLED', label: 'ภาชนะควบคุมความชื้น' },
  { value: 'OTHER', label: 'อื่น ๆ' },
];

export const CURING_BURP_OPTIONS = [
  { value: 'TWICE_DAILY', label: 'วันละ 2 ครั้ง' },
  { value: 'DAILY', label: 'วันละ 1 ครั้ง' },
  { value: 'WEEKLY', label: 'สัปดาห์ละ 1 ครั้ง' },
];

export const PACKAGING_OPTIONS: PackagingOption[] = [
  { value: 'VACUUM', label: 'บรรจุสุญญากาศ', description: 'ดูดอากาศออก ป้องกันการเกิดเชื้อรา' },
  { value: 'FOOD_GRADE', label: 'ถุง/ซองฟู้ดเกรด', description: 'วัสดุที่ผ่านมาตรฐานอาหารปลอดภัย' },
  { value: 'FOIL', label: 'ถุงฟอยล์/อะลูมิเนียม', description: 'ป้องกันแสง กันความชื้นได้ดี' },
  { value: 'AIR_TIGHT', label: 'ภาชนะปิดสนิท', description: 'ขวดแก้วหรือภาชนะที่ปิดผนึกสนิท' },
  { value: 'OTHER', label: 'อื่น ๆ (ระบุ)', description: 'ระบุประเภทบรรจุภัณฑ์อื่น' },
];

export const GACP_CONTROL_OPTIONS: GacpControlOption[] = [
  { key: 'hasSOPs', label: 'มีขั้นตอนปฏิบัติงานมาตรฐาน (SOPs)', dtamRef: 'หมวด 1', helpText: 'เอกสาร SOP สำหรับทุกขั้นตอนการผลิต ตั้งแต่ปลูก เก็บเกี่ยว จนถึงจัดเก็บ' },
  { key: 'hasQualityLog', label: 'มีบันทึกคุณภาพเป็นลายลักษณ์อักษร', dtamRef: 'หมวด 3', helpText: 'สมุดบันทึกข้อมูลการผลิต การตรวจวัด และผลการทดสอบ' },
  { key: 'hasContaminationPrevention', label: 'มีมาตรการป้องกันการปนเปื้อน', dtamRef: 'หมวด 1', helpText: 'ระบบป้องกันสารปนเปื้อน โลหะหนัก สารเคมี และจุลินทรีย์' },
  { key: 'hasPestManagement', label: 'มีแผนจัดการศัตรูพืชแบบผสมผสาน (IPM)', dtamRef: 'หมวด 6', helpText: 'การจัดการศัตรูพืชแบบ Integrated Pest Management: ชีวภาพ, กล, เพาะเลี้ยง, เคมี' },
  { key: 'hasWasteManagement', label: 'มีระบบจัดการของเสีย', dtamRef: 'หมวด 1', helpText: 'แผนกำจัดของเสียจากกระบวนการผลิต สอดคล้องกับข้อกำหนดสิ่งแวดล้อม' },
  { key: 'hasTraceability', label: 'มีระบบตามสอบย้อนกลับ', dtamRef: 'หมวด 14', helpText: 'สามารถติดตามผลิตภัณฑ์ย้อนกลับถึงแหล่งวัตถุดิบและล็อตการผลิตได้' },
];

export const QUALITY_WORKFLOW_STEPS: QualityWorkflowStep[] = [
  {
    key: 'harvest',
    title: '1) การเก็บเกี่ยว',
    detail: 'วิธีการเก็บเกี่ยว ระยะความสุก การตัดแต่ง ตามมาตรฐาน GACP',
  },
  {
    key: 'post-harvest',
    title: '2) หลังการเก็บเกี่ยว',
    detail: 'การทำแห้ง การบ่ม การจัดเก็บ และบรรจุภัณฑ์',
  },
  {
    key: 'qc',
    title: '3) ระบบควบคุมคุณภาพ',
    detail: 'มาตรการ GACP ที่ดำเนินการในสถานประกอบการ',
  },
];
