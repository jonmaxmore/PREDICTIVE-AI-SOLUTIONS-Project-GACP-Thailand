import { ApplicantType, CertificationScope, RequestType } from '@gacp/contracts';
import { saveStep1 } from '@/app/applicant/applications/actions.ts';
import {
  applicantTypeDescriptions,
  applicantTypeLabels,
  certificationScopeDescriptions,
  certificationScopeLabels,
  formStepTitles,
  messages,
  requestTypeDescriptions,
  requestTypeLabels,
} from '@/messages/th.ts';
import { AutosaveForm } from '../autosave-form.tsx';
import { FootNav } from '../form-shell.tsx';
import {
  Card,
  CardHeading,
  ChoiceCard,
  Divider,
  FieldLabel,
  Hint,
  Pill,
  TextInput,
} from '../primitives.tsx';
import { BecauseYouChoseCard, FeeEstimateCard, TextCard } from '../step-aside.tsx';
import { type PlantOption, type StepPageContext, stepPath } from './context.ts';

export type Step1Values = {
  readonly requestType: RequestType;
  readonly certificationScope: CertificationScope;
  readonly plantCode: string;
  readonly applicantType: ApplicantType;
  readonly isAttorneyInFact: boolean;
  readonly previousCertificateNumber: string | null;
};

export const STEP1_DEFAULTS: Step1Values = {
  requestType: RequestType.NEW,
  certificationScope: CertificationScope.CULTIVATION,
  plantCode: 'cannabis',
  applicantType: ApplicantType.COMMUNITY_ENTERPRISE,
  isAttorneyInFact: false,
  previousCertificateNumber: null,
};

// ช่องกรอกของขั้นที่ 1 ใช้ทั้งตอนเริ่มคำขอใหม่ (ฟอร์มธรรมดา) และแก้คำขอที่มีอยู่ (autosave)
export function Step1Fields({
  values,
  plants,
  userDisplayName,
}: {
  readonly values: Step1Values;
  readonly plants: readonly PlantOption[];
  readonly userDisplayName: string;
}) {
  const step1 = messages.form.step1;
  return (
    <>
      <Card>
        <CardHeading title={step1.requestTypeTitle} lead={step1.requestTypeLead} />
        <div className="grid gap-3 md:grid-cols-3">
          {Object.values(RequestType).map((value) => (
            <ChoiceCard
              key={value}
              name="requestType"
              value={value}
              checked={values.requestType === value}
              title={requestTypeLabels[value]}
              description={requestTypeDescriptions[value]}
            />
          ))}
        </div>
        <Divider />
        <h3 className="text-[17px] font-bold text-forest-green">{step1.scopeTitle}</h3>
        <div className="mt-2.5 grid gap-3 md:grid-cols-2">
          {Object.values(CertificationScope).map((value) => (
            <ChoiceCard
              key={value}
              name="certificationScope"
              value={value}
              checked={values.certificationScope === value}
              title={certificationScopeLabels[value]}
              description={certificationScopeDescriptions[value]}
            />
          ))}
        </div>
        <Hint>{step1.scopeHint}</Hint>
        <Divider />
        <h3 className="text-[17px] font-bold text-forest-green">{step1.plantTitle}</h3>
        <div className="mt-2.5 flex flex-wrap items-center gap-2.5">
          {plants.map((plant) => (
            <Pill
              key={plant.code}
              type="radio"
              name="plantCode"
              value={plant.code}
              checked={values.plantCode === plant.code}
              label={plant.nameTh}
            />
          ))}
          <span className="text-xs text-muted">{step1.plantHint}</span>
        </div>
      </Card>

      <Card className="mt-4">
        <CardHeading title={step1.applicantTypeTitle} lead={step1.applicantTypeLead} />
        <div className="grid gap-3 md:grid-cols-3">
          {Object.values(ApplicantType).map((value) => (
            <ChoiceCard
              key={value}
              name="applicantType"
              value={value}
              checked={values.applicantType === value}
              title={applicantTypeLabels[value]}
              description={applicantTypeDescriptions[value]}
            />
          ))}
        </div>
        <Divider />
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            name="isAttorneyInFact"
            defaultChecked={values.isAttorneyInFact}
            className="mt-1 h-[18px] w-[18px] rounded accent-leaf"
          />
          <span>
            <span className="block text-sm font-semibold text-ink">{step1.attorneyLabel}</span>
            <Hint>{step1.attorneyHint(userDisplayName)}</Hint>
          </span>
        </label>
        {values.requestType !== RequestType.NEW ? (
          <div className="mt-4 max-w-sm">
            <FieldLabel htmlFor="previousCertificateNumber" optional>
              {step1.previousCertificateLabel}
            </FieldLabel>
            <TextInput
              name="previousCertificateNumber"
              defaultValue={values.previousCertificateNumber}
              maxLength={40}
            />
            <Hint>{step1.previousCertificateHint}</Hint>
          </div>
        ) : null}
      </Card>
    </>
  );
}

export function Step1Main({
  context,
  plants,
}: {
  readonly context: StepPageContext;
  readonly plants: readonly PlantOption[];
}) {
  const { application, user } = context;
  const values: Step1Values = {
    requestType: application.requestType,
    certificationScope: application.certificationScope,
    plantCode: application.plantCode,
    applicantType: application.applicant.type,
    isAttorneyInFact: application.isAttorneyInFact,
    previousCertificateNumber: application.previousCertificateNumber,
  };
  return (
    <>
      <AutosaveForm
        id="step-1-form"
        action={saveStep1.bind(null, application.id)}
        savedLabel={messages.form.autosaved}
        savingLabel={messages.form.saving}
      >
        <Step1Fields values={values} plants={plants} userDisplayName={user.displayName} />
      </AutosaveForm>
      <FootNav
        backHref="/applicant"
        backLabel={messages.form.saveAndExit}
        nextFormId="step-1-form"
        nextLabel={messages.form.nextToStep(2, formStepTitles[2])}
      />
    </>
  );
}

export function Step1Aside({ context }: { readonly context: StepPageContext }) {
  const step1 = messages.form.step1;
  return (
    <>
      <BecauseYouChoseCard
        slotStatuses={context.requirements.slotStatuses}
        title={messages.form.whatSystemWillAsk}
        hint={step1.whatSystemWillAskHint}
      />
      <FeeEstimateCard estimates={context.feeEstimates} />
      <TextCard title={step1.helpTitle} body={step1.helpBody} />
    </>
  );
}

export function step1NextPath(applicationId: string): string {
  return stepPath(applicationId, 2);
}
