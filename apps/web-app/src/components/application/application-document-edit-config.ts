/**
 * Reviewer in-place edit config for ApplicationDocumentView (V1).
 *
 * Declares EVERY scalar/enum leaf field a DOCUMENT_REVIEWER may correct in the
 * provider "เอกสารคำขอ (เต็ม)" view, mapped to its formData section + dot-path +
 * control type. Enum option lists are REUSED from the wizard's single source of
 * truth (constants/options.ts + quality-control-config.ts) so the editable
 * <select> values never drift from what the applicant chose.
 *
 * V1 explicitly does NOT include array/table fields (seedSources,
 * productionInputs, plantParts, filtrationTypes, ipmMethods, …) or §2/§5/§6/§9 —
 * those stay read-only. The backend strips any array values defensively too.
 */

import {
  WATER_SOURCE_OPTIONS,
  IRRIGATION_OPTIONS,
  LAND_OWNERSHIP_OPTIONS,
  PLANTING_MATERIAL_OPTIONS,
  SOIL_TYPE_OPTIONS,
  type SelectOption,
} from '@/constants/options';
import {
  HARVEST_METHOD_OPTIONS,
  HARVEST_MATURITY_OPTIONS,
  TRIM_METHOD_OPTIONS,
  DRYING_METHOD_OPTIONS,
  DRYING_AIRFLOW_OPTIONS,
  STORAGE_OPTIONS,
  CURING_CONTAINER_OPTIONS,
  CURING_BURP_OPTIONS,
  PACKAGING_OPTIONS,
} from '@/app/health/applications/new/_steps/steps/quality-control-config';
import { asRecord } from '@/components/application/application-document-helpers';

export type EditableSection = 'applicantData' | 'farmData' | 'productionData' | 'harvestData';
export type EditableFieldType = 'text' | 'number' | 'select' | 'boolean';

export interface EditableField {
  /** formData sub-object this leaf lives under. */
  section: EditableSection;
  /** dot-path within the section (supports one level of nesting). */
  path: string;
  label: string;
  type: EditableFieldType;
  /** Required for `type: 'select'`. */
  options?: SelectOption[];
}

/** A `{ value, label }` list narrowed from the wizard option constants. */
function toSelectOptions(items: ReadonlyArray<{ value: string; label: string }>): SelectOption[] {
  return items.map((item) => ({ value: item.value, label: item.label }));
}

/**
 * Deep-clone a plain-JSON record. formData is always JSON-serialisable, so this
 * is sufficient and avoids depending on the runtime's `structuredClone` (absent
 * in the jest test env and older runtimes).
 */
