import {
  type CertificateTerm,
  certificateTermSchema,
  type DocumentRequirementRule,
  type DocumentSlotDefinition,
  documentRequirementRuleSchema,
  documentSlotDefinitionSchema,
  type FeeSchedule,
  feeScheduleSchema,
  type InspectionChecklistItem,
  inspectionChecklistItemSchema,
  type PublicHoliday,
  publicHolidaySchema,
} from '@gacp/contracts';
import {
  certificateTermSeeds,
  documentRequirementRuleSeeds,
  documentSlotSeeds,
  feeScheduleSeeds,
  inspectionChecklistItemSeeds,
  type PlantSeed,
  plantSeeds,
  publicHolidaySeeds,
} from '../seeds/index.ts';
import type { DatabaseClient } from './client.ts';

// โหลด "กฎเป็นข้อมูล" เข้าฐานข้อมูล: ตรวจกับ zod ก่อน แล้ว upsert ตาม code ทำซ้ำได้ ไม่ลบแถวเดิม
// การเปลี่ยนกฎทำในไฟล์ seed ด้วยการปิด effectiveTo แถวเดิมและเพิ่มแถวใหม่ (append-only)

export type LawDataSet = {
  readonly plants: readonly PlantSeed[];
  readonly documentSlots: readonly DocumentSlotDefinition[];
  readonly documentRequirementRules: readonly DocumentRequirementRule[];
  readonly feeSchedules: readonly FeeSchedule[];
  readonly inspectionChecklistItems: readonly InspectionChecklistItem[];
  readonly certificateTerms: readonly CertificateTerm[];
  readonly publicHolidays: readonly PublicHoliday[];
};

export type LawDataCounts = { readonly [K in keyof LawDataSet]: number };

export const lawDataSeeds: LawDataSet = {
  plants: plantSeeds,
  documentSlots: documentSlotSeeds,
  documentRequirementRules: documentRequirementRuleSeeds,
  feeSchedules: feeScheduleSeeds,
  inspectionChecklistItems: inspectionChecklistItemSeeds,
  certificateTerms: certificateTermSeeds,
  publicHolidays: publicHolidaySeeds,
};

export function toCalendarDateValue(calendarDate: string): Date {
  return new Date(`${calendarDate}T00:00:00.000Z`);
}

function toNullableDateValue(calendarDate: string | null): Date | null {
  return calendarDate === null ? null : toCalendarDateValue(calendarDate);
}

function validateAll<T>(
  label: string,
  schema: { parse(value: unknown): T },
  rows: readonly T[],
): T[] {
  return rows.map((row, index) => {
    try {
      return schema.parse(row);
    } catch (error) {
      throw new Error(`${label}[${index}] ไม่ผ่าน schema: ${(error as Error).message}`);
    }
  });
}

function assertUniqueCodes(label: string, codes: readonly string[]): void {
  const seen = new Set<string>();
  for (const code of codes) {
    if (seen.has(code)) throw new Error(`${label} มี code ซ้ำ: ${code}`);
    seen.add(code);
  }
}

// ตรวจความสอดคล้องของชุดข้อมูลก่อนแตะฐานข้อมูล (ใช้ทั้งใน seed script และ test)
export function validateLawData(data: LawDataSet): LawDataSet {
  const validated: LawDataSet = {
    plants: data.plants,
    documentSlots: validateAll('documentSlots', documentSlotDefinitionSchema, data.documentSlots),
    documentRequirementRules: validateAll(
      'documentRequirementRules',
      documentRequirementRuleSchema,
      data.documentRequirementRules,
    ),
    feeSchedules: validateAll('feeSchedules', feeScheduleSchema, data.feeSchedules),
    inspectionChecklistItems: validateAll(
      'inspectionChecklistItems',
      inspectionChecklistItemSchema,
      data.inspectionChecklistItems,
    ),
    certificateTerms: validateAll('certificateTerms', certificateTermSchema, data.certificateTerms),
    publicHolidays: validateAll('publicHolidays', publicHolidaySchema, data.publicHolidays),
  };
  assertUniqueCodes(
    'plants',
    validated.plants.map((plant) => plant.code),
  );
  assertUniqueCodes(
    'documentSlots',
    validated.documentSlots.map((slot) => slot.code),
  );
  assertUniqueCodes(
    'documentRequirementRules',
    validated.documentRequirementRules.map((rule) => rule.code),
  );
  assertUniqueCodes(
    'feeSchedules',
    validated.feeSchedules.map((fee) => fee.code),
  );
  assertUniqueCodes(
    'inspectionChecklistItems',
    validated.inspectionChecklistItems.map((item) => item.code),
  );
  assertUniqueCodes(
    'certificateTerms',
    validated.certificateTerms.map((term) => term.code),
  );
  assertUniqueCodes(
    'publicHolidays',
    validated.publicHolidays.map((holiday) => holiday.date),
  );

  const plantCodes = new Set(validated.plants.map((plant) => plant.code));
  const slotCodes = new Set(validated.documentSlots.map((slot) => slot.code));
  for (const rule of validated.documentRequirementRules) {
    if (!plantCodes.has(rule.plantCode))
      throw new Error(`${rule.code} อ้างพืชที่ไม่มีใน seed: ${rule.plantCode}`);
    if (!slotCodes.has(rule.slotCode))
      throw new Error(`${rule.code} อ้างช่องที่ไม่มีใน seed: ${rule.slotCode}`);
  }
  for (const fee of validated.feeSchedules) {
    if (!plantCodes.has(fee.plantCode))
      throw new Error(`${fee.code} อ้างพืชที่ไม่มีใน seed: ${fee.plantCode}`);
  }
  return validated;
}

