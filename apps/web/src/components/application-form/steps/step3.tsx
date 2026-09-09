import {
  AreaType,
  DocumentSlotCode,
  LandTenure,
  REQUIRED_SITE_AND_LAND_FIELDS,
  RequirementLevel,
  type SiteAndLandDraft,
} from '@gacp/contracts';
import { saveStep3 } from '@/app/applicant/applications/actions.ts';
import { joinThai } from '@/lib/application-form/labels.ts';
import { siteAndLandOf } from '@/lib/application-form/queries.ts';
import {
  areaTypeLabels,
  areaTypeShortLabels,
  formStepTitles,
  landTenureLabels,
  messages,
} from '@/messages/th.ts';
import { AutosaveForm } from '../autosave-form.tsx';
import { DocumentSlotCard } from '../document-slot-card.tsx';
import { FootNav } from '../form-shell.tsx';
import {
  Card,
  CardHeading,
  FieldLabel,
  Hint,
  LockedValue,
  Note,
  Pill,
  TextInput,
} from '../primitives.tsx';
import {
  BecauseYouChoseCard,
  InThisStepCard,
  requirementsForStep,
  stage1Amount,
  TextCard,
} from '../step-aside.tsx';
import { UseCurrentLocationButton } from '../use-current-location-button.tsx';
import { type StepPageContext, stepPath } from './context.ts';

const STEP = 3;
const REQUIRED_FIELDS = new Set<keyof SiteAndLandDraft>(REQUIRED_SITE_AND_LAND_FIELDS);

function needsLandlord(tenure: LandTenure | null | undefined): boolean {
  return tenure === LandTenure.RENTED || tenure === LandTenure.OWNER_PERMITTED;
}

