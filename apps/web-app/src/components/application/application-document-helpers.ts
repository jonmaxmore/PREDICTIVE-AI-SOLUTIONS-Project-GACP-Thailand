import { THAI_TIME_ZONE } from '@/lib/format/thai-date';
import { PURPOSE_LICENCE_DOCUMENTS, purposeOptionLabelOf } from '@/lib/certification-purposes';
export interface UploadedDocument {
  type?: string;
  id?: string;
  name?: string;
  url?: string;
  uploaded?: boolean;
}

export interface FormDataShape {
  applicantData?: Record<string, string | number | boolean | null | undefined>;
  farmData?: Record<string, unknown>;
  siteData?: Record<string, unknown>;
  productionData?: Record<string, unknown>;
  harvestData?: Record<string, unknown>;
  plots?: Array<Record<string, unknown>>;
  documents?: UploadedDocument[];
  youtubeUrl?: string;
  videoLink?: string;
  plantId?: string;
  plantName?: string;
  certificationPurpose?: string;       // Legacy: old data may have single string
  certificationPurposes?: string[];    // New: array of selected purposes
  cultivationMethod?: string;
  cultivationMethods?: string[];
  serviceType?: string;
  [key: string]: unknown;
}

export interface ApplicationData {
  id: string;
  applicationNumber?: string;
  status: string;
  createdAt: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  formData?: any;
}

