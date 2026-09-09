import {
  type ApplicantIdentityField,
  ApplicantType,
  requiredApplicantFields,
} from '@gacp/contracts';
import { saveStep2 } from '@/app/applicant/applications/actions.ts';
import { applicantFieldLabel } from '@/lib/application-form/labels.ts';
import { applicantIdentityOf } from '@/lib/application-form/queries.ts';
import { decryptField, maskNationalId } from '@/lib/protected-fields.ts';
import { formStepTitles, messages } from '@/messages/th.ts';
import { AutosaveForm } from '../autosave-form.tsx';
import { DocumentSlotCard } from '../document-slot-card.tsx';
import { FootNav } from '../form-shell.tsx';
import {
  Card,
  CardHeading,
  FieldLabel,
  Hint,
  LockedValue,
  Tag,
  TextInput,
} from '../primitives.tsx';
import { InThisStepCard, requirementsForStep, TextCard } from '../step-aside.tsx';
import { type StepPageContext, stepPath } from './context.ts';

const STEP = 2;

// ขั้นที่ 2 ตัวตนผู้ขอรับรอง (กทล.1 ส่วนที่ ๑) ช่องกรอกตามประเภทที่เลือก + เอกสารตัวตน/คุณสมบัติ/มอบอำนาจ
export function Step2Main({ context }: { readonly context: StepPageContext }) {
  const { application, user, editable, requirements, highlightMissing } = context;
  const applicantType = application.applicant.type;
  const identity = applicantIdentityOf(application);
  const required = new Set(requiredApplicantFields(applicantType, application.isAttorneyInFact));
  const step2 = messages.form.step2;
  const slotStatuses = requirementsForStep(requirements, STEP);
  const maskedNationalId = application.applicant.nationalIdEncrypted
    ? maskNationalId(decryptField(application.applicant.nationalIdEncrypted))
    : null;

  const isRequired = (field: ApplicantIdentityField) => required.has(field);
  const isMissing = (field: ApplicantIdentityField) =>
    highlightMissing &&
    isRequired(field) &&
    (field === 'nationalId' ? !identity.hasNationalId : !identity[field]);

  const textField = (
    field: Exclude<ApplicantIdentityField, 'nationalId' | 'attorneyPositionTh'>,
    options: {
      readonly span2?: boolean;
      readonly type?: 'text' | 'tel' | 'email';
      readonly hint?: string;
    } = {},
  ) => {
    const label = applicantFieldLabel(field, applicantType);
    if (!label) return null;
    return (
      <div className={options.span2 ? 'md:col-span-2' : ''}>
        <FieldLabel htmlFor={field} required={isRequired(field)} optional={!isRequired(field)}>
          {label}
        </FieldLabel>
        <TextInput
          name={field}
          type={options.type ?? 'text'}
          defaultValue={identity[field]}
          invalid={isMissing(field)}
          maxLength={200}
        />
        {isMissing(field) ? (
          <Hint tone="danger">
            {messages.form.requiredBeforeSubmit}
            {options.hint ? ` ${options.hint}` : ''}
          </Hint>
        ) : options.hint ? (
          <Hint>{options.hint}</Hint>
        ) : null}
      </div>
    );
  };

  const missingCount =
    (context.progress.find((entry) => entry.step === STEP)?.missingFieldKeys.length ?? 0) +
    slotStatuses.filter(
      (status) => !status.satisfied && status.requirement.requirementLevel === 'REQUIRED',
    ).length;

  return (
    <>
      <AutosaveForm
        id="step-2-form"
        action={saveStep2.bind(null, application.id)}
        savedLabel={messages.form.autosaved}
        savingLabel={messages.form.saving}
      >
        <Card>
          <CardHeading
            title={step2.identityTitle[applicantType]}
            reference={step2.identityReference[applicantType]}
            lead={step2.identityLead}
          />
          <div className="grid gap-x-5 gap-y-4 md:grid-cols-2">
            {textField('legalName')}
            {textField('registrationNumber')}
            {textField('representativeName')}
            {applicantType === ApplicantType.COMMUNITY_ENTERPRISE ? textField('nationality') : null}
            {step2.nationalId[applicantType] ? (
              <div>
                <FieldLabel htmlFor="nationalId" required={isRequired('nationalId')}>
                  {step2.nationalId[applicantType]}
                </FieldLabel>
                <TextInput
                  name="nationalId"
                  inputMode="numeric"
                  maxLength={17}
                  placeholder={maskedNationalId ?? step2.nationalIdPlaceholder}
                  invalid={isMissing('nationalId')}
                />
                <Hint tone={isMissing('nationalId') ? 'danger' : 'muted'}>
                  {isMissing('nationalId') ? `${messages.form.requiredBeforeSubmit} ` : ''}
                  {maskedNationalId ? step2.nationalIdKeep(maskedNationalId) : step2.nationalIdHint}
                </Hint>
              </div>
            ) : null}
            {applicantType === ApplicantType.COMMUNITY_ENTERPRISE
              ? textField('houseRegistrationNo', { hint: step2.houseRegistrationHint })
              : null}
            <div className="md:col-span-2">
              <p className="mb-1.5 text-[13px] font-semibold text-ink">
                {step2.address}
                <span className="ml-1 text-danger">*</span>
              </p>
              <div className="grid gap-x-5 gap-y-4 md:grid-cols-2">
                {textField('addressLine', { span2: true })}
                {textField('subdistrict')}
                {textField('district')}
                {textField('province')}
                {textField('postalCode')}
              </div>
            </div>
            {textField('mobilePhone', { type: 'tel' })}
            {textField('email', { type: 'email' })}
            {textField('lineId')}
          </div>
        </Card>

        {application.isAttorneyInFact ? (
          <Card className="mt-4">
            <CardHeading
              title={step2.attorneyTitle}
              reference={step2.attorneyBecause}
              referenceTone="warn"
            />
            <div className="grid gap-x-5 gap-y-4 md:grid-cols-2">
              <div>
                <FieldLabel>{step2.attorneyName}</FieldLabel>
                <LockedValue value={user.displayName} hint={messages.form.lockedFromAccount} />
              </div>
              <div>
                <FieldLabel htmlFor="attorneyPositionTh" required>
                  {step2.attorneyPosition}
                </FieldLabel>
                <TextInput
                  name="attorneyPositionTh"
                  defaultValue={identity.attorneyPositionTh}
                  maxLength={120}
                  invalid={isMissing('attorneyPositionTh')}
                />
                {isMissing('attorneyPositionTh') ? (
                  <Hint tone="danger">{messages.form.requiredBeforeSubmit}</Hint>
                ) : null}
              </div>
            </div>
          </Card>
        ) : null}
      </AutosaveForm>

      <Card className="mt-4">
        <CardHeading title={step2.documentsTitle} lead={step2.documentsLead} />
        {slotStatuses.length === 0 ? (
          <Tag tone="quiet">{messages.form.noDocumentsInStep}</Tag>
        ) : (
          slotStatuses.map((status) => (
            <DocumentSlotCard
              key={status.slot.code}
              status={status}
              applicationId={application.id}
              step={STEP}
              editable={editable}
              errorCode={context.errorSlot === status.slot.code ? context.errorCode : null}
            />
          ))
        )}
      </Card>

      <FootNav
        backHref={stepPath(application.id, 1)}
        backLabel={messages.form.backToStep(1, formStepTitles[1])}
        nextFormId="step-2-form"
        nextLabel={messages.form.nextToStep(3, formStepTitles[3])}
        warning={missingCount > 0 ? messages.form.missingBeforeSubmit(missingCount) : null}
      />
    </>
  );
}

export function Step2Aside({ context }: { readonly context: StepPageContext }) {
  const step2 = messages.form.step2;
  return (
    <>
      <InThisStepCard
        step={STEP}
        progress={context.progress}
        slotStatuses={requirementsForStep(context.requirements, STEP)}
        applicantType={context.application.applicant.type}
      />
      <TextCard title={messages.form.whyTheseDocuments} body={step2.whyBody} />
      <TextCard title={messages.form.privacyTitle} body={messages.form.privacyBody} />
    </>
  );
}
