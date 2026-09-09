'use server';

import { createHash, randomUUID } from 'node:crypto';
import {
  type ApplicationFormStep,
  applicantIdentityDraftSchema,
  applicationStep1Schema,
  documentRemoveInputSchema,
  documentUploadInputSchema,
  licenseDeclarationInputSchema,
  plantMaterialInputSchema,
  purposesDraftSchema,
  siteAndLandDraftSchema,
  UserRole,
} from '@gacp/contracts';
import { toCalendarDateValue } from '@gacp/db';
import { validateUpload } from '@gacp/domain';
import { buildDocumentStorageKey } from '@gacp/storage';
import { revalidatePath } from 'next/cache';
import { notFound, redirect } from 'next/navigation';
import { z } from 'zod';
import {
  type ApplicationForForm,
  isEditableDraft,
  loadFormRequirements,
  loadOwnedApplication,
} from '@/lib/application-form/queries.ts';
import { nextApplicationReferenceNumber } from '@/lib/application-form/reference-number.ts';
import { type CurrentUser, requireUserWithRole } from '@/lib/current-user.ts';
import { database } from '@/lib/database.ts';
import { encryptField, hmacField } from '@/lib/protected-fields.ts';
import { fileStorage } from '@/lib/storage.ts';

// Server Actions ของฟอร์มคำขอ ทุก action: ตรวจสิทธิ์ → โหลดคำขอของเจ้าของ → ต้องเป็นร่าง → แก้ → revalidate
// ไม่มีการเปลี่ยนสถานะคำขอที่นี่ (สถานะเปลี่ยนผ่าน ApplicationWorkflow ในขั้นถัดไปของการพัฒนาเท่านั้น)

const APPLICANT_HOME = '/applicant';

function stepPath(applicationId: string, step: ApplicationFormStep): string {
  return `/applicant/applications/${applicationId}/steps/${step}`;
}

function formText(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
}

function formList(formData: FormData, name: string): string[] {
  return formData.getAll(name).filter((value): value is string => typeof value === 'string');
}

function formBoolean(formData: FormData, name: string): boolean {
  return formData.get(name) === 'on' || formData.get(name) === 'true';
}

function formOptionalText(formData: FormData, name: string): string | undefined {
  return formData.has(name) ? formText(formData, name) : undefined;
}

// ตัด key ที่เป็น undefined ออก (ช่องที่ฟอร์มไม่ได้ส่งมา = ไม่แก้) ให้ตรงกับ exactOptionalPropertyTypes ของ Prisma
function definedOnly<T extends Record<string, unknown>>(
  input: T,
): { [K in keyof T]?: Exclude<T[K], undefined> } {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) output[key] = value;
  }
  return output as { [K in keyof T]?: Exclude<T[K], undefined> };
}

async function loadEditableApplication(
  applicationId: string,
  user: CurrentUser,
): Promise<ApplicationForForm> {
  const application = await loadOwnedApplication(applicationId, user.id);
  if (!application) notFound();
  if (!isEditableDraft(application)) redirect(`${APPLICANT_HOME}?notice=not-editable`);
  return application;
}

function revalidateApplication(applicationId: string): void {
  revalidatePath(`/applicant/applications/${applicationId}`, 'layout');
  revalidatePath(APPLICANT_HOME);
}

// เริ่มคำขอใหม่จากขั้นที่ 1: สร้าง Applicant + Application + สมาชิกเจ้าของ ในธุรกรรมเดียว
export async function createDraftApplication(formData: FormData): Promise<void> {
  const user = await requireUserWithRole(UserRole.APPLICANT, '/applicant/applications/new');
  const parsed = applicationStep1Schema.safeParse({
    requestType: formText(formData, 'requestType'),
    certificationScope: formText(formData, 'certificationScope'),
    plantCode: formText(formData, 'plantCode') || 'cannabis',
    applicantType: formText(formData, 'applicantType'),
    isAttorneyInFact: formBoolean(formData, 'isAttorneyInFact'),
    previousCertificateNumber: formOptionalText(formData, 'previousCertificateNumber'),
  });
  if (!parsed.success) redirect('/applicant/applications/new?error=invalid');

  const plant = await database.plant.findUnique({ where: { code: parsed.data.plantCode } });
  if (!plant?.isActive) redirect('/applicant/applications/new?error=plant');

  const applicationId = await database.$transaction(async (transaction) => {
    const referenceNumber = await nextApplicationReferenceNumber(transaction);
    const applicant = await transaction.applicant.create({
      data: {
        type: parsed.data.applicantType,
        members: { create: { userId: user.id, role: 'OWNER' } },
      },
    });
    const application = await transaction.application.create({
      data: {
        referenceNumber,
        applicantId: applicant.id,
        plantCode: parsed.data.plantCode,
        requestType: parsed.data.requestType,
        certificationScope: parsed.data.certificationScope,
        isAttorneyInFact: parsed.data.isAttorneyInFact,
        previousCertificateNumber: parsed.data.previousCertificateNumber ?? null,
        createdById: user.id,
      },
    });
    return application.id;
  });
  revalidatePath(APPLICANT_HOME);
  redirect(stepPath(applicationId, 2));
}

