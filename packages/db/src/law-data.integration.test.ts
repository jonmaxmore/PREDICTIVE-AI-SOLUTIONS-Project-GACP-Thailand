import {
  ApplicantType,
  AreaType,
  CertificationScope,
  DocumentSlotCode,
  FeeStage,
  LandTenure,
  Purpose,
  RequestType,
  readEnv,
} from '@gacp/contracts';
import {
  buildQuotation,
  missingRequiredSlots,
  requiredSlotCodes,
  resolveDocumentRequirements,
  resolveFeeSchedule,
} from '@gacp/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabaseClient, type DatabaseClient } from './client.ts';
import { loadDocumentRequirementRules, loadDocumentSlots, loadFeeSchedules } from './law-data.ts';
import { lawDataSeeds, seedLawData } from './seed-law.ts';

// ชุดกฎจริงจาก seeds ผ่านฐานข้อมูลจริง แล้วรันเครื่องยนต์ของ domain กับฉากจบ Phase 1 (แผน §9)

const areaTypeLabelsTh = {
  [AreaType.OUTDOOR]: 'กลางแจ้ง',
  [AreaType.INDOOR]: 'โรงเรือนระบบปิด',
  [AreaType.GREENHOUSE]: 'โรงเรือนทั่วไป',
  [AreaType.OTHER]: 'อื่น ๆ',
} as const;

let database: DatabaseClient;

beforeAll(async () => {
  database = createDatabaseClient(readEnv().GACP_DATABASE_URL);
  await seedLawData(database);
});

afterAll(async () => {
  await database.$disconnect();
});

describe('กฎเป็นข้อมูลในฐานข้อมูล', () => {
  it('seed ซ้ำได้โดยจำนวนแถวไม่เพิ่ม', async () => {
    const counts = await seedLawData(database);
    expect(await database.documentSlot.count()).toBe(counts.documentSlots);
    expect(await database.documentRequirementRule.count()).toBe(counts.documentRequirementRules);
    expect(await database.feeSchedule.count()).toBe(counts.feeSchedules);
    expect(await database.inspectionChecklistItem.count()).toBe(counts.inspectionChecklistItems);
    expect(await database.certificateTerm.count()).toBe(counts.certificateTerms);
    expect(await database.publicHoliday.count()).toBe(counts.publicHolidays);
  });

  it('ทุกช่องใน contracts มีนิยามในฐานข้อมูล และกลับกัน', async () => {
    const slots = await loadDocumentSlots(database);
    expect(slots.map((slot) => slot.code).sort()).toEqual(Object.values(DocumentSlotCode).sort());
    for (const slot of slots) {
      if (slot.isSystemGenerated) continue;
      expect(slot.howToObtainTh, `${slot.code} ต้องบอกว่าหาได้ที่ไหน`).not.toBe('');
    }
  });

  it('ทุกช่องที่มีกฎอ้างถึงมีนิยาม และทุกกฎในฐานข้อมูลตรงกับ seed', async () => {
    const rules = await loadDocumentRequirementRules(database, 'cannabis');
    expect(rules).toHaveLength(lawDataSeeds.documentRequirementRules.length);
    const byCode = new Map(lawDataSeeds.documentRequirementRules.map((rule) => [rule.code, rule]));
    for (const rule of rules) {
      expect(rule, rule.code).toEqual(byCode.get(rule.code));
    }
  });
});

