import type {
  ApplicantType,
  AreaType,
  CalendarDate,
  CertificationScope,
  DocumentRequirementRule,
  DocumentSlotCode,
  LandTenure,
  Purpose,
  RequestType,
} from '@gacp/contracts';
import { RequirementLevel } from '@gacp/contracts';
import { compareCalendarDates } from './business-days.ts';

// lens เดียวของ "เอกสารอะไรบังคับ" ทุกหน้าจอ (ฟอร์ม ขั้นที่ 6 หน้าผู้ตรวจ ด่านรับคำขอ) เรียกฟังก์ชันนี้กับกฎชุดเดียวกัน

export type RequirementContext = {
  readonly plantCode: string;
  readonly applicantType: ApplicantType;
  readonly requestType: RequestType;
  readonly certificationScope: CertificationScope;
  readonly purposes: readonly Purpose[];
  readonly areaTypes: readonly AreaType[];
  readonly landTenure: LandTenure | null;
  readonly isAttorneyInFact: boolean;
  readonly asOf: CalendarDate;
};

export type ResolvedRequirement = {
  readonly slotCode: DocumentSlotCode;
  readonly requirementLevel: RequirementLevel;
  readonly reasonsTh: readonly string[];
  readonly ruleCodes: readonly string[];
  readonly alternativeGroupCode: string | null;
};

export const RequirementResolutionErrorCode = {
  NO_ACTIVE_RULES: 'NO_ACTIVE_RULES',
} as const;
export type RequirementResolutionErrorCode =
  (typeof RequirementResolutionErrorCode)[keyof typeof RequirementResolutionErrorCode];

export type RequirementResolution =
  | { readonly ok: true; readonly requirements: readonly ResolvedRequirement[] }
  | { readonly ok: false; readonly code: RequirementResolutionErrorCode };

type DatedRule = Pick<DocumentRequirementRule, 'effectiveFrom' | 'effectiveTo'>;

// มีผลเมื่อ effectiveFrom <= asOf และ (ไม่มี effectiveTo หรือ asOf < effectiveTo)
export function isRuleActiveOn(rule: DatedRule, asOf: CalendarDate): boolean {
  if (compareCalendarDates(rule.effectiveFrom, asOf) > 0) return false;
  if (rule.effectiveTo !== null && compareCalendarDates(asOf, rule.effectiveTo) >= 0) return false;
  return true;
}

function matchesSingle<T>(allowed: readonly T[] | null, value: T | null): boolean {
  if (allowed === null) return true;
  if (value === null) return false;
  return allowed.includes(value);
}

function matchesAny<T>(allowed: readonly T[] | null, values: readonly T[]): boolean {
  if (allowed === null) return true;
  return values.some((value) => allowed.includes(value));
}

export function ruleMatches(rule: DocumentRequirementRule, context: RequirementContext): boolean {
  if (rule.plantCode !== context.plantCode) return false;
  if (!isRuleActiveOn(rule, context.asOf)) return false;
  if (!matchesSingle(rule.applicantTypes, context.applicantType)) return false;
  if (!matchesSingle(rule.requestTypes, context.requestType)) return false;
  if (!matchesSingle(rule.certificationScopes, context.certificationScope)) return false;
  if (!matchesAny(rule.purposes, context.purposes)) return false;
  if (!matchesAny(rule.areaTypes, context.areaTypes)) return false;
  if (!matchesSingle(rule.landTenures, context.landTenure)) return false;
  if (rule.attorneyInFact !== null && rule.attorneyInFact !== context.isAttorneyInFact)
    return false;
  return true;
}

// รวมกฎที่ตรงกันเป็นรายการต่อช่อง: บังคับชนะไม่บังคับ เหตุผลรวมทุกกฎ ไม่มีชุดกฎที่มีผล = ตัดสินไม่ได้ (ไม่ผ่อนปรน)
export function resolveDocumentRequirements(
  context: RequirementContext,
  rules: readonly DocumentRequirementRule[],
): RequirementResolution {
  const activeForPlant = rules.filter(
    (rule) => rule.plantCode === context.plantCode && isRuleActiveOn(rule, context.asOf),
  );
  if (activeForPlant.length === 0) {
    return { ok: false, code: RequirementResolutionErrorCode.NO_ACTIVE_RULES };
  }

  const bySlot = new Map<
    DocumentSlotCode,
    {
      requirementLevel: RequirementLevel;
      reasonsTh: string[];
      ruleCodes: string[];
      alternativeGroupCode: string | null;
    }
  >();
  for (const rule of activeForPlant) {
    if (!ruleMatches(rule, context)) continue;
    const existing = bySlot.get(rule.slotCode);
    if (!existing) {
      bySlot.set(rule.slotCode, {
        requirementLevel: rule.requirementLevel,
        reasonsTh: [rule.reasonTh],
        ruleCodes: [rule.code],
        alternativeGroupCode: rule.alternativeGroupCode,
      });
      continue;
    }
    if (rule.requirementLevel === RequirementLevel.REQUIRED) {
      existing.requirementLevel = RequirementLevel.REQUIRED;
      existing.alternativeGroupCode ??= rule.alternativeGroupCode;
    }
    if (!existing.reasonsTh.includes(rule.reasonTh)) existing.reasonsTh.push(rule.reasonTh);
    existing.ruleCodes.push(rule.code);
  }

  const requirements = [...bySlot.entries()].map(([slotCode, entry]) => ({
    slotCode,
    requirementLevel: entry.requirementLevel,
    reasonsTh: entry.reasonsTh,
    ruleCodes: entry.ruleCodes,
    alternativeGroupCode: entry.alternativeGroupCode,
  }));
  return { ok: true, requirements };
}

export function requiredSlotCodes(
  requirements: readonly ResolvedRequirement[],
): readonly DocumentSlotCode[] {
  return requirements
    .filter((requirement) => requirement.requirementLevel === RequirementLevel.REQUIRED)
    .map((requirement) => requirement.slotCode);
}

// ช่องบังคับที่ยังไม่มีเอกสาร: ช่องในกลุ่มทางเลือกเดียวกันนับผ่านเมื่อมีช่องใดช่องหนึ่งครบ
export function missingRequiredSlots(
  requirements: readonly ResolvedRequirement[],
  satisfiedSlotCodes: ReadonlySet<DocumentSlotCode>,
): readonly DocumentSlotCode[] {
  const satisfiedGroups = new Set<string>();
  for (const requirement of requirements) {
    if (requirement.alternativeGroupCode && satisfiedSlotCodes.has(requirement.slotCode)) {
      satisfiedGroups.add(requirement.alternativeGroupCode);
    }
  }
  return requirements
    .filter((requirement) => requirement.requirementLevel === RequirementLevel.REQUIRED)
    .filter((requirement) => !satisfiedSlotCodes.has(requirement.slotCode))
    .filter(
      (requirement) =>
        requirement.alternativeGroupCode === null ||
        !satisfiedGroups.has(requirement.alternativeGroupCode),
    )
    .map((requirement) => requirement.slotCode);
}