export async function saveStep1(applicationId: string, formData: FormData): Promise<void> {
  const user = await requireUserWithRole(UserRole.APPLICANT, stepPath(applicationId, 1));
  const application = await loadEditableApplication(applicationId, user);
  const parsed = applicationStep1Schema.safeParse({
    requestType: formText(formData, 'requestType'),
    certificationScope: formText(formData, 'certificationScope'),
    plantCode: formText(formData, 'plantCode') || application.plantCode,
    applicantType: formText(formData, 'applicantType'),
    isAttorneyInFact: formBoolean(formData, 'isAttorneyInFact'),
    previousCertificateNumber: formOptionalText(formData, 'previousCertificateNumber'),
  });
  if (!parsed.success) redirect(`${stepPath(applicationId, 1)}?error=invalid`);

  await database.$transaction([
    database.application.update({
      where: { id: applicationId },
      data: {
        requestType: parsed.data.requestType,
        certificationScope: parsed.data.certificationScope,
        isAttorneyInFact: parsed.data.isAttorneyInFact,
        attorneyPositionTh: parsed.data.isAttorneyInFact ? application.attorneyPositionTh : null,
        previousCertificateNumber: parsed.data.previousCertificateNumber ?? null,
      },
    }),
    database.applicant.update({
      where: { id: application.applicantId },
      data: { type: parsed.data.applicantType },
    }),
  ]);
  revalidateApplication(applicationId);
  if (formData.get('intent') === 'next') redirect(stepPath(applicationId, 2));
}

export async function saveStep2(applicationId: string, formData: FormData): Promise<void> {
  const user = await requireUserWithRole(UserRole.APPLICANT, stepPath(applicationId, 2));
  const application = await loadEditableApplication(applicationId, user);
  const parsed = applicantIdentityDraftSchema.safeParse({
    legalName: formOptionalText(formData, 'legalName'),
    registrationNumber: formOptionalText(formData, 'registrationNumber'),
    representativeName: formOptionalText(formData, 'representativeName'),
    nationality: formOptionalText(formData, 'nationality'),
    nationalId: formOptionalText(formData, 'nationalId'),
    houseRegistrationNo: formOptionalText(formData, 'houseRegistrationNo'),
    addressLine: formOptionalText(formData, 'addressLine'),
    subdistrict: formOptionalText(formData, 'subdistrict'),
    district: formOptionalText(formData, 'district'),
    province: formOptionalText(formData, 'province'),
    postalCode: formOptionalText(formData, 'postalCode'),
    mobilePhone: formOptionalText(formData, 'mobilePhone'),
    email: formOptionalText(formData, 'email'),
    lineId: formOptionalText(formData, 'lineId'),
    attorneyPositionTh: formOptionalText(formData, 'attorneyPositionTh'),
  });
  if (!parsed.success) redirect(`${stepPath(applicationId, 2)}?error=invalid`);
  const { nationalId, attorneyPositionTh, ...identity } = parsed.data;

  // เลขบัตร: ว่าง = ไม่เปลี่ยน (ช่องแสดงแบบปิดบัง) มีค่า = เข้ารหัสใหม่ + HMAC ไม่มี plaintext ลงฐานข้อมูล
  const nationalIdFields: { nationalIdEncrypted?: string; nationalIdHmac?: string } =
    nationalId === null || nationalId === undefined
      ? {}
      : { nationalIdEncrypted: encryptField(nationalId), nationalIdHmac: hmacField(nationalId) };

  await database.$transaction(async (transaction) => {
    await transaction.applicant.update({
      where: { id: application.applicantId },
      data: { ...definedOnly(identity), ...nationalIdFields },
    });
    if (attorneyPositionTh !== undefined) {
      await transaction.application.update({
        where: { id: applicationId },
        data: { attorneyPositionTh },
      });
    }
    // ชื่อสถานที่ = ชื่อผู้ขอรับรองเสมอ (หลักการข้อ 4)
    if (identity.legalName !== undefined && application.siteId) {
      await transaction.site.update({
        where: { id: application.siteId },
        data: { name: identity.legalName },
      });
    }
  });
  revalidateApplication(applicationId);
  if (formData.get('intent') === 'next') redirect(stepPath(applicationId, 3));
}