describe('ฉากจบ Phase 1 กับชุดกฎจริง', () => {
  it('วิสาหกิจชุมชน ผู้รับมอบอำนาจ เช่าที่ดิน โรงเรือนระบบปิด + กลางแจ้ง การแพทย์ + ส่งออก', async () => {
    const rules = await loadDocumentRequirementRules(database, 'cannabis');
    const result = resolveDocumentRequirements(
      {
        plantCode: 'cannabis',
        applicantType: ApplicantType.COMMUNITY_ENTERPRISE,
        requestType: RequestType.NEW,
        certificationScope: CertificationScope.CULTIVATION,
        purposes: [Purpose.MEDICAL, Purpose.EXPORT],
        areaTypes: [AreaType.INDOOR, AreaType.OUTDOOR],
        landTenure: LandTenure.RENTED,
        isAttorneyInFact: true,
        asOf: '2026-09-09',
      },
      rules,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect([...requiredSlotCodes(result.requirements)].sort()).toEqual(
      [
        DocumentSlotCode.NATIONAL_ID_COPY,
        DocumentSlotCode.HOUSE_REGISTRATION_COPY,
        DocumentSlotCode.COMMUNITY_ENTERPRISE_REGISTRATION,
        DocumentSlotCode.COMMUNITY_MEMBER_LIST,
        DocumentSlotCode.COMMUNITY_ASSIGNMENT_LETTER,
        DocumentSlotCode.POWER_OF_ATTORNEY,
        DocumentSlotCode.POA_GRANTOR_ID_COPY,
        DocumentSlotCode.LAND_RIGHTS_DOCUMENT,
        DocumentSlotCode.LANDLORD_CONSENT_LETTER,
        DocumentSlotCode.SITE_MAP_WITH_COORDINATES,
        DocumentSlotCode.BUILDING_PLAN_AND_PHOTOS,
        DocumentSlotCode.FIELD_AND_SURROUNDINGS_PHOTOS,
        DocumentSlotCode.PRODUCTION_SITE_PHOTOS,
        DocumentSlotCode.PRODUCTION_AND_UTILISATION_PLAN,
        DocumentSlotCode.SECURITY_MEASURES_PLAN,
        DocumentSlotCode.RESIDUE_UTILISATION_PLAN,
        DocumentSlotCode.SOP_MANUAL,
        DocumentSlotCode.CONTROLLED_HERB_LICENSE_EXPORT,
      ].sort(),
    );
    // ยังไม่แนบอะไรเลย = ขาดครบทั้ง 18 ช่อง แนบครบ = ไม่ขาด
    expect(missingRequiredSlots(result.requirements, new Set())).toHaveLength(18);
    expect(
      missingRequiredSlots(result.requirements, new Set(requiredSlotCodes(result.requirements))),
    ).toEqual([]);
  });

  it('บุคคลธรรมดา ต่ออายุ ที่ดินของตนเอง กลางแจ้ง การแพทย์ ได้ชุดต่ออายุ ไม่ได้แผนงานคำขอใหม่', async () => {
    const rules = await loadDocumentRequirementRules(database, 'cannabis');
    const result = resolveDocumentRequirements(
      {
        plantCode: 'cannabis',
        applicantType: ApplicantType.INDIVIDUAL,
        requestType: RequestType.RENEWAL,
        certificationScope: CertificationScope.CULTIVATION,
        purposes: [Purpose.MEDICAL],
        areaTypes: [AreaType.OUTDOOR],
        landTenure: LandTenure.OWNED,
        isAttorneyInFact: false,
        asOf: '2026-09-09',
      },
      rules,
    );
    if (!result.ok) throw new Error('unexpected');
    const codes = requiredSlotCodes(result.requirements);
    expect(codes).toContain(DocumentSlotCode.PRODUCER_SUPERVISION_LETTER);
    expect(codes).toContain(DocumentSlotCode.PREVIOUS_CERTIFICATE_ORIGINAL);
    expect(codes).toContain(DocumentSlotCode.OPERATION_SUMMARY_REPORT);
    expect(codes).not.toContain(DocumentSlotCode.SOP_MANUAL);
    expect(codes).not.toContain(DocumentSlotCode.LANDLORD_CONSENT_LETTER);
    expect(codes).not.toContain(DocumentSlotCode.POWER_OF_ATTORNEY);
  });

  it('ใบเสนอราคา: งวดที่ 1 = 11,770 บาท งวดที่ 2 = 58,850 บาท (2 รูปแบบ) ต่ออายุ = 35,310 บาท (1 รูปแบบ)', async () => {
    const schedules = await loadFeeSchedules(database, 'cannabis');
    const query = {
      plantCode: 'cannabis',
      requestType: RequestType.NEW,
      asOf: '2026-09-09',
    } as const;

    const first = resolveFeeSchedule(schedules, { ...query, feeStage: FeeStage.DOCUMENT_REVIEW });
    if (!first.ok) throw new Error(first.code);
    const firstQuotation = buildQuotation(first.schedule, {
      areaTypes: [AreaType.INDOOR, AreaType.OUTDOOR],
      areaTypeLabelsTh,
      issuedOn: '2026-09-09',
    });
    expect(firstQuotation.totals.netSatang).toBe(1_177_000);
    expect(firstQuotation.lines).toHaveLength(2);
    expect(firstQuotation.validUntil).toBe('2026-10-09');

    const second = resolveFeeSchedule(schedules, {
      ...query,
      feeStage: FeeStage.ONSITE_INSPECTION,
    });
    if (!second.ok) throw new Error(second.code);
    expect(
      buildQuotation(second.schedule, {
        areaTypes: [AreaType.INDOOR, AreaType.OUTDOOR],
        areaTypeLabelsTh,
        issuedOn: '2026-09-20',
      }).totals.netSatang,
    ).toBe(5_885_000);

    const renewal = resolveFeeSchedule(schedules, {
      ...query,
      requestType: RequestType.RENEWAL,
      feeStage: FeeStage.DOCUMENT_REVIEW,
    });
    if (!renewal.ok) throw new Error(renewal.code);
    expect(
      buildQuotation(renewal.schedule, {
        areaTypes: [AreaType.OUTDOOR],
        areaTypeLabelsTh,
        issuedOn: '2026-09-09',
      }).totals.netSatang,
    ).toBe(3_531_000);

    // ใบแทนยังไม่มีอัตรา (รอ ruling) ระบบต้องบอกว่าออกใบไม่ได้ ไม่เดาราคา
    const replacement = resolveFeeSchedule(schedules, {
      ...query,
      requestType: RequestType.REPLACEMENT,
      feeStage: FeeStage.DOCUMENT_REVIEW,
    });
    expect(replacement.ok).toBe(false);
  });
});