export const formatDate = (date: string) => {
  if (!date) return '-';
  return new Date(date).toLocaleDateString('th-TH', {
    timeZone: THAI_TIME_ZONE,
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
};

export const PLANT_NAMES: Record<string, string> = {
  cannabis: 'กัญชา',
  kratom: 'กระท่อม',
  turmeric: 'ขมิ้นชัน',
  ginger: 'ขิง',
  black_galangal: 'กระชายดำ',
  plai: 'ไพล',
};

export const REQUIRED_DOCUMENTS = [
  { key: 'idCardDoc', name: 'สำเนาบัตรประชาชน' },
  { key: 'houseRegDoc', name: 'สำเนาทะเบียนบ้าน' },
  { key: 'criminalBgDoc', name: 'ผลตรวจประวัติอาชญากรรม' },
  { key: 'communityRegDoc', name: 'ทะเบียนวิสาหกิจชุมชน' },
  { key: 'communityMeetingDoc', name: 'รายงานการประชุมวิสาหกิจ' },
  { key: 'companyRegDoc', name: 'หนังสือรับรองบริษัท' },
  { key: 'directorListDoc', name: 'รายชื่อกรรมการ' },
  { key: 'powerOfAttorneyUrl', name: 'หนังสือมอบอำนาจ' },
  ...PURPOSE_LICENCE_DOCUMENTS,
  { key: 'LAND_TITLE', name: 'เอกสารสิทธิ์ที่ดิน' },
  { key: 'SITE_MAP', name: 'แผนที่ตั้งฟาร์ม' },
  { key: 'WATER_TEST', name: 'ผลตรวจคุณภาพน้ำ' },
  { key: 'SOIL_TEST', name: 'ผลตรวจดิน' },
  { key: 'SOP_MANUAL', name: 'คู่มือ SOP' },
  { key: 'GACP_CERTIFICATE', name: 'ใบรับรอง E-learning GACP' },
] as const;

export function getApplicantDisplayName(applicantData: Record<string, unknown>): string {
  const applicantType = typeof applicantData.applicantType === 'string' ? applicantData.applicantType : '';
  const firstName = typeof applicantData.firstName === 'string' ? applicantData.firstName : '';
  const lastName = typeof applicantData.lastName === 'string' ? applicantData.lastName : '';
  const communityName = typeof applicantData.communityName === 'string' ? applicantData.communityName : '';
  const companyName = typeof applicantData.companyName === 'string' ? applicantData.companyName : '';

  if (applicantType === 'INDIVIDUAL') {
    return `${firstName} ${lastName}`.trim() || '-';
  }
  if (applicantType === 'COMMUNITY') {
    return communityName || '-';
  }
  if (applicantType === 'JURISTIC') {
    return companyName || '-';
  }
  return '-';
}

export function isImageFileUrl(url: string): boolean {
  return /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(url);
}

export function isPdfFileUrl(url: string): boolean {
  return /\.pdf$/i.test(url);
}

export function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export function asString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return '';
}

export function withFallback(value: unknown): string {
  const text = asString(value).trim();
  return text || '-';
}

export function joinParts(values: unknown[]): string {
  const parts = values
    .map((value) => withFallback(value))
    .filter((value) => value !== '-');
  return parts.length > 0 ? parts.join(', ') : '-';
}

export function mapApplicantType(type: unknown): string {
  const key = asString(type).toUpperCase();
  if (key === 'INDIVIDUAL') return 'บุคคลธรรมดา';
  if (key === 'COMMUNITY') return 'วิสาหกิจชุมชน';
  if (key === 'JURISTIC') return 'นิติบุคคล';
  return '-';
}

export function mapServiceType(value: unknown): string {
  const key = asString(value).toUpperCase();
  if (key === 'NEW') return 'ขอใหม่';
  if (key === 'RENEWAL') return 'ต่ออายุ';
  return withFallback(value);
}

export function mapPurpose(value: unknown): string {
  const key = asString(value);
  // The one vocabulary (lib/certification-purposes.ts); a word it does not know is shown
  // as stored, so an officer can see what the filing actually carries.
  return purposeOptionLabelOf(key) ?? withFallback(value);
}

export function mapMethod(value: string): string {
  const key = String(value || '').toLowerCase();
  if (key === 'outdoor') return 'กลางแจ้ง';
  if (key === 'indoor') return 'ในร่ม';
  if (key === 'greenhouse') return 'โรงเรือน';
  return value;
}

// Section 4 (production/harvest) enum → Thai labels. Values mirror the wizard
// option constants (quality-control-config.ts + constants/options.ts) so the
// preview shows the same Thai wording the applicant chose, instead of the raw
// enum (MANUAL / HANGING / CONTROLLED / SPRINKLER). 2026-06-25.
const HARVEST_METHOD_TH: Record<string, string> = { MANUAL: 'เก็บด้วยมือ', MACHINE: 'เก็บด้วยเครื่องจักร' };
const DRYING_METHOD_TH: Record<string, string> = {
  HANGING: 'แขวนแห้ง', RACK: 'ตากบนชั้นตากแห้ง', SUN: 'ตากแดด', GREENHOUSE: 'ตากในโรงเรือน',
  OVEN: 'อบด้วยตู้อบ', DEHYDRATOR: 'เครื่องขจัดความชื้น', OTHER: 'อื่น ๆ',
};
const STORAGE_TH: Record<string, string> = { CONTROLLED: 'ห้องควบคุมอุณหภูมิ', AMBIENT: 'อุณหภูมิห้องปกติ', SILO: 'ไซโล/ถังเก็บ' };
const IRRIGATION_TH: Record<string, string> = { DRIP: 'ระบบน้ำหยด', SPRINKLER: 'สปริงเกลอร์', MANUAL: 'รดน้ำด้วยมือ', FLOOD: 'ท่วมขัง' };
const PLANT_PARTS_TH: Record<string, string> = {
  FLOWER: 'ช่อดอก', LEAF: 'ใบ', SEED: 'เมล็ด', STEM: 'ลำต้น', ROOT: 'ราก', CUTTING: 'กิ่งปักชำ', OTHER: 'อื่น ๆ',
};

function resolveEnumLabel(value: unknown, map: Record<string, string>): string {
  const key = String(value ?? '').trim();
  if (!key) return '';
  return map[key] || map[key.toUpperCase()] || map[key.toLowerCase()] || key;
}

export function mapHarvestMethod(value: unknown): string { return withFallback(resolveEnumLabel(value, HARVEST_METHOD_TH)); }
export function mapDryingMethod(value: unknown): string { return withFallback(resolveEnumLabel(value, DRYING_METHOD_TH)); }
export function mapStorageSystem(value: unknown): string { return withFallback(resolveEnumLabel(value, STORAGE_TH)); }
export function mapIrrigation(value: unknown): string { return withFallback(resolveEnumLabel(value, IRRIGATION_TH)); }

/** Map an array (or single value) of plant-part codes to a Thai comma list. */
export function mapPlantParts(value: unknown): string {
  const list = Array.isArray(value) ? value : (value ? [value] : []);
  const labels = list.map((item) => resolveEnumLabel(item, PLANT_PARTS_TH)).filter(Boolean);
  return labels.length ? labels.join(', ') : '-';
}

// ── Section 3+4 expansion (2026-06-25): show every field the wizard collects.
// All maps mirror the wizard option constants (constants/options.ts +
// quality-control-config.ts) so the preview reflects the applicant's choices.
const WATER_SOURCE_TH: Record<string, string> = {
  BOREWELL: 'บ่อบาดาล', TAP_WATER: 'น้ำประปา', RAIN: 'น้ำฝน', RIVER: 'แม่น้ำ/ลำธาร',
  POND: 'สระน้ำ', CANAL: 'คลองชลประทาน', OTHER: 'อื่น ๆ',
};
const FILTRATION_TH: Record<string, string> = {
  AGRICULTURAL_FILTER: 'กรองเกษตร', RO: 'RO', UV: 'UV', SEDIMENT: 'กรองตะกอน',
  CARBON: 'กรองคาร์บอน', NONE: 'ไม่มีการกรอง',
};
const LAND_OWNERSHIP_TH: Record<string, string> = { OWN: 'เจ้าของที่ดิน', RENT: 'เช่าที่ดิน', CONSENT: 'ได้รับอนุญาตให้ใช้' };
const LAND_DOCUMENT_TH: Record<string, string> = { CHANOTE: 'โฉนดที่ดิน', NS3: 'น.ส.3', SPK: 'ส.ป.ก.', OTHER: 'อื่น ๆ' };
const PROPAGATION_TH: Record<string, string> = {
  SEED: 'เมล็ด', CUTTING: 'กิ่งปักชำ', TISSUE: 'เพาะเนื้อเยื่อ', SEEDLING: 'กล้าพันธุ์', OTHER: 'อื่น ๆ',
};
const PLANTING_MATERIAL_TH: Record<string, string> = {
  SOIL: 'ดิน', COCO_PEAT: 'กาบมะพร้าว', PERLITE: 'เพอร์ไลท์', ROCKWOOL: 'ร็อควูล',
  HYDROPONIC: 'ไฮโดรโปนิกส์', AEROPONIC: 'แอโรโปนิกส์', MIX: 'ดินผสม/อื่น ๆ',
};
const SOIL_TYPE_TH: Record<string, string> = {
  LOAM: 'ดินร่วน', SANDY_LOAM: 'ดินร่วนปนทราย', CLAY_LOAM: 'ดินร่วนเหนียว', SANDY: 'ดินทราย',
  CLAY: 'ดินเหนียว', PEAT: 'ดินพีท', OTHER: 'อื่น ๆ/ไม่ใช้ดิน',
};
const STRAIN_TH: Record<string, string> = { SATIVA: 'Sativa', INDICA: 'Indica', HYBRID: 'ลูกผสม', LOCAL: 'พันธุ์ท้องถิ่น', UNKNOWN: 'ไม่ทราบ' };
const SEED_SOURCE_TYPE_TH: Record<string, string> = {
  SELF: 'ปลูกเอง', BUY: 'ซื้อ', IMPORT: 'นำเข้า', SEED: 'เมล็ด', CUTTING: 'กิ่งปักชำ',
};
const MATURITY_TH: Record<string, string> = { EARLY: 'ระยะต้น', PEAK: 'ระยะเต็มที่', LATE: 'ระยะปลาย' };
const TRIM_TH: Record<string, string> = { WET: 'ตัดแต่งสด', DRY: 'ตัดแต่งแห้ง' };
const AIRFLOW_TH: Record<string, string> = { NATURAL: 'ลมธรรมชาติ', FAN_INDIRECT: 'พัดลม (ไม่ส่งตรง)', HVAC: 'ระบบปรับอากาศ (HVAC)' };
const CURING_CONTAINER_TH: Record<string, string> = {
  GLASS_JAR: 'โหลแก้ว', VACUUM_BAG: 'ถุงสุญญากาศ', NITROGEN_BAG: 'ถุงบรรจุไนโตรเจน',
  HUMIDITY_CONTROLLED: 'ภาชนะควบคุมความชื้น', OTHER: 'อื่น ๆ',
};
const BURP_TH: Record<string, string> = { TWICE_DAILY: 'วันละ 2 ครั้ง', DAILY: 'วันละ 1 ครั้ง', WEEKLY: 'สัปดาห์ละ 1 ครั้ง' };
const PACKAGING_TH: Record<string, string> = {
  VACUUM: 'บรรจุสุญญากาศ', FOOD_GRADE: 'ถุง/ซองฟู้ดเกรด', FOIL: 'ถุงฟอยล์/อะลูมิเนียม',
  AIR_TIGHT: 'ภาชนะปิดสนิท', OTHER: 'อื่น ๆ',
};
const INPUT_TYPE_TH: Record<string, string> = {
  FERTILIZER: 'ปุ๋ย', SOIL_AMENDMENT: 'วัสดุปรับปรุงดิน', PLANT_PROTECTION: 'สารป้องกันกำจัดศัตรูพืช', OTHER: 'อื่น ๆ',
};
const IPM_METHOD_TH: Record<string, string> = { BIOLOGICAL: 'ชีวภาพ', MECHANICAL: 'กล/กายภาพ', CULTURAL: 'เขตกรรม', CHEMICAL: 'เคมี' };
const QC_CHECK_TH: Record<string, string> = {
  hasSOPs: 'มี SOP', hasQualityLog: 'มีบันทึกคุณภาพ', hasContaminationPrevention: 'ป้องกันการปนเปื้อน',
  hasPestManagement: 'แผนจัดการศัตรูพืช (IPM)', hasWasteManagement: 'จัดการของเสีย', hasTraceability: 'ตามสอบย้อนกลับ',
};

/** Join an array (or single value) of codes to a Thai comma list using `map`. */
function mapList(value: unknown, map: Record<string, string>): string {
  const list = Array.isArray(value) ? value : (value === undefined || value === null || value === '' ? [] : [value]);
  const labels = list.map((item) => resolveEnumLabel(item, map)).filter(Boolean);
  return labels.length ? labels.join(', ') : '-';
}

export function mapWaterSource(value: unknown): string { return withFallback(resolveEnumLabel(value, WATER_SOURCE_TH)); }
export function mapFiltration(value: unknown): string { return mapList(value, FILTRATION_TH); }
export function mapLandOwnership(value: unknown): string { return withFallback(resolveEnumLabel(value, LAND_OWNERSHIP_TH)); }
export function mapLandDocument(value: unknown): string { return withFallback(resolveEnumLabel(value, LAND_DOCUMENT_TH)); }
export function mapPropagation(value: unknown): string { return mapList(value, PROPAGATION_TH); }
export function mapPlantingMaterial(value: unknown): string { return withFallback(resolveEnumLabel(value, PLANTING_MATERIAL_TH)); }
export function mapSoilType(value: unknown): string { return withFallback(resolveEnumLabel(value, SOIL_TYPE_TH)); }
export function mapStrain(value: unknown): string { return withFallback(resolveEnumLabel(value, STRAIN_TH)); }
export function mapSeedSourceType(value: unknown): string { return withFallback(resolveEnumLabel(value, SEED_SOURCE_TYPE_TH)); }
export function mapMaturity(value: unknown): string { return withFallback(resolveEnumLabel(value, MATURITY_TH)); }
export function mapTrim(value: unknown): string { return withFallback(resolveEnumLabel(value, TRIM_TH)); }
export function mapAirflow(value: unknown): string { return withFallback(resolveEnumLabel(value, AIRFLOW_TH)); }
export function mapCuringContainer(value: unknown): string { return withFallback(resolveEnumLabel(value, CURING_CONTAINER_TH)); }
export function mapBurp(value: unknown): string { return withFallback(resolveEnumLabel(value, BURP_TH)); }
export function mapPackaging(value: unknown): string { return withFallback(resolveEnumLabel(value, PACKAGING_TH)); }
export function mapInputType(value: unknown): string { return withFallback(resolveEnumLabel(value, INPUT_TYPE_TH)); }
export function mapIpmMethods(value: unknown): string { return mapList(value, IPM_METHOD_TH); }

/** Boolean → มี / ไม่มี (undefined → "-"). */
export function mapHasFlag(value: unknown): string {
  if (value === true) return 'มี';
  if (value === false) return 'ไม่มี';
  return '-';
}

/**
 * Quality-control checks. The wizard stores either qualityControlLabels[]
 * (human-readable) or qualityControlChecks (string[] of codes, or a
 * Record<code, boolean>). Prefer the labels; otherwise map the selected codes.
 */
export function mapQualityControl(labels: unknown, checks: unknown): string {
  if (Array.isArray(labels) && labels.length) {
    return labels.map((item) => asString(item)).filter(Boolean).join(', ') || '-';
  }
  if (Array.isArray(checks)) {
    return mapList(checks, QC_CHECK_TH);
  }
  if (checks && typeof checks === 'object') {
    const selected = Object.entries(checks as Record<string, unknown>)
      .filter(([, v]) => v === true)
      .map(([k]) => resolveEnumLabel(k, QC_CHECK_TH))
      .filter(Boolean);
    return selected.length ? selected.join(', ') : '-';
  }
  return '-';
}