// ขั้นที่ 3 สถานที่และที่ดิน (กทล.1 ส่วนที่ ๒ ข้อ ๑ ถึง ๒) + ลักษณะพื้นที่ + เอกสารที่ปรับตามคำตอบ
export function Step3Main({ context }: { readonly context: StepPageContext }) {
  const { application, editable, requirements, highlightMissing, feeEstimates } = context;
  const values = siteAndLandOf(application);
  const step3 = messages.form.step3;
  const slotStatuses = requirementsForStep(requirements, STEP);
  const isMissing = (field: keyof SiteAndLandDraft) => {
    if (!highlightMissing) return false;
    const value = values[field];
    const blank =
      value === null ||
      value === undefined ||
      value === '' ||
      (Array.isArray(value) && value.length === 0);
    if (field === 'landlordName') return needsLandlord(values.landTenure) && blank;
    if (field === 'areaTypeOther') return values.areaTypes.includes(AreaType.OTHER) && blank;
    return REQUIRED_FIELDS.has(field) && blank;
  };
  const missingHint = (field: keyof SiteAndLandDraft) =>
    isMissing(field) ? <Hint tone="danger">{messages.form.requiredBeforeSubmit}</Hint> : null;

  const reasonLabels = [
    ...(values.landTenure ? [landTenureLabels[values.landTenure]] : []),
    ...values.areaTypes.map((areaType) => areaTypeShortLabels[areaType]),
  ];
  const requiredSlots = slotStatuses.filter(
    (status) => status.requirement.requirementLevel === RequirementLevel.REQUIRED,
  );
  const missingSlots = requiredSlots.filter((status) => !status.satisfied);
  const contextNoteFor = (slotCode: DocumentSlotCode): string | null => {
    if (slotCode === DocumentSlotCode.LANDLORD_CONSENT_LETTER && values.landlordName) {
      return step3.consentBy(values.landlordName);
    }
    if (slotCode === DocumentSlotCode.LAND_RIGHTS_DOCUMENT && values.landDocumentNumber) {
      return step3.landNumberMustMatch(values.landDocumentNumber);
    }
    return null;
  };

  return (
    <>
      <AutosaveForm
        id="step-3-form"
        action={saveStep3.bind(null, application.id)}
        savedLabel={messages.form.autosaved}
        savingLabel={messages.form.saving}
      >
        <Card>
          <CardHeading
            title={step3.siteTitle}
            reference={step3.siteReference}
            lead={step3.siteLead}
          />
          <div className="grid gap-x-5 gap-y-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <FieldLabel>{step3.siteName}</FieldLabel>
              <LockedValue
                value={application.applicant.legalName}
                hint={
                  application.applicant.legalName ? step3.siteNameLocked : step3.siteNamePending
                }
              />
            </div>
            <div className="md:col-span-2">
              <FieldLabel htmlFor="siteAddressLine" required>
                {step3.siteAddressLine}
              </FieldLabel>
              <TextInput
                name="siteAddressLine"
                defaultValue={values.siteAddressLine}
                maxLength={200}
                invalid={isMissing('siteAddressLine')}
              />
              {missingHint('siteAddressLine')}
            </div>
            <div>
              <FieldLabel htmlFor="siteSubdistrict" required>
                {messages.form.step2.subdistrict}
              </FieldLabel>
              <TextInput
                name="siteSubdistrict"
                defaultValue={values.siteSubdistrict}
                maxLength={100}
                invalid={isMissing('siteSubdistrict')}
              />
              {missingHint('siteSubdistrict')}
            </div>
            <div>
              <FieldLabel htmlFor="siteDistrict" required>
                {messages.form.step2.district}
              </FieldLabel>
              <TextInput
                name="siteDistrict"
                defaultValue={values.siteDistrict}
                maxLength={100}
                invalid={isMissing('siteDistrict')}
              />
              {missingHint('siteDistrict')}
            </div>
            <div>
              <FieldLabel htmlFor="siteProvince" required>
                {messages.form.step2.province}
              </FieldLabel>
              <TextInput
                name="siteProvince"
                defaultValue={values.siteProvince}
                maxLength={100}
                invalid={isMissing('siteProvince')}
              />
              {missingHint('siteProvince')}
            </div>
            <div>
              <FieldLabel htmlFor="sitePostalCode" required>
                {messages.form.step2.postalCode}
              </FieldLabel>
              <TextInput
                name="sitePostalCode"
                inputMode="numeric"
                defaultValue={values.sitePostalCode}
                maxLength={5}
                invalid={isMissing('sitePostalCode')}
              />
              {missingHint('sitePostalCode')}
            </div>
            <div>
              <FieldLabel htmlFor="sitePhone" required>
                {step3.sitePhone}
              </FieldLabel>
              <TextInput
                name="sitePhone"
                type="tel"
                defaultValue={values.sitePhone}
                maxLength={20}
                invalid={isMissing('sitePhone')}
              />
              {missingHint('sitePhone')}
            </div>
            <div>
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <FieldLabel htmlFor="latitude" required>
                  {step3.coordinates}
                </FieldLabel>
                <UseCurrentLocationButton
                  label={step3.useCurrentLocation}
                  unavailableLabel={step3.locationUnavailable}
                  latitudeInputId="latitude"
                  longitudeInputId="longitude"
                />
              </div>
              <div className="flex gap-2">
                <TextInput
                  name="latitude"
                  inputMode="decimal"
                  placeholder={step3.latitude}
                  defaultValue={values.latitude}
                  invalid={isMissing('latitude')}
                />
                <TextInput
                  name="longitude"
                  inputMode="decimal"
                  placeholder={step3.longitude}
                  defaultValue={values.longitude}
                  invalid={isMissing('longitude')}
                />
              </div>
              <Hint>{step3.coordinatesHint}</Hint>
              {missingHint('latitude')}
            </div>
            <div>
              <FieldLabel htmlFor="areaSquareMetres" required>
                {step3.areaSquareMetres}
              </FieldLabel>
              <TextInput
                name="areaSquareMetres"
                inputMode="decimal"
                defaultValue={values.areaSquareMetres}
                invalid={isMissing('areaSquareMetres')}
              />
              {missingHint('areaSquareMetres')}
            </div>
            <div>
              <FieldLabel htmlFor="plantsPerCycle" required>
                {step3.plantsPerCycle}
              </FieldLabel>
              <TextInput
                name="plantsPerCycle"
                inputMode="numeric"
                placeholder={step3.plantsPerCycleUnit}
                defaultValue={values.plantsPerCycle}
                invalid={isMissing('plantsPerCycle')}
              />
              {missingHint('plantsPerCycle')}
            </div>
            <div>
              <FieldLabel htmlFor="cyclesPerYear" required>
                {step3.cyclesPerYear}
              </FieldLabel>
              <TextInput
                name="cyclesPerYear"
                inputMode="numeric"
                placeholder={step3.cyclesPerYearUnit}
                defaultValue={values.cyclesPerYear}
                invalid={isMissing('cyclesPerYear')}
              />
              {missingHint('cyclesPerYear')}
            </div>
          </div>
        </Card>

        <Card className="mt-4">
          <CardHeading title={step3.landTitle} reference={step3.landReference} />
          <div className="grid gap-x-5 gap-y-4 md:grid-cols-2">
            <div>
              <FieldLabel htmlFor="landDocumentType" required>
                {step3.landDocumentType}
              </FieldLabel>
              <TextInput
                name="landDocumentType"
                placeholder={step3.landDocumentTypePlaceholder}
                defaultValue={values.landDocumentType}
                maxLength={100}
                invalid={isMissing('landDocumentType')}
              />
              {missingHint('landDocumentType')}
            </div>
            <div>
              <FieldLabel htmlFor="landDocumentNumber" required>
                {step3.landDocumentNumber}
              </FieldLabel>
              <div className="grid grid-cols-[2fr_1fr_1fr] gap-2">
                <TextInput
                  name="landDocumentNumber"
                  defaultValue={values.landDocumentNumber}
                  maxLength={60}
                  invalid={isMissing('landDocumentNumber')}
                />
                <TextInput
                  name="landVolume"
                  placeholder={step3.landVolume}
                  defaultValue={values.landVolume}
                  maxLength={30}
                />
                <TextInput
                  name="landPage"
                  placeholder={step3.landPage}
                  defaultValue={values.landPage}
                  maxLength={30}
                />
              </div>
              {missingHint('landDocumentNumber')}
            </div>
            <div className="md:col-span-2">
              <FieldLabel htmlFor="landIssuedBy" required>
                {step3.landIssuedBy}
              </FieldLabel>
              <TextInput
                name="landIssuedBy"
                defaultValue={values.landIssuedBy}
                maxLength={200}
                invalid={isMissing('landIssuedBy')}
              />
              {missingHint('landIssuedBy')}
            </div>
          </div>
          <div className="mt-[18px]">
            <FieldLabel required>{step3.landTenure}</FieldLabel>
            <div className="mt-2 flex flex-wrap gap-2.5">
              {Object.values(LandTenure).map((value) => (
                <Pill
                  key={value}
                  type="radio"
                  name="landTenure"
                  value={value}
                  checked={values.landTenure === value}
                  label={landTenureLabels[value]}
                />
              ))}
            </div>
            {missingHint('landTenure')}
            {needsLandlord(values.landTenure) ? (
              <div className="mt-3.5 grid gap-x-5 gap-y-4 md:grid-cols-2">
                <div>
                  <FieldLabel htmlFor="landlordName" required>
                    {step3.landlordName}
                  </FieldLabel>
                  <TextInput
                    name="landlordName"
                    defaultValue={values.landlordName}
                    maxLength={200}
                    invalid={isMissing('landlordName')}
                  />
                  {missingHint('landlordName')}
                </div>
                <div>
                  <FieldLabel htmlFor="leaseEndsOn" optional>
                    {step3.leaseEndsOn}
                  </FieldLabel>
                  <TextInput name="leaseEndsOn" type="date" defaultValue={values.leaseEndsOn} />
                </div>
              </div>
            ) : null}
          </div>
        </Card>

        <Card className="mt-4">
          <CardHeading
            title={
              <>
                {step3.areaTypesTitle}{' '}
                <span className="text-[13px] font-normal text-quiet">
                  {messages.form.chooseOneOrMore}
                </span>
              </>
            }
          />
          <div className="flex flex-wrap gap-2.5">
            {Object.values(AreaType).map((value) => (
              <Pill
                key={value}
                name="areaTypes"
                value={value}
                checked={values.areaTypes.includes(value)}
                label={areaTypeLabels[value]}
              />
            ))}
          </div>
          {missingHint('areaTypes')}
          {values.areaTypes.includes(AreaType.OTHER) ? (
            <div className="mt-3.5 max-w-md">
              <FieldLabel htmlFor="areaTypeOther" required>
                {step3.areaTypeOther}
              </FieldLabel>
              <TextInput
                name="areaTypeOther"
                defaultValue={values.areaTypeOther}
                maxLength={120}
                invalid={isMissing('areaTypeOther')}
              />
              {missingHint('areaTypeOther')}
            </div>
          ) : null}
          {values.areaTypes.length > 0 ? (
            <Note tone="info" className="mt-3.5">
              {step3.formatsNote(values.areaTypes.length, stage1Amount(feeEstimates))}
            </Note>
          ) : null}
        </Card>
      </AutosaveForm>

      <Card className="mt-4">
        <CardHeading
          title={step3.documentsTitle}
          lead={
            reasonLabels.length > 0
              ? step3.documentsLead(slotStatuses.length, joinThai(reasonLabels))
              : step3.documentsLeadNoChoice
          }
        />
        {slotStatuses.map((status) => (
          <DocumentSlotCard
            key={status.slot.code}
            status={status}
            applicationId={application.id}
            step={STEP}
            editable={editable}
            errorCode={context.errorSlot === status.slot.code ? context.errorCode : null}
            contextNote={contextNoteFor(status.slot.code)}
          />
        ))}
        <Note tone="quiet" className="mt-3.5">
          {step3.noOverAsking}
        </Note>
      </Card>

      <FootNav
        backHref={stepPath(application.id, 2)}
        backLabel={messages.form.backToStep(2, formStepTitles[2])}
        nextFormId="step-3-form"
        nextLabel={messages.form.nextToStep(4, formStepTitles[4])}
        warning={
          missingSlots.length > 0 ? messages.form.missingBeforeSubmit(missingSlots.length) : null
        }
      />
    </>
  );
}

export function Step3Aside({ context }: { readonly context: StepPageContext }) {
  const slotStatuses = requirementsForStep(context.requirements, STEP);
  return (
    <>
      <InThisStepCard
        step={STEP}
        progress={context.progress}
        slotStatuses={slotStatuses}
        applicantType={context.application.applicant.type}
      />
      <BecauseYouChoseCard slotStatuses={slotStatuses} />
      <TextCard
        title={messages.form.step3.whySiteNameLocked}
        body={messages.form.step3.whySiteNameLockedBody}
      />
    </>
  );
}