export async function seedLawData(
  database: DatabaseClient,
  data: LawDataSet = lawDataSeeds,
): Promise<LawDataCounts> {
  const validated = validateLawData(data);
  await database.$transaction(async (transaction) => {
    for (const plant of validated.plants) {
      await transaction.plant.upsert({
        where: { code: plant.code },
        create: plant,
        update: {
          nameTh: plant.nameTh,
          scientificName: plant.scientificName,
          isActive: plant.isActive,
        },
      });
    }
    for (const slot of validated.documentSlots) {
      const { code, ...fields } = slot;
      const row = { ...fields, subItemCodes: fields.subItemCodes ?? [] };
      await transaction.documentSlot.upsert({
        where: { code },
        create: { code, ...row },
        update: row,
      });
    }
    for (const rule of validated.documentRequirementRules) {
      const { code, ...fields } = rule;
      const row = {
        ...fields,
        applicantTypes: fields.applicantTypes ?? [],
        requestTypes: fields.requestTypes ?? [],
        certificationScopes: fields.certificationScopes ?? [],
        purposes: fields.purposes ?? [],
        areaTypes: fields.areaTypes ?? [],
        landTenures: fields.landTenures ?? [],
        effectiveFrom: toCalendarDateValue(fields.effectiveFrom),
        effectiveTo: toNullableDateValue(fields.effectiveTo),
      };
      await transaction.documentRequirementRule.upsert({
        where: { code },
        create: { code, ...row },
        update: row,
      });
    }
    for (const fee of validated.feeSchedules) {
      const { code, ...fields } = fee;
      const row = {
        ...fields,
        effectiveFrom: toCalendarDateValue(fields.effectiveFrom),
        effectiveTo: toNullableDateValue(fields.effectiveTo),
      };
      await transaction.feeSchedule.upsert({
        where: { code },
        create: { code, ...row },
        update: row,
      });
    }
    for (const item of validated.inspectionChecklistItems) {
      const { code, ...fields } = item;
      const row = {
        ...fields,
        effectiveFrom: toCalendarDateValue(fields.effectiveFrom),
        effectiveTo: toNullableDateValue(fields.effectiveTo),
      };
      await transaction.inspectionChecklistItem.upsert({
        where: { code },
        create: { code, ...row },
        update: row,
      });
    }
    for (const term of validated.certificateTerms) {
      const { code, ...fields } = term;
      const row = {
        ...fields,
        certificationScopes: fields.certificationScopes ?? [],
        requestTypes: fields.requestTypes ?? [],
        effectiveFrom: toCalendarDateValue(fields.effectiveFrom),
        effectiveTo: toNullableDateValue(fields.effectiveTo),
      };
      await transaction.certificateTerm.upsert({
        where: { code },
        create: { code, ...row },
        update: row,
      });
    }
    for (const holiday of validated.publicHolidays) {
      const date = toCalendarDateValue(holiday.date);
      await transaction.publicHoliday.upsert({
        where: { date },
        create: { date, nameTh: holiday.nameTh },
        update: { nameTh: holiday.nameTh },
      });
    }
  });
  return {
    plants: validated.plants.length,
    documentSlots: validated.documentSlots.length,
    documentRequirementRules: validated.documentRequirementRules.length,
    feeSchedules: validated.feeSchedules.length,
    inspectionChecklistItems: validated.inspectionChecklistItems.length,
    certificateTerms: validated.certificateTerms.length,
    publicHolidays: validated.publicHolidays.length,
  };
}
