import 'server-only';
import {
  type ApplicantIdentityDraft,
  type ApplicationFormStep,
  ApplicationStatus,
  type DocumentSlotCode,
  type DocumentSlotDefinition,
  REQUIRED_SITE_AND_LAND_FIELDS,
  RequirementLevel,
  requiredApplicantFields,
  type SiteAndLandDraft,
} from '@gacp/contracts';
import {
  loadDocumentRequirementRules,
  loadDocumentSlots,
  type Prisma,
  toCalendarDate,
} from '@gacp/db';
import {
  type LicenseSlotState,
  licenseSlotState,
  missingRequiredSlots,
  type RequirementContext,
  type ResolvedRequirement,
  resolveDocumentRequirements,
  satisfiedSlotCodes,
} from '@gacp/domain';
import { todayCalendarDateInBangkok } from '@gacp/ui';
import { database } from '@/lib/database.ts';

// ความจริงฝั่ง server ของฟอร์มคำขอ ทุกหน้า (ขั้น 1 ถึง 6 และหน้าผู้ตรวจในภายหลัง) อ่านผ่านฟังก์ชันชุดนี้เท่านั้น

export const applicationFormInclude = {
  applicant: true,
  plant: { select: { code: true, nameTh: true } },
  site: { include: { landParcels: { orderBy: { createdAt: 'asc' as const } } } },
  plantMaterials: { orderBy: { sortOrder: 'asc' as const } },
  documents: { where: { removedAt: null }, orderBy: { uploadedAt: 'asc' as const } },
  licenseDeclarations: true,
} satisfies Prisma.ApplicationInclude;

export type ApplicationForForm = Prisma.ApplicationGetPayload<{
  include: typeof applicationFormInclude;
}>;
export type ApplicationDocumentRow = ApplicationForForm['documents'][number];
export type LicenseDeclarationRow = ApplicationForForm['licenseDeclarations'][number];

// คำขอที่ผู้ใช้เป็นสมาชิกของผู้ขอรับรอง (เจ้าของ) เท่านั้น ไม่ใช่ = ไม่พบ
export async function loadOwnedApplication(
  applicationId: string,
  userId: string,
): Promise<ApplicationForForm | null> {
  return database.application.findFirst({
    where: { id: applicationId, applicant: { members: { some: { userId } } } },
    include: applicationFormInclude,
  });
}

export async function listOwnedApplications(userId: string) {
  return database.application.findMany({
    where: { applicant: { members: { some: { userId } } } },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      referenceNumber: true,
      requestType: true,
      status: true,
      updatedAt: true,
      applicant: { select: { legalName: true } },
    },
  });
}

export function isEditableDraft(application: ApplicationForForm): boolean {
  return application.status === ApplicationStatus.DRAFT;
}

export function requirementContextOf(
  application: ApplicationForForm,
  asOf: string = todayCalendarDateInBangkok(),
): RequirementContext {
  return {
    plantCode: application.plantCode,
    applicantType: application.applicant.type,
    requestType: application.requestType,
    certificationScope: application.certificationScope,
    purposes: application.purposes,
    areaTypes: application.areaTypes,
    landTenure: application.landTenure,
    isAttorneyInFact: application.isAttorneyInFact,
    asOf,
  };
}

export type SlotStatus = {
  readonly slot: DocumentSlotDefinition;
  readonly requirement: ResolvedRequirement;
  readonly documents: readonly ApplicationDocumentRow[];
  readonly declaration: LicenseDeclarationRow | undefined;
  readonly licenseState: LicenseSlotState | null;
  readonly satisfied: boolean;
};

export type FormRequirements = {
  readonly judgeable: boolean;
  readonly slotStatuses: readonly SlotStatus[];
  readonly requiredCount: number;
  readonly satisfiedRequiredCount: number;
  readonly missingRequired: readonly DocumentSlotCode[];
};

