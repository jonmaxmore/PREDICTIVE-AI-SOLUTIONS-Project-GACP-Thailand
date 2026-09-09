import { DocumentSlotCode, RequirementLevel } from '@gacp/contracts';
import { formStepTitles, messages } from '@/messages/th.ts';
import { DocumentSlotCard } from '../document-slot-card.tsx';
import { FootNav } from '../form-shell.tsx';
import { LicenseSlotCard } from '../license-slot-card.tsx';
import { AsideCard, Card, CardHeading, Hint, KeyValueList, Tag } from '../primitives.tsx';
import { InThisStepCard, requirementsForStep, TextCard } from '../step-aside.tsx';
import { type StepPageContext, stepPath } from './context.ts';

const STEP = 5;

// ขั้นที่ 5 แผนงาน SOP และใบอนุญาต (กทล.1 ส่วนที่ ๓ A5 A6 A8 + สมุนไพรควบคุม) ทั้งหน้าเป็นเอกสารแนบ
export function Step5Main({ context }: { readonly context: StepPageContext }) {
  const { application, editable } = context;
  const step5 = messages.form.step5;
  const slotStatuses = requirementsForStep(context.requirements, STEP);
  const licenses = slotStatuses.filter((status) => status.slot.isLicense);
  const sop = slotStatuses.find((status) => status.slot.code === DocumentSlotCode.SOP_MANUAL);
  const plans = slotStatuses.filter(
    (status) =>
      !status.slot.isLicense &&
      status.slot.code !== DocumentSlotCode.SOP_MANUAL &&
      status.requirement.requirementLevel === RequirementLevel.REQUIRED,
  );
  const optional = slotStatuses.filter(
    (status) =>
      !status.slot.isLicense && status.requirement.requirementLevel === RequirementLevel.OPTIONAL,
  );
  const missingRequired = slotStatuses.filter(
    (status) =>
      status.requirement.requirementLevel === RequirementLevel.REQUIRED && !status.satisfied,
  ).length;
  const errorFor = (slotCode: DocumentSlotCode) =>
    context.errorSlot === slotCode ? context.errorCode : null;
  const licenseReason = licenses.find(
    (status) => status.requirement.requirementLevel === RequirementLevel.REQUIRED,
  )?.requirement.reasonsTh[0];

  return (
    <>
      {plans.length > 0 ? (
        <Card>
          <CardHeading
            title={step5.plansTitle}
            reference={step5.plansReference}
            lead={step5.plansLead}
          />
          {plans.map((status) => (
            <DocumentSlotCard
              key={status.slot.code}
              status={status}
              applicationId={application.id}
              step={STEP}
              editable={editable}
              errorCode={errorFor(status.slot.code)}
            />
          ))}
        </Card>
      ) : null}

      {sop ? (
        <Card className="mt-4">
          <CardHeading title={step5.sopTitle} reference={step5.sopReference} />
          <DocumentSlotCard
            status={sop}
            applicationId={application.id}
            step={STEP}
            editable={editable}
            errorCode={errorFor(sop.slot.code)}
          />
        </Card>
      ) : null}

      {licenses.length > 0 ? (
        <Card className="mt-4">
          <CardHeading
            title={step5.licensesTitle}
            reference={licenseReason}
            referenceTone="warn"
            lead={step5.licensesLead}
          />
          {licenses.map((status) => (
            <LicenseSlotCard
              key={status.slot.code}
              status={status}
              applicationId={application.id}
              step={STEP}
              editable={editable}
              errorCode={errorFor(status.slot.code)}
            />
          ))}
        </Card>
      ) : null}

      {optional.length > 0 ? (
        <Card className="mt-4">
          <CardHeading title={step5.optionalTitle} lead={step5.optionalLead} />
          <div className="grid gap-2.5 md:grid-cols-2">
            {optional.map((status) => (
              <div key={status.slot.code} className="[&>div]:mt-0">
                <DocumentSlotCard
                  status={status}
                  applicationId={application.id}
                  step={STEP}
                  editable={editable}
                  errorCode={errorFor(status.slot.code)}
                  compact
                />
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {slotStatuses.length === 0 ? (
        <Card>
          <Tag tone="quiet">{messages.form.noDocumentsInStep}</Tag>
        </Card>
      ) : null}

      <FootNav
        backHref={stepPath(application.id, 4)}
        backLabel={messages.form.backToStep(4, formStepTitles[4])}
        nextHref={stepPath(application.id, 6)}
        nextLabel={messages.form.nextToStep(6, formStepTitles[6])}
        warning={missingRequired > 0 ? messages.form.missingBeforeSubmit(missingRequired) : null}
      />
    </>
  );
}

export function Step5Aside({ context }: { readonly context: StepPageContext }) {
  const step5 = messages.form.step5;
  const slotStatuses = requirementsForStep(context.requirements, STEP);
  return (
    <>
      <InThisStepCard
        step={STEP}
        progress={context.progress}
        slotStatuses={slotStatuses.filter((status) => !status.slot.isLicense)}
        applicantType={context.application.applicant.type}
      />
      <AsideCard title={step5.licenseKindsTitle}>
        <KeyValueList rows={step5.licenseKinds.map(([code, label]) => [code, label] as const)} />
        <Hint>{step5.licenseKindsHint}</Hint>
      </AsideCard>
      <TextCard title={step5.whySopSingleTitle} body={step5.whySopSingleBody} />
    </>
  );
}
