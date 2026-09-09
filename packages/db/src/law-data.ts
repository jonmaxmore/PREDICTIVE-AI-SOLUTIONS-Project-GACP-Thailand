import type {
  CalendarDate,
  CertificateTerm,
  DocumentRequirementRule,
  DocumentSlotDefinition,
  FeeSchedule,
  InspectionChecklistItem,
  PublicHoliday,
} from '@gacp/contracts';
import type {
  CertificateTerm as CertificateTermRow,
  DocumentRequirementRule as DocumentRequirementRuleRow,
  DocumentSlot as DocumentSlotRow,
  FeeSchedule as FeeScheduleRow,
  InspectionChecklistItem as InspectionChecklistItemRow,
  PublicHoliday as PublicHolidayRow,
} from '../generated/prisma/client.ts';
import type { DatabaseClient } from './client.ts';

// แปลงแถวจากฐานข้อมูลเป็นชนิดของ contracts ที่ domain ใช้: list ว่าง = null (ทุกค่า), Date = YYYY-MM-DD

export function toCalendarDate(value: Date): CalendarDate {
  return value.toISOString().slice(0, 10);
}

function toNullableCalendarDate(value: Date | null): CalendarDate | null {
  return value === null ? null : toCalendarDate(value);
}

function emptyToNull<T>(values: readonly T[]): T[] | null {
  return values.length === 0 ? null : [...values];
}

export function toDocumentSlotDefinition(row: DocumentSlotRow): DocumentSlotDefinition {
  return {
    code: row.code,
    group: row.group,
    formStep: row.formStep,
    sortOrder: row.sortOrder,
    labelTh: row.labelTh,
    whatIsItTh: row.whatIsItTh,
    howToObtainTh: row.howToObtainTh,
    acceptedMimeTypes: [...row.acceptedMimeTypes],
    maxFiles: row.maxFiles,
    maxFileBytes: row.maxFileBytes,
    requiresIssuedDate: row.requiresIssuedDate,
    issuedWithinDays: row.issuedWithinDays,
    isLicense: row.isLicense,
    subItemCodes: emptyToNull(row.subItemCodes),
    isSystemGenerated: row.isSystemGenerated,
  };
}

export function toDocumentRequirementRule(
  row: DocumentRequirementRuleRow,
): DocumentRequirementRule {
  return {
    code: row.code,
    plantCode: row.plantCode,
    slotCode: row.slotCode,
    requirementLevel: row.requirementLevel,
    applicantTypes: emptyToNull(row.applicantTypes),
    requestTypes: emptyToNull(row.requestTypes),
    certificationScopes: emptyToNull(row.certificationScopes),
    purposes: emptyToNull(row.purposes),
    areaTypes: emptyToNull(row.areaTypes),
    landTenures: emptyToNull(row.landTenures),
    attorneyInFact: row.attorneyInFact,
    alternativeGroupCode: row.alternativeGroupCode,
    reasonTh: row.reasonTh,
    sourceTh: row.sourceTh,
    effectiveFrom: toCalendarDate(row.effectiveFrom),
    effectiveTo: toNullableCalendarDate(row.effectiveTo),
  };
}

export function toFeeSchedule(row: FeeScheduleRow): FeeSchedule {
  return {
    code: row.code,
    plantCode: row.plantCode,
    feeStage: row.feeStage,
    requestTypes: [...row.requestTypes],
    feeBasis: row.feeBasis,
    lineTitleTh: row.lineTitleTh,
    stateFeeSatang: row.stateFeeSatang,
    serviceFeeSatang: row.serviceFeeSatang,
    vatRateBasisPoints: row.vatRateBasisPoints,
    quotationValidDays: row.quotationValidDays,
    sourceTh: row.sourceTh,
    effectiveFrom: toCalendarDate(row.effectiveFrom),
    effectiveTo: toNullableCalendarDate(row.effectiveTo),
  };
}

export function toInspectionChecklistItem(
  row: InspectionChecklistItemRow,
): InspectionChecklistItem {
  return {
    code: row.code,
    plantCode: row.plantCode,
    category: row.category,
    sortOrder: row.sortOrder,
    textTh: row.textTh,
    guidanceTh: row.guidanceTh,
    isCritical: row.isCritical,
    requiresPhotoEvidence: row.requiresPhotoEvidence,
    sourceTh: row.sourceTh,
    effectiveFrom: toCalendarDate(row.effectiveFrom),
    effectiveTo: toNullableCalendarDate(row.effectiveTo),
  };
}

export function toCertificateTerm(row: CertificateTermRow): CertificateTerm {
  return {
    code: row.code,
    plantCode: row.plantCode,
    certificationScopes: emptyToNull(row.certificationScopes),
    requestTypes: emptyToNull(row.requestTypes),
    validityMonths: row.validityMonths,
    sourceTh: row.sourceTh,
    effectiveFrom: toCalendarDate(row.effectiveFrom),
    effectiveTo: toNullableCalendarDate(row.effectiveTo),
  };
}

export function toPublicHoliday(row: PublicHolidayRow): PublicHoliday {
  return { date: toCalendarDate(row.date), nameTh: row.nameTh };
}

// ชุดกฎของพืชหนึ่งชนิดทั้งหมด (ทุกวันมีผล) ให้ domain เป็นผู้กรองตาม asOf เพื่อให้ snapshot ณ วันยื่นทำซ้ำได้
export async function loadDocumentRequirementRules(
  database: DatabaseClient,
  plantCode: string,
): Promise<DocumentRequirementRule[]> {
  const rows = await database.documentRequirementRule.findMany({
    where: { plantCode },
    orderBy: [{ effectiveFrom: 'asc' }, { code: 'asc' }],
  });
  return rows.map(toDocumentRequirementRule);
}

export async function loadFeeSchedules(
  database: DatabaseClient,
  plantCode: string,
): Promise<FeeSchedule[]> {
  const rows = await database.feeSchedule.findMany({
    where: { plantCode },
    orderBy: [{ effectiveFrom: 'asc' }, { code: 'asc' }],
  });
  return rows.map(toFeeSchedule);
}

export async function loadDocumentSlots(
  database: DatabaseClient,
): Promise<DocumentSlotDefinition[]> {
  const rows = await database.documentSlot.findMany({
    orderBy: [{ formStep: 'asc' }, { sortOrder: 'asc' }],
  });
  return rows.map(toDocumentSlotDefinition);
}

export async function loadPublicHolidays(database: DatabaseClient): Promise<PublicHoliday[]> {
  const rows = await database.publicHoliday.findMany({ orderBy: { date: 'asc' } });
  return rows.map(toPublicHoliday);
}