function cloneRecord(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

// Draft mirrors the editable sections of formData (deep-copied on enter-edit).
export type EditDraft = Record<EditableSection, Record<string, unknown>>;

/**
 * The editable-field manifest. Order = render order within each section. Mapped
 * to the same formData paths the read-only view reads, so a saved edit shows up
 * immediately on the next render.
 */
export const EDITABLE_FIELD_CONFIG: EditableField[] = [
  // §1 ผู้ยื่นคำขอ (applicantData) — scalars only.
  { section: 'applicantData', path: 'phone', label: 'โทรศัพท์', type: 'text' },
  { section: 'applicantData', path: 'email', label: 'อีเมล', type: 'text' },
  { section: 'applicantData', path: 'lineId', label: 'Line ID', type: 'text' },
  { section: 'applicantData', path: 'idCard', label: 'เลขบัตรประชาชน', type: 'text' },
  { section: 'applicantData', path: 'taxId', label: 'เลขประจำตัวผู้เสียภาษี', type: 'text' },
  { section: 'applicantData', path: 'registrationNumber', label: 'เลขทะเบียนนิติบุคคล', type: 'text' },
  { section: 'applicantData', path: 'address', label: 'ที่อยู่ผู้ยื่น', type: 'text' },

  // §3 สถานประกอบการและแปลงปลูก (farmData).
  { section: 'farmData', path: 'farmName', label: 'ชื่อฟาร์ม/สถานที่', type: 'text' },
  { section: 'farmData', path: 'address', label: 'ที่อยู่ฟาร์ม', type: 'text' },
  { section: 'farmData', path: 'province', label: 'จังหวัด', type: 'text' },
  { section: 'farmData', path: 'district', label: 'อำเภอ', type: 'text' },
  { section: 'farmData', path: 'subdistrict', label: 'ตำบล', type: 'text' },
  { section: 'farmData', path: 'postalCode', label: 'รหัสไปรษณีย์', type: 'text' },
  { section: 'farmData', path: 'totalAreaSize', label: 'พื้นที่รวม', type: 'number' },
  { section: 'farmData', path: 'gpsLat', label: 'พิกัด GPS (Lat)', type: 'text' },
  { section: 'farmData', path: 'gpsLng', label: 'พิกัด GPS (Lng)', type: 'text' },
  { section: 'farmData', path: 'landOwnership', label: 'การถือครองที่ดิน', type: 'select', options: LAND_OWNERSHIP_OPTIONS },
  { section: 'farmData', path: 'waterSourceDetail.sourceType', label: 'แหล่งน้ำ', type: 'select', options: WATER_SOURCE_OPTIONS },
  { section: 'farmData', path: 'waterSourceDetail.irrigationType', label: 'ระบบให้น้ำ', type: 'select', options: IRRIGATION_OPTIONS },
  { section: 'farmData', path: 'soilType', label: 'ชนิดดิน', type: 'select', options: SOIL_TYPE_OPTIONS },
  { section: 'farmData', path: 'soilPH', label: 'ค่า pH ดิน', type: 'text' },
  { section: 'farmData', path: 'soilHistory', label: 'ประวัติการใช้ที่ดิน', type: 'text' },
  { section: 'farmData', path: 'hasFence', label: 'รั้วปิดล้อม', type: 'boolean' },
  { section: 'farmData', path: 'hasCCTV', label: 'กล้องวงจรปิด (CCTV)', type: 'boolean' },
  { section: 'farmData', path: 'hasAccessControl', label: 'ควบคุมการเข้าออก', type: 'boolean' },
  { section: 'farmData', path: 'hasWarningSign', label: 'ป้ายเตือน', type: 'boolean' },

  // §4 การผลิต (productionData).
  { section: 'productionData', path: 'plantingMaterial', label: 'วัสดุปลูก', type: 'select', options: PLANTING_MATERIAL_OPTIONS },
  { section: 'productionData', path: 'plantSpacing', label: 'ระยะปลูก', type: 'text' },
  { section: 'productionData', path: 'treeCount', label: 'จำนวนต้น', type: 'number' },
  { section: 'productionData', path: 'harvestCycles', label: 'รอบเก็บเกี่ยว/ปี', type: 'number' },
  { section: 'productionData', path: 'estimatedYield', label: 'ผลผลิตคาดการณ์ (กก./ปี)', type: 'text' },
  { section: 'productionData', path: 'intendedUse', label: 'วัตถุประสงค์ผลผลิต', type: 'text' },
  { section: 'productionData', path: 'hasIpmPlan', label: 'แผนจัดการศัตรูพืช (IPM)', type: 'boolean' },
  { section: 'productionData', path: 'ipmNote', label: 'หมายเหตุ IPM', type: 'text' },
  { section: 'productionData', path: 'hasGAPCert', label: 'ใบรับรอง GAP', type: 'boolean' },
  { section: 'productionData', path: 'hasOrganicCert', label: 'ใบรับรองอินทรีย์', type: 'boolean' },

  // §7 การเก็บเกี่ยวและหลังการเก็บเกี่ยว (harvestData).
  { section: 'harvestData', path: 'harvestMethod', label: 'วิธีเก็บเกี่ยว', type: 'select', options: toSelectOptions(HARVEST_METHOD_OPTIONS) },
  { section: 'harvestData', path: 'harvestMaturity', label: 'ระยะความสุก', type: 'select', options: toSelectOptions(HARVEST_MATURITY_OPTIONS) },
  { section: 'harvestData', path: 'trimMethod', label: 'วิธีตัดแต่ง', type: 'select', options: toSelectOptions(TRIM_METHOD_OPTIONS) },
  { section: 'harvestData', path: 'dryingMethod', label: 'วิธีทำแห้ง', type: 'select', options: toSelectOptions(DRYING_METHOD_OPTIONS) },
  { section: 'harvestData', path: 'dryingDays', label: 'ระยะเวลาตาก', type: 'text' },
  { section: 'harvestData', path: 'dryingTemperature', label: 'อุณหภูมิตาก', type: 'text' },
  { section: 'harvestData', path: 'dryingHumidity', label: 'ความชื้นตาก', type: 'text' },
  { section: 'harvestData', path: 'dryingAirflow', label: 'การไหลของอากาศ', type: 'select', options: toSelectOptions(DRYING_AIRFLOW_OPTIONS) },
  { section: 'harvestData', path: 'hasCuringProcess', label: 'มีการบ่ม (Curing)', type: 'boolean' },
  { section: 'harvestData', path: 'curingDuration', label: 'ระยะเวลาบ่ม', type: 'text' },
  { section: 'harvestData', path: 'curingTemperature', label: 'อุณหภูมิบ่ม', type: 'text' },
  { section: 'harvestData', path: 'curingHumidity', label: 'ความชื้นบ่ม', type: 'text' },
  { section: 'harvestData', path: 'curingContainerType', label: 'ภาชนะบ่ม', type: 'select', options: toSelectOptions(CURING_CONTAINER_OPTIONS) },
  { section: 'harvestData', path: 'curingBurpFrequency', label: 'ความถี่เปิดภาชนะ', type: 'select', options: toSelectOptions(CURING_BURP_OPTIONS) },
  { section: 'harvestData', path: 'storageSystem', label: 'ระบบจัดเก็บ', type: 'select', options: toSelectOptions(STORAGE_OPTIONS) },
  { section: 'harvestData', path: 'temperatureControl', label: 'ควบคุมอุณหภูมิจัดเก็บ', type: 'text' },
  { section: 'harvestData', path: 'storageHumidity', label: 'ความชื้นในที่จัดเก็บ', type: 'text' },
  { section: 'harvestData', path: 'packaging', label: 'บรรจุภัณฑ์', type: 'select', options: toSelectOptions(PACKAGING_OPTIONS) },
];

const SECTIONS: EditableSection[] = ['applicantData', 'farmData', 'productionData', 'harvestData'];

/** Read a dot-path value out of a section record (one level of nesting). */
function readPath(sectionRecord: Record<string, unknown>, path: string): unknown {
  const segments = path.split('.');
  let cursor: unknown = sectionRecord;
  for (const segment of segments) {
    if (cursor === null || typeof cursor !== 'object') {
      return undefined;
    }
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

/** Immutably write a dot-path value into a section record (one level nesting). */
function writePath(
  sectionRecord: Record<string, unknown>,
  path: string,
  value: unknown,
): Record<string, unknown> {
  const segments = path.split('.');
  if (segments.length === 1) {
    const [key] = segments;
    if (key === undefined) {
      return sectionRecord;
    }
    return { ...sectionRecord, [key]: value };
  }
  const [head, ...rest] = segments;
  if (head === undefined) {
    return sectionRecord;
  }
  const nested = asRecord(sectionRecord[head]);
  return { ...sectionRecord, [head]: writePath(nested, rest.join('.'), value) };
}

/**
 * Deep-copy the editable sections out of formData into a draft. Only the four
 * editable sections are copied; the rest of formData is untouched on save (the
 * backend deep-merges).
 */
export function buildDraftFromFormData(formData: unknown): EditDraft {
  const root = asRecord(formData);
  const draft = {} as EditDraft;
  for (const section of SECTIONS) {
    // Deep-clone keeps nested objects (waterSourceDetail) independent so
    // editing the draft never mutates the live application prop.
    draft[section] = cloneRecord(asRecord(root[section]));
  }
  return draft;
}

export function getDraftValue(draft: EditDraft, section: EditableSection, path: string): unknown {
  return readPath(draft[section] || {}, path);
}

export function setDraftValue(
  draft: EditDraft,
  section: EditableSection,
  path: string,
  value: unknown,
): EditDraft {
  return {
    ...draft,
    [section]: writePath(draft[section] || {}, path, value),
  };
}

/**
 * Build the minimal `changes` patch to PATCH to the backend: only the
 * configured scalar/enum leaves, grouped per section. The backend re-validates
 * (strips arrays) but we already keep the payload tight here. Sections with no
 * editable keys are omitted.
 */
export function buildChangesPatch(draft: EditDraft): Partial<Record<EditableSection, Record<string, unknown>>> {
  const patch: Partial<Record<EditableSection, Record<string, unknown>>> = {};
  for (const field of EDITABLE_FIELD_CONFIG) {
    const value = readPath(draft[field.section] || {}, field.path);
    if (value === undefined) {
      continue;
    }
    const segments = field.path.split('.');
    const section = (patch[field.section] ||= {});
    if (segments.length === 1) {
      const [key] = segments;
      if (key !== undefined) {
        section[key] = value;
      }
    } else {
      const [head, leaf] = segments;
      if (head !== undefined && leaf !== undefined) {
        const nested = asRecord(section[head]);
        section[head] = { ...nested, [leaf]: value };
      }
    }
  }
  return patch;
}
