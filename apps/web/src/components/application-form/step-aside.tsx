import type { ApplicantType, ApplicationFormStep } from '@gacp/contracts';
import { FeeBasis, FeeStage, RequirementLevel } from '@gacp/contracts';
import { formatBahtFromSatang } from '@gacp/ui';
import type { FeeEstimate } from '@/lib/application-form/fee-estimate.ts';
import { fieldLabelForStep } from '@/lib/application-form/labels.ts';
import type { FormRequirements, SlotStatus, StepProgress } from '@/lib/application-form/queries.ts';
import { feeStageLabels, messages } from '@/messages/th.ts';
import { AsideCard, Hint, KeyValueList, Tag } from './primitives.tsx';

// การ์ดแถบข้างที่ใช้ร่วมกันหลายขั้น: ในขั้นนี้ · เพราะคุณเลือก · ค่าใช้จ่ายโดยประมาณ · การ์ดข้อความ

export function InThisStepCard({
  step,
  progress,
  slotStatuses,
  applicantType,
  showDocuments = true,
}: {
  readonly step: ApplicationFormStep;
  readonly progress: readonly StepProgress[];
  readonly slotStatuses: readonly SlotStatus[];
  readonly applicantType: ApplicantType;
  readonly showDocuments?: boolean | undefined;
}) {
  const entry = progress.find((item) => item.step === step);
  const totalFields = entry?.totalFields ?? 0;
  const missingFields = entry?.missingFieldKeys ?? [];
  const doneFields = Math.max(0, totalFields - missingFields.length);
  const required = slotStatuses.filter(
    (status) => status.requirement.requirementLevel === RequirementLevel.REQUIRED,
  );
  const missingSlots = required.filter((status) => !status.satisfied);
  const form = messages.form;
  return (
    <AsideCard title={form.inThisStep}>
      <div className="flex flex-col gap-2 text-[13px]">
        {totalFields > 0 ? (
          <div className="flex items-start gap-2 leading-normal">
            <Tag tone={missingFields.length === 0 ? 'ok' : 'warn'}>
              {doneFields}/{totalFields}
            </Tag>
            <span>
              {missingFields.length === 0
                ? form.fieldsComplete
                : form.fieldsMissingList(
                    missingFields
                      .map((key) => fieldLabelForStep(step, key, applicantType))
                      .join(' '),
                  )}
            </span>
          </div>
        ) : null}
        {showDocuments ? (
          required.length === 0 ? (
            <div className="flex items-start gap-2 leading-normal">
              <Tag tone="quiet">0</Tag>
              <span>{form.noDocumentsInStep}</span>
            </div>
          ) : (
            <div className="flex items-start gap-2 leading-normal">
              <Tag tone={missingSlots.length === 0 ? 'ok' : 'warn'}>
                {required.length - missingSlots.length}/{required.length}
              </Tag>
              <span>
                {missingSlots.length === 0
                  ? form.documentsComplete
                  : form.documentsMissingList(
                      missingSlots.map((status) => status.slot.labelTh).join(' '),
                    )}
              </span>
            </div>
          )
        ) : null}
      </div>
    </AsideCard>
  );
}

const REASON_PREFIX = 'เพราะ';

// จัดกลุ่มช่องบังคับตามเหตุผลของกฎ: "เพราะคุณเช่าที่ดิน → หนังสือยินยอม" · เหตุผลที่ไม่ขึ้นด้วย "เพราะ" รวมเป็น "ทุกราย"
export function BecauseYouChoseCard({
  slotStatuses,
  title = messages.form.becauseYouChose,
  hint,
}: {
  readonly slotStatuses: readonly SlotStatus[];
  readonly title?: string | undefined;
  readonly hint?: string | undefined;
}) {
  const groups = new Map<string, string[]>();
  const everyone: string[] = [];
  for (const status of slotStatuses) {
    if (status.requirement.requirementLevel !== RequirementLevel.REQUIRED) continue;
    const reason = status.requirement.reasonsTh.find((item) => item.startsWith(REASON_PREFIX));
    if (!reason) {
      everyone.push(status.slot.labelTh);
      continue;
    }
    const list = groups.get(reason) ?? [];
    list.push(status.slot.labelTh);
    groups.set(reason, list);
  }
  if (groups.size === 0 && everyone.length === 0) return null;
  const rows: (readonly [string, string])[] = [...groups.entries()].map(
    ([reason, labels]) => [reason.replace(/^เพราะ(คุณ)?/, '').trim(), labels.join(' · ')] as const,
  );
  if (everyone.length > 0) rows.push([messages.form.everyone, everyone.join(' · ')]);
  return (
    <AsideCard title={title}>
      <KeyValueList rows={rows} />
      {hint ? <Hint>{hint}</Hint> : null}
    </AsideCard>
  );
}

export function FeeEstimateCard({ estimates }: { readonly estimates: readonly FeeEstimate[] }) {
  const step1 = messages.form.step1;
  return (
    <AsideCard title={step1.estimateTitle}>
      {estimates.length === 0 ? (
        <p className="text-[13px] leading-relaxed text-muted">{messages.form.noFeeSchedule}</p>
      ) : (
        <>
          <KeyValueList
            rows={estimates.map(
              (estimate) =>
                [
                  feeStageLabels[estimate.stage],
                  <>
                    {estimate.schedule.lineTitleTh}{' '}
                    <b className="text-ink">
                      {formatBahtFromSatang(estimate.perFormat.totals.netSatang, {
                        withUnit: true,
                      })}
                    </b>
                    {estimate.schedule.feeBasis === FeeBasis.PER_CULTIVATION_FORMAT
                      ? ` ${messages.form.perFormat}`
                      : ''}
                  </>,
                ] as const,
            )}
          />
          <Hint>{step1.estimateHint}</Hint>
        </>
      )}
    </AsideCard>
  );
}

export function TextCard({ title, body }: { readonly title: string; readonly body: string }) {
  return (
    <AsideCard title={title}>
      <p className="text-[13px] leading-[1.7] text-muted">{body}</p>
    </AsideCard>
  );
}

export function stage1Amount(estimates: readonly FeeEstimate[]): string | null {
  const stage1 = estimates.find((estimate) => estimate.stage === FeeStage.DOCUMENT_REVIEW);
  if (!stage1?.forSelection) return null;
  return formatBahtFromSatang(stage1.forSelection.totals.netSatang, { withUnit: true });
}

export function requirementsForStep(
  requirements: FormRequirements,
  step: ApplicationFormStep,
): SlotStatus[] {
  return requirements.slotStatuses.filter((status) => status.slot.formStep === step);
}
