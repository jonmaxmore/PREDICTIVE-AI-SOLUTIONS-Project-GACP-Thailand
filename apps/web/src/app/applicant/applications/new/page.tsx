import { RequestType, UserRole } from '@gacp/contracts';
import { FootNav, FormShell } from '@/components/application-form/form-shell.tsx';
import { Note } from '@/components/application-form/primitives.tsx';
import { FeeEstimateCard, TextCard } from '@/components/application-form/step-aside.tsx';
import { STEP1_DEFAULTS, Step1Fields } from '@/components/application-form/steps/step1.tsx';
import { loadFeeEstimates } from '@/lib/application-form/fee-estimate.ts';
import { requireUserWithRole } from '@/lib/current-user.ts';
import { database } from '@/lib/database.ts';
import { formStepTitles, messages } from '@/messages/th.ts';
import { createDraftApplication } from '../actions.ts';

type NewApplicationPageProps = {
  readonly searchParams: Promise<{ readonly error?: string }>;
};

// เริ่มคำขอใหม่ = ขั้นที่ 1 แบบฟอร์มธรรมดา (ยังไม่มีร่างให้ autosave) กดไปขั้นที่ 2 แล้วระบบสร้างร่างพร้อมเลขคำขอ
export default async function NewApplicationPage({ searchParams }: NewApplicationPageProps) {
  const user = await requireUserWithRole(UserRole.APPLICANT, '/applicant/applications/new');
  const [plants, { error }] = await Promise.all([
    database.plant.findMany({
      where: { isActive: true },
      orderBy: { code: 'asc' },
      select: { code: true, nameTh: true },
    }),
    searchParams,
  ]);
  const defaultPlant = plants.find((plant) => plant.code === STEP1_DEFAULTS.plantCode) ?? plants[0];
  const feeEstimates = defaultPlant
    ? await loadFeeEstimates(defaultPlant.code, RequestType.NEW, [])
    : [];
  const step1 = messages.form.step1;

  return (
    <FormShell
      step={1}
      plantNameTh={defaultPlant?.nameTh ?? ''}
      referenceNumber={null}
      applicationId={null}
      progress={null}
      updatedAt={null}
      aside={
        <>
          <TextCard title={messages.form.whatSystemWillAsk} body={step1.whatSystemWillAskPending} />
          <FeeEstimateCard estimates={feeEstimates} />
          <TextCard title={step1.helpTitle} body={step1.helpBody} />
        </>
      }
    >
      {error ? (
        <Note tone="danger" className="mb-4">
          {messages.errors.invalidInput}
        </Note>
      ) : null}
      <form id="step-1-form" action={createDraftApplication}>
        <Step1Fields
          values={{ ...STEP1_DEFAULTS, plantCode: defaultPlant?.code ?? STEP1_DEFAULTS.plantCode }}
          plants={plants}
          userDisplayName={user.displayName}
        />
      </form>
      <FootNav
        backHref="/applicant"
        backLabel={messages.form.back}
        nextFormId="step-1-form"
        nextLabel={messages.form.nextToStep(2, formStepTitles[2])}
      />
    </FormShell>
  );
}
