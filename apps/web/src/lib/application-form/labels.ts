import type {
  ApplicantIdentityField,
  ApplicantType,
  ApplicationFormStep,
  DocumentSlotDefinition,
  SiteAndLandDraft,
} from '@gacp/contracts';
import { messages } from '@/messages/th.ts';

// ป้ายชื่อของช่องกรอกและช่องเอกสาร ใช้ทั้งในฟอร์ม แถบข้าง และหน้าตรวจทาน (ชื่อเดียวทุกที่)

export function applicantFieldLabel(
  field: ApplicantIdentityField,
  applicantType: ApplicantType,
): string {
  const step2 = messages.form.step2;
  switch (field) {
    case 'legalName':
      return step2.legalName[applicantType];
    case 'registrationNumber':
      return step2.registrationNumber[applicantType];
    case 'representativeName':
      return step2.representativeName[applicantType];
    case 'nationalId':
      return step2.nationalId[applicantType];
    case 'nationality':
      return step2.nationality;
    case 'houseRegistrationNo':
      return step2.houseRegistrationNo;
    case 'addressLine':
      return step2.addressLine;
    case 'subdistrict':
      return step2.subdistrict;
    case 'district':
      return step2.district;
    case 'province':
      return step2.province;
    case 'postalCode':
      return step2.postalCode;
    case 'mobilePhone':
      return step2.mobilePhone;
    case 'email':
      return step2.email;
    case 'lineId':
      return step2.lineId;
    case 'attorneyPositionTh':
      return step2.attorneyPosition;
  }
}

export function siteFieldLabel(field: keyof SiteAndLandDraft): string {
  const step3 = messages.form.step3;
  switch (field) {
    case 'siteAddressLine':
      return `${step3.siteTitle} ${step3.siteAddressLine}`;
    case 'siteSubdistrict':
      return `${step3.siteTitle} ${messages.form.step2.subdistrict}`;
    case 'siteDistrict':
      return `${step3.siteTitle} ${messages.form.step2.district}`;
    case 'siteProvince':
      return `${step3.siteTitle} ${messages.form.step2.province}`;
    case 'sitePostalCode':
      return `${step3.siteTitle} ${messages.form.step2.postalCode}`;
    case 'sitePhone':
      return step3.sitePhone;
    case 'latitude':
      return `${step3.coordinates} ${step3.latitude}`;
    case 'longitude':
      return `${step3.coordinates} ${step3.longitude}`;
    case 'landDocumentType':
      return step3.landDocumentType;
    case 'landDocumentNumber':
      return step3.landDocumentNumber;
    case 'landVolume':
      return step3.landVolume;
    case 'landPage':
      return step3.landPage;
    case 'landIssuedBy':
      return step3.landIssuedBy;
    case 'areaSquareMetres':
      return step3.areaSquareMetres;
    case 'plantsPerCycle':
      return step3.plantsPerCycle;
    case 'cyclesPerYear':
      return step3.cyclesPerYear;
    case 'areaTypes':
      return step3.areaTypesTitle;
    case 'areaTypeOther':
      return step3.areaTypeOther;
    case 'landTenure':
      return step3.landTenure;
    case 'landlordName':
      return step3.landlordName;
    case 'leaseEndsOn':
      return step3.leaseEndsOn;
  }
}

// ป้ายชื่อช่องกรอกจาก key ที่ computeStepProgress() รายงาน
export function fieldLabelForStep(
  step: ApplicationFormStep,
  key: string,
  applicantType: ApplicantType,
): string {
  if (step === 2) return applicantFieldLabel(key as ApplicantIdentityField, applicantType);
  if (step === 3) return siteFieldLabel(key as keyof SiteAndLandDraft);
  if (step === 4) {
    return key === 'purposes'
      ? messages.form.step4.purposesTitle
      : messages.form.step4.materialsTitle;
  }
  return key;
}

export function mimeTypesLabel(slot: DocumentSlotDefinition): string {
  return slot.acceptedMimeTypes
    .map((mimeType) => messages.documentCard.mimeLabels[mimeType] ?? mimeType)
    .join(' ');
}

export function acceptAttribute(slot: DocumentSlotDefinition): string {
  return slot.acceptedMimeTypes.join(',');
}

export function isPhotoSlot(slot: DocumentSlotDefinition): boolean {
  return slot.acceptedMimeTypes.every((mimeType) => mimeType.startsWith('image/'));
}

export function slotLimitsLabel(slot: DocumentSlotDefinition): string {
  return messages.documentCard.limits(
    mimeTypesLabel(slot),
    Math.round(slot.maxFileBytes / (1024 * 1024)),
    slot.maxFiles,
  );
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// เชื่อมรายการเป็นประโยคไทย: "ก" · "ก และ ข" · "ก ข และ ค"
export function joinThai(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(' ')} และ${items[items.length - 1]}`;
}