// lens เดียว: กฎ (DB) → resolveDocumentRequirements (domain) → สถานะต่อช่องพร้อมไฟล์และสถานะใบอนุญาต
export async function loadFormRequirements(
  application: ApplicationForForm,
): Promise<FormRequirements> {
  const [rules, slots] = await Promise.all([
    loadDocumentRequirementRules(database, application.plantCode),
    loadDocumentSlots(database),
  ]);
  const resolution = resolveDocumentRequirements(requirementContextOf(application), rules);
  if (!resolution.ok) {
    return {
      judgeable: false,
      slotStatuses: [],
      requiredCount: 0,
      satisfiedRequiredCount: 0,
      missingRequired: [],
    };
  }
  const slotByCode = new Map(slots.map((slot) => [slot.code, slot]));
  const licenseSlotCodes = new Set(slots.filter((slot) => slot.isLicense).map((slot) => slot.code));
  const documentsBySlot = new Map<DocumentSlotCode, ApplicationDocumentRow[]>();
  for (const document of application.documents) {
    const list = documentsBySlot.get(document.slotCode) ?? [];
    list.push(document);
    documentsBySlot.set(document.slotCode, list);
  }
  const declarationBySlot = new Map(
    application.licenseDeclarations.map((declaration) => [declaration.slotCode, declaration]),
  );
  const satisfied = satisfiedSlotCodes(
    [...documentsBySlot.entries()].map(([slotCode, documents]) => ({
      slotCode,
      fileCount: documents.length,
    })),
    licenseSlotCodes,
    application.licenseDeclarations.map((declaration) => ({
      slotCode: declaration.slotCode,
      status: declaration.status,
      receiptNumber: declaration.receiptNumber,
    })),
  );
  const slotStatuses = resolution.requirements
    .map((requirement): SlotStatus | null => {
      const slot = slotByCode.get(requirement.slotCode);
      if (!slot) return null;
      const documents = documentsBySlot.get(slot.code) ?? [];
      const declaration = declarationBySlot.get(slot.code);
      const licenseState = slot.isLicense
        ? licenseSlotState(
            declaration
              ? {
                  slotCode: slot.code,
                  status: declaration.status,
                  receiptNumber: declaration.receiptNumber,
                }
              : undefined,
            documents.length,
          )
        : null;
      return {
        slot,
        requirement,
        documents,
        declaration,
        licenseState,
        satisfied: satisfied.has(slot.code),
      };
    })
    .filter((status): status is SlotStatus => status !== null)
    .sort(
      (left, right) =>
        left.slot.formStep - right.slot.formStep || left.slot.sortOrder - right.slot.sortOrder,
    );
  const required = slotStatuses.filter(
    (status) => status.requirement.requirementLevel === RequirementLevel.REQUIRED,
  );
  return {
    judgeable: true,
    slotStatuses,
    requiredCount: required.length,
    satisfiedRequiredCount: required.filter((status) => status.satisfied).length,
    missingRequired: missingRequiredSlots(resolution.requirements, satisfied),
  };
}

export function slotStatusesForStep(
  requirements: FormRequirements,
  step: ApplicationFormStep,
): SlotStatus[] {
  return requirements.slotStatuses.filter((status) => status.slot.formStep === step);
}

// ค่าที่กรอกของส่วนที่ ๑ ในรูปของ contracts (เลขบัตรไม่ถอดรหัสที่นี่ ส่งเฉพาะว่ามีหรือไม่)
export function applicantIdentityOf(application: ApplicationForForm): ApplicantIdentityDraft & {
  readonly hasNationalId: boolean;
} {
  const applicant = application.applicant;
  return {
    legalName: applicant.legalName,
    registrationNumber: applicant.registrationNumber,
    representativeName: applicant.representativeName,
    nationality: applicant.nationality,
    nationalId: null,
    hasNationalId: applicant.nationalIdEncrypted !== null,
    houseRegistrationNo: applicant.houseRegistrationNo,
    addressLine: applicant.addressLine,
    subdistrict: applicant.subdistrict,
    district: applicant.district,
    province: applicant.province,
    postalCode: applicant.postalCode,
    mobilePhone: applicant.mobilePhone,
    email: applicant.email,
    lineId: applicant.lineId,
    attorneyPositionTh: application.attorneyPositionTh,
  };
}

