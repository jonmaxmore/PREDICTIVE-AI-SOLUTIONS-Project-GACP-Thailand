import { type ApplicationFormStep, applicationFormStepSchema, UserRole } from '@gacp/contracts';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { z } from 'zod';
import { FormShell } from '@/components/application-form/form-shell.tsx';
import { Note } from '@/components/application-form/primitives.tsx';
import {
  type PlantOption,
  type StepPageContext,
  stepPath,
} from '@/components/application-form/steps/context.ts';
import { Step1Aside, Step1Main } from '@/components/application-form/steps/step1.tsx';
import { Step2Aside, Step2Main } from '@/components/application-form/steps/step2.tsx';
import { Step3Aside, Step3Main } from '@/components/application-form/steps/step3.tsx';
import { Step4Aside, Step4Main } from '@/components/application-form/steps/step4.tsx';
import { Step5Aside, Step5Main } from '@/components/application-form/steps/step5.tsx';
import { Step6Aside, Step6Main, step6Header } from '@/components/application-form/steps/step6.tsx';
import { loadFeeEstimates } from '@/lib/application-form/fee-estimate.ts';
import {
  computeStepProgress,
  isEditableDraft,
  loadFormRequirements,
  loadOwnedApplication,
} from '@/lib/application-form/queries.ts';
import { requireUserWithRole } from '@/lib/current-user.ts';
import { database } from '@/lib/database.ts';
import { formStepTitles, messages } from '@/messages/th.ts';

type StepPageProps = {
  readonly params: Promise<{ readonly applicationId: string; readonly step: string }>;
  readonly searchParams: Promise<{
    readonly error?: string;
    readonly slot?: string;
    readonly highlight?: string;
  }>;
};

function parseStep(raw: string): ApplicationFormStep | null {
  const parsed = applicationFormStepSchema.safeParse(raw);
  return parsed.success ? (parsed.data as ApplicationFormStep) : null;
}

export async function generateMetadata({ params }: StepPageProps): Promise<Metadata> {
  const { step } = await params;
  const parsed = parseStep(step);
  return {
    title: parsed
      ? `${messages.form.stepOf(parsed)} ${formStepTitles[parsed]}`
      : messages.form.applicationLabel,
  };
}

type StepView = {
  readonly main: ReactNode;
  readonly aside: ReactNode;
  readonly titleTag?: ReactNode;
  readonly headerChip?: ReactNode;
};

function renderStep(
  step: ApplicationFormStep,
  context: StepPageContext,
  plants: readonly PlantOption[],
): StepView {
  switch (step) {
    case 1:
      return {
        main: <Step1Main context={context} plants={plants} />,
        aside: <Step1Aside context={context} />,
      };
    case 2:
      return { main: <Step2Main context={context} />, aside: <Step2Aside context={context} /> };
    case 3:
      return { main: <Step3Main context={context} />, aside: <Step3Aside context={context} /> };
    case 4:
      return { main: <Step4Main context={context} />, aside: <Step4Aside context={context} /> };
    case 5:
      return { main: <Step5Main context={context} />, aside: <Step5Aside context={context} /> };
    case 6:
      return {
        main: <Step6Main context={context} />,
        aside: <Step6Aside context={context} />,
        ...step6Header(context),
      };
  }
}

// หน้าฟอร์มขั้นที่ N ของคำขอหนึ่งฉบับ: โหลดคำขอของเจ้าของ ตัดสินเอกสารบังคับด้วย lens เดียว แล้วส่งให้ขั้นนั้นวาด
export default async function ApplicationStepPage({ params, searchParams }: StepPageProps) {
  const { applicationId, step: rawStep } = await params;
  const step = parseStep(rawStep);
  if (!step || !z.uuid().safeParse(applicationId).success) notFound();

  const user = await requireUserWithRole(UserRole.APPLICANT, stepPath(applicationId, step));
  const application = await loadOwnedApplication(applicationId, user.id);
  if (!application) notFound();

  const [requirements, feeEstimates, query] = await Promise.all([
    loadFormRequirements(application),
    loadFeeEstimates(application.plantCode, application.requestType, application.areaTypes),
    searchParams,
  ]);
  const progress = computeStepProgress(application, requirements);
  const context: StepPageContext = {
    application,
    requirements,
    progress,
    user,
    editable: isEditableDraft(application),
    feeEstimates,
    errorCode: query.error ?? null,
    errorSlot: query.slot ?? null,
    highlightMissing: query.highlight === 'missing',
  };
  const plants: PlantOption[] =
    step === 1
      ? await database.plant.findMany({
          where: { isActive: true },
          orderBy: { code: 'asc' },
          select: { code: true, nameTh: true },
        })
      : [];
  const view = renderStep(step, context, plants);

  return (
    <FormShell
      step={step}
      plantNameTh={application.plant.nameTh}
      referenceNumber={application.referenceNumber}
      applicationId={application.id}
      progress={progress}
      updatedAt={application.updatedAt}
      titleTag={view.titleTag}
      headerChip={view.headerChip}
      aside={view.aside}
    >
      {!context.editable ? (
        <Note tone="info" className="mb-4">
          {messages.applicantHome.notEditableNotice}
        </Note>
      ) : null}
      {context.errorCode === 'invalid' ? (
        <Note tone="danger" className="mb-4">
          {messages.errors.invalidInput}
        </Note>
      ) : null}
      {view.main}
    </FormShell>
  );
}