export async function saveStep3(applicationId: string, formData: FormData): Promise<void> {
  const user = await requireUserWithRole(UserRole.APPLICANT, stepPath(applicationId, 3));
  const application = await loadEditableApplication(applicationId, user);
  const landTenureRaw = formText(formData, 'landTenure');
  const leaseEndsOnRaw = formText(formData, 'leaseEndsOn');
  const parsed = siteAndLandDraftSchema.safeParse({
    siteAddressLine: formOptionalText(formData, 'siteAddressLine'),
    siteSubdistrict: formOptionalText(formData, 'siteSubdistrict'),
    siteDistrict: formOptionalText(formData, 'siteDistrict'),
    siteProvince: formOptionalText(formData, 'siteProvince'),
    sitePostalCode: formOptionalText(formData, 'sitePostalCode'),
    sitePhone: formOptionalText(formData, 'sitePhone'),
    latitude: formOptionalText(formData, 'latitude'),
    longitude: formOptionalText(formData, 'longitude'),
    landDocumentType: formOptionalText(formData, 'landDocumentType'),
    landDocumentNumber: formOptionalText(formData, 'landDocumentNumber'),
    landVolume: formOptionalText(formData, 'landVolume'),
    landPage: formOptionalText(formData, 'landPage'),
    landIssuedBy: formOptionalText(formData, 'landIssuedBy'),
    areaSquareMetres: formOptionalText(formData, 'areaSquareMetres'),
    plantsPerCycle: formOptionalText(formData, 'plantsPerCycle'),
    cyclesPerYear: formOptionalText(formData, 'cyclesPerYear'),
    areaTypes: formList(formData, 'areaTypes'),
    areaTypeOther: formOptionalText(formData, 'areaTypeOther'),
    landlordName: formOptionalText(formData, 'landlordName'),
    landTenure: landTenureRaw === '' ? null : landTenureRaw,
    leaseEndsOn: leaseEndsOnRaw === '' ? null : leaseEndsOnRaw,
  });
  if (!parsed.success) redirect(`${stepPath(applicationId, 3)}?error=invalid`);
  const data = parsed.data;

  await database.$transaction(async (transaction) => {
    const siteData = {
      name: application.applicant.legalName,
      addressLine: data.siteAddressLine ?? null,
      subdistrict: data.siteSubdistrict ?? null,
      district: data.siteDistrict ?? null,
      province: data.siteProvince ?? null,
      postalCode: data.sitePostalCode ?? null,
      phone: data.sitePhone ?? null,
      latitude: data.latitude ?? null,
      longitude: data.longitude ?? null,
    };
    const siteId =
      application.siteId ??
      (
        await transaction.site.create({
          data: { applicantId: application.applicantId, ...siteData },
        })
      ).id;
    if (application.siteId)
      await transaction.site.update({ where: { id: siteId }, data: siteData });

    const parcelData = {
      documentType: data.landDocumentType ?? null,
      documentNumber: data.landDocumentNumber ?? null,
      volume: data.landVolume ?? null,
      page: data.landPage ?? null,
      issuedBy: data.landIssuedBy ?? null,
      areaSquareMetres: data.areaSquareMetres ?? null,
    };
    const existingParcel = application.site?.landParcels[0];
    if (existingParcel) {
      await transaction.landParcel.update({ where: { id: existingParcel.id }, data: parcelData });
    } else {
      await transaction.landParcel.create({ data: { siteId, ...parcelData } });
    }

    await transaction.application.update({
      where: { id: applicationId },
      data: {
        siteId,
        areaTypes: data.areaTypes,
        areaTypeOther: data.areaTypes.includes('OTHER') ? (data.areaTypeOther ?? null) : null,
        landTenure: data.landTenure ?? null,
        landlordName:
          data.landTenure === 'RENTED' || data.landTenure === 'OWNER_PERMITTED'
            ? (data.landlordName ?? null)
            : null,
        leaseEndsOn: data.leaseEndsOn ? toCalendarDateValue(data.leaseEndsOn) : null,
        plantsPerCycle: data.plantsPerCycle ?? null,
        cyclesPerYear: data.cyclesPerYear ?? null,
      },
    });
  });
  revalidateApplication(applicationId);
  if (formData.get('intent') === 'next') redirect(stepPath(applicationId, 4));
}