export function siteAndLandOf(application: ApplicationForForm): SiteAndLandDraft {
  const site = application.site;
  const parcel = site?.landParcels[0];
  return {
    siteAddressLine: site?.addressLine ?? null,
    siteSubdistrict: site?.subdistrict ?? null,
    siteDistrict: site?.district ?? null,
    siteProvince: site?.province ?? null,
    sitePostalCode: site?.postalCode ?? null,
    sitePhone: site?.phone ?? null,
    latitude:
      site?.latitude === null || site?.latitude === undefined ? null : Number(site.latitude),
    longitude:
      site?.longitude === null || site?.longitude === undefined ? null : Number(site.longitude),
    landDocumentType: parcel?.documentType ?? null,
    landDocumentNumber: parcel?.documentNumber ?? null,
    landVolume: parcel?.volume ?? null,
    landPage: parcel?.page ?? null,
    landIssuedBy: parcel?.issuedBy ?? null,
    areaSquareMetres:
      parcel?.areaSquareMetres === null || parcel?.areaSquareMetres === undefined
        ? null
        : Number(parcel.areaSquareMetres),
    plantsPerCycle: application.plantsPerCycle,
    cyclesPerYear: application.cyclesPerYear,
    areaTypes: application.areaTypes,
    areaTypeOther: application.areaTypeOther,
    landTenure: application.landTenure,
    landlordName: application.landlordName,
    leaseEndsOn: application.leaseEndsOn ? toCalendarDate(application.leaseEndsOn) : null,
  };
}

export type StepProgress = {
  readonly step: ApplicationFormStep;
  readonly missingFieldKeys: readonly string[];
  readonly missingSlotCodes: readonly DocumentSlotCode[];
  readonly totalFields: number;
};

function isBlank(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    value === '' ||
    (Array.isArray(value) && value.length === 0)
  );
}

// ความคืบหน้าต่อขั้น ใช้ทั้งบนแถบขั้น (จุดเตือน) และหน้าตรวจทาน (รายการ "ไปแก้ที่ขั้น N")
export function computeStepProgress(
  application: ApplicationForForm,
  requirements: FormRequirements,
): readonly StepProgress[] {
  const identity = applicantIdentityOf(application);
  const identityRequired = requiredApplicantFields(
    application.applicant.type,
    application.isAttorneyInFact,
  );
  const missingIdentity = identityRequired.filter((field) =>
    field === 'nationalId' ? !identity.hasNationalId : isBlank(identity[field]),
  );
  const siteAndLand = siteAndLandOf(application);
  const missingSite = REQUIRED_SITE_AND_LAND_FIELDS.filter((field) => isBlank(siteAndLand[field]));
  if (
    (siteAndLand.landTenure === 'RENTED' || siteAndLand.landTenure === 'OWNER_PERMITTED') &&
    isBlank(siteAndLand.landlordName)
  ) {
    missingSite.push('landlordName');
  }
  if (siteAndLand.areaTypes.includes('OTHER') && isBlank(siteAndLand.areaTypeOther)) {
    missingSite.push('areaTypeOther');
  }
  const missingStep4: string[] = [];
  if (application.purposes.length === 0) missingStep4.push('purposes');
  if (application.plantMaterials.length === 0) missingStep4.push('plantMaterials');

  const missingSlotsForStep = (step: ApplicationFormStep): DocumentSlotCode[] =>
    slotStatusesForStep(requirements, step)
      .filter((status) => requirements.missingRequired.includes(status.slot.code))
      .map((status) => status.slot.code);

  return [
    { step: 1, missingFieldKeys: [], missingSlotCodes: [], totalFields: 4 },
    {
      step: 2,
      missingFieldKeys: missingIdentity,
      missingSlotCodes: missingSlotsForStep(2),
      totalFields: identityRequired.length,
    },
    {
      step: 3,
      missingFieldKeys: missingSite,
      missingSlotCodes: missingSlotsForStep(3),
      totalFields: REQUIRED_SITE_AND_LAND_FIELDS.length,
    },
    { step: 4, missingFieldKeys: missingStep4, missingSlotCodes: [], totalFields: 2 },
    { step: 5, missingFieldKeys: [], missingSlotCodes: missingSlotsForStep(5), totalFields: 0 },
    { step: 6, missingFieldKeys: [], missingSlotCodes: [], totalFields: 0 },
  ];
}