export async function savePurposes(applicationId: string, formData: FormData): Promise<void> {
  const user = await requireUserWithRole(UserRole.APPLICANT, stepPath(applicationId, 4));
  await loadEditableApplication(applicationId, user);
  const parsed = purposesDraftSchema.safeParse({ purposes: formList(formData, 'purposes') });
  if (!parsed.success) redirect(`${stepPath(applicationId, 4)}?error=invalid`);
  await database.application.update({
    where: { id: applicationId },
    data: { purposes: parsed.data.purposes },
  });
  revalidateApplication(applicationId);
  if (formData.get('intent') === 'next') redirect(stepPath(applicationId, 5));
}

export async function addPlantMaterial(applicationId: string, formData: FormData): Promise<void> {
  const user = await requireUserWithRole(UserRole.APPLICANT, stepPath(applicationId, 4));
  const application = await loadEditableApplication(applicationId, user);
  const parsed = plantMaterialInputSchema.safeParse({
    kind: formText(formData, 'kind'),
    varietyName: formText(formData, 'varietyName'),
    origin: formText(formData, 'origin'),
    originCountry: formOptionalText(formData, 'originCountry'),
    source: formText(formData, 'source'),
    quantity: formOptionalText(formData, 'quantity'),
    unit: formOptionalText(formData, 'unit'),
  });
  if (!parsed.success) redirect(`${stepPath(applicationId, 4)}?error=material`);
  const nextSortOrder = (application.plantMaterials.at(-1)?.sortOrder ?? -1) + 1;
  await database.applicationPlantMaterial.create({
    data: {
      applicationId,
      kind: parsed.data.kind,
      varietyName: parsed.data.varietyName,
      origin: parsed.data.origin,
      originCountry: parsed.data.origin === 'IMPORTED' ? (parsed.data.originCountry ?? null) : null,
      source: parsed.data.source,
      quantity: parsed.data.quantity ?? null,
      unit: parsed.data.unit ?? null,
      sortOrder: nextSortOrder,
    },
  });
  revalidateApplication(applicationId);
}

export async function removePlantMaterial(
  applicationId: string,
  formData: FormData,
): Promise<void> {
  const user = await requireUserWithRole(UserRole.APPLICANT, stepPath(applicationId, 4));
  await loadEditableApplication(applicationId, user);
  const materialId = z.uuid().safeParse(formText(formData, 'materialId'));
  if (!materialId.success) return;
  await database.applicationPlantMaterial.deleteMany({
    where: { id: materialId.data, applicationId },
  });
  revalidateApplication(applicationId);
}

export async function saveLicenseDeclaration(
  applicationId: string,
  formData: FormData,
): Promise<void> {
  const user = await requireUserWithRole(UserRole.APPLICANT, stepPath(applicationId, 5));
  await loadEditableApplication(applicationId, user);
  const dateOrNull = (name: string) => {
    const value = formText(formData, name);
    return value === '' ? null : value;
  };
  const parsed = licenseDeclarationInputSchema.safeParse({
    slotCode: formText(formData, 'slotCode'),
    status: formText(formData, 'status'),
    licenseNumber: formOptionalText(formData, 'licenseNumber'),
    issuedOn: dateOrNull('issuedOn'),
    expiresOn: dateOrNull('expiresOn'),
    receiptNumber: formOptionalText(formData, 'receiptNumber'),
    filedWithTh: formOptionalText(formData, 'filedWithTh'),
    filedOn: dateOrNull('filedOn'),
    expectedDecisionOn: dateOrNull('expectedDecisionOn'),
  });
  if (!parsed.success) redirect(`${stepPath(applicationId, 5)}?error=invalid`);
  const { slotCode, ...fields } = parsed.data;
  const row = {
    status: fields.status,
    licenseNumber: fields.licenseNumber ?? null,
    issuedOn: fields.issuedOn ? toCalendarDateValue(fields.issuedOn) : null,
    expiresOn: fields.expiresOn ? toCalendarDateValue(fields.expiresOn) : null,
    receiptNumber: fields.receiptNumber ?? null,
    filedWithTh: fields.filedWithTh ?? null,
    filedOn: fields.filedOn ? toCalendarDateValue(fields.filedOn) : null,
    expectedDecisionOn: fields.expectedDecisionOn
      ? toCalendarDateValue(fields.expectedDecisionOn)
      : null,
  };
  await database.licenseStatusDeclaration.upsert({
    // biome-ignore lint/style/useNamingConvention: ชื่อ compound unique key ที่ Prisma สร้างจาก @@unique([applicationId, slotCode])
    where: { applicationId_slotCode: { applicationId, slotCode } },
    create: { applicationId, slotCode, ...row },
    update: row,
  });
  revalidateApplication(applicationId);
}

// ท่ออัปโหลดเดียวของทั้งระบบ: ตรวจสิทธิ์ ช่องต้องอยู่ในรายการของคำขอ ตรวจเนื้อไฟล์ เก็บด้วย key สุ่ม บันทึกแถวพร้อม sha256
export async function uploadDocument(formData: FormData): Promise<void> {
  const applicationId = formText(formData, 'applicationId');
  const returnStep = Number(formText(formData, 'returnStep') || '2') as ApplicationFormStep;
  const user = await requireUserWithRole(UserRole.APPLICANT, stepPath(applicationId, returnStep));
  const parsed = documentUploadInputSchema.safeParse({
    applicationId,
    slotCode: formText(formData, 'slotCode'),
    issuedOn: formText(formData, 'issuedOn') || null,
  });
  if (!parsed.success) redirect(`${stepPath(applicationId, returnStep)}?error=invalid`);
  const application = await loadEditableApplication(applicationId, user);
  const requirements = await loadFormRequirements(application);
  const status = requirements.slotStatuses.find(
    (entry) => entry.slot.code === parsed.data.slotCode,
  );
  if (!status)
    redirect(`${stepPath(applicationId, returnStep)}?error=slot&slot=${parsed.data.slotCode}`);

  const file = formData.get('file');
  if (!(file instanceof File))
    redirect(`${stepPath(applicationId, returnStep)}?error=EMPTY_FILE&slot=${status.slot.code}`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const validation = validateUpload(
    status.slot,
    {
      declaredMimeType: file.type,
      byteSize: bytes.byteLength,
      head: bytes.subarray(0, 16),
      issuedOn: parsed.data.issuedOn ?? null,
    },
    status.documents.length,
  );
  if (!validation.ok)
    redirect(
      `${stepPath(applicationId, returnStep)}?error=${validation.code}&slot=${status.slot.code}`,
    );

  const fileKey = buildDocumentStorageKey(applicationId, status.slot.code, randomUUID());
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  await fileStorage.put(fileKey, bytes, validation.mimeType);
  try {
    await database.$transaction(async (transaction) => {
      const latest = await transaction.applicationDocument.findFirst({
        where: { applicationId, slotCode: status.slot.code },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      await transaction.applicationDocument.create({
        data: {
          applicationId,
          slotCode: status.slot.code,
          version: (latest?.version ?? 0) + 1,
          fileKey,
          fileName: file.name.slice(0, 255),
          mimeType: validation.mimeType,
          byteSize: bytes.byteLength,
          sha256,
          issuedOn: parsed.data.issuedOn ? toCalendarDateValue(parsed.data.issuedOn) : null,
          uploadedById: user.id,
        },
      });
    });
  } catch (error) {
    await fileStorage.delete(fileKey).catch(() => undefined);
    throw error;
  }
  revalidateApplication(applicationId);
  redirect(`${stepPath(applicationId, returnStep)}#slot-${status.slot.code}`);
}

// ลบไฟล์ที่ผู้ขอรับรองแนบผิด: คงแถวไว้เป็นประวัติ (removed_at) และลบไฟล์จริงออกจากที่เก็บ
export async function removeDocument(formData: FormData): Promise<void> {
  const returnStep = Number(formText(formData, 'returnStep') || '2') as ApplicationFormStep;
  const parsed = documentRemoveInputSchema.safeParse({
    applicationId: formText(formData, 'applicationId'),
    documentId: formText(formData, 'documentId'),
  });
  if (!parsed.success) redirect(APPLICANT_HOME);
  const user = await requireUserWithRole(
    UserRole.APPLICANT,
    stepPath(parsed.data.applicationId, returnStep),
  );
  await loadEditableApplication(parsed.data.applicationId, user);
  const document = await database.applicationDocument.findFirst({
    where: {
      id: parsed.data.documentId,
      applicationId: parsed.data.applicationId,
      removedAt: null,
    },
  });
  if (!document) redirect(stepPath(parsed.data.applicationId, returnStep));
  await database.applicationDocument.update({
    where: { id: document.id },
    data: { removedAt: new Date(), removedById: user.id },
  });
  await fileStorage.delete(document.fileKey).catch(() => undefined);
  revalidateApplication(parsed.data.applicationId);
  redirect(`${stepPath(parsed.data.applicationId, returnStep)}#slot-${document.slotCode}`);
}
