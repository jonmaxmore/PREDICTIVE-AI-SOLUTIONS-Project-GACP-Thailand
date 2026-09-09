import {
  type ApplicationFormStep,
  FeeStage,
  KATORLOR1_PLANT_MATERIAL_ROWS,
  RequirementLevel,
} from '@gacp/contracts';
import { formatBahtFromSatang } from '@gacp/ui';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { fieldLabelForStep } from '@/lib/application-form/labels.ts';
import { decryptField, maskNationalId } from '@/lib/protected-fields.ts';
import {
  areaTypeShortLabels,
  landTenureLabels,
  licenseSlotStateLabels,
  messages,
  purposeLabels,
} from '@/messages/th.ts';
import { FootNav } from '../form-shell.tsx';
import { AsideCard, Card, Hint, Note, smallButtonDangerClassName, Tag } from '../primitives.tsx';
import { type StepPageContext, stepPath } from './context.ts';

const STEP = 6;

type MissingItem = {
  readonly kind: 'field' | 'document';
  readonly step: ApplicationFormStep;
  readonly label: string;
};

function collectMissingItems(context: StepPageContext): MissingItem[] {
  const { application, requirements, progress } = context;
  const applicantType = application.applicant.type;
  const fieldItems: MissingItem[] = progress.flatMap((entry) =>
    entry.missingFieldKeys.map((key) => ({
      kind: 'field' as const,
      step: entry.step,
      label: fieldLabelForStep(entry.step, key, applicantType),
    })),
  );
  const documentItems: MissingItem[] = requirements.missingRequired.flatMap((slotCode) => {
    const status = requirements.slotStatuses.find((entry) => entry.slot.code === slotCode);
    if (!status) return [];
    return [
      {
        kind: 'document' as const,
        step: status.slot.formStep as ApplicationFormStep,
        label: status.slot.labelTh,
      },
    ];
  });
  return [...fieldItems, ...documentItems].sort((left, right) => left.step - right.step);
}

export function step6Header(context: StepPageContext): {
  readonly titleTag: ReactNode;
  readonly headerChip: ReactNode;
} {
  const blocked = !context.requirements.judgeable || collectMissingItems(context).length > 0;
  const step6 = messages.form.step6;
  return {
    titleTag: (
      <Tag tone={blocked ? 'danger' : 'ok'} className="px-3 py-1 text-[13px]">
        {blocked ? step6.blockedTag : step6.readyTag}
      </Tag>
    ),
    headerChip: (
      <Tag tone="quiet" className="px-3 py-1.5 text-[12.5px]">
        {step6.serverTruth}
      </Tag>
    ),
  };
}

// ขั้นที่ 6 ตรวจทานหน้าเดียว: รายการที่ขาด (ความจริงจาก server) พาไปแก้ที่ขั้นนั้น + แบบ กทล.1 ที่ระบบประกอบ (สรุป)
// คำรับรอง ๕+๑ และการยืนยันไปใบเสนอราคาเปิดใช้ใน M3
export function Step6Main({ context }: { readonly context: StepPageContext }) {
  const { application, requirements, feeEstimates } = context;
  const step6 = messages.form.step6;
  const items = collectMissingItems(context);
  const blocked = !requirements.judgeable || items.length > 0;
  const applicant = application.applicant;
  const masked = applicant.nationalIdEncrypted
    ? maskNationalId(decryptField(applicant.nationalIdEncrypted))
    : null;
  const stage1 = feeEstimates.find((estimate) => estimate.stage === FeeStage.DOCUMENT_REVIEW);
  const netAmount = stage1?.forSelection
    ? formatBahtFromSatang(stage1.forSelection.totals.netSatang, { withUnit: true })
    : null;
  const requiredStatuses = requirements.slotStatuses.filter(
    (status) => status.requirement.requirementLevel === RequirementLevel.REQUIRED,
  );
  const licenseStatuses = requirements.slotStatuses.filter(
    (status) => status.slot.isLicense && status.licenseState,
  );
  const missingValue = <span className="font-bold text-danger">{messages.form.notFilled}</span>;
  const show = (value: string | null | undefined) => (value ? value : missingValue);

  return (
    <>
      {!requirements.judgeable ? (
        <Note tone="danger" className="mb-4">
          {step6.notJudgeable}
        </Note>
      ) : null}

      {items.length > 0 ? (
        <section className="rounded-lg border-[1.5px] border-[#f2c9c9] bg-surface shadow-card">
          <header className="rounded-t-lg border-b border-[#f2c9c9] bg-danger-tint px-[22px] py-[18px]">
            <h2 className="text-[17px] font-bold text-danger">
              {step6.blockedTitle(items.length)}
            </h2>
            <p className="mt-0.5 text-[13px] text-[#5c3333]">{step6.blockedLead}</p>
          </header>
          <ul className="px-[22px] pt-1.5 pb-3.5">
            {items.map((item, index) => (
              <li
                key={`${item.kind}-${item.step}-${item.label}`}
                className={`flex flex-wrap items-center justify-between gap-3 py-[11px] ${index < items.length - 1 ? 'border-b border-dashed border-border-soft' : ''}`}
              >
                <span className="text-[13px]">
                  <Tag tone="quiet" className="mr-2">
                    {item.kind === 'field' ? step6.kindField : step6.kindDocument}
                  </Tag>
                  {item.kind === 'field'
                    ? step6.fieldMissing(item.label)
                    : step6.documentMissing(item.label)}
                </span>
                <Link
                  href={`${stepPath(application.id, item.step)}?highlight=missing`}
                  className={smallButtonDangerClassName}
                >
                  {item.kind === 'field' ? step6.goFill(item.step) : step6.goAttach(item.step)}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <Note tone="ok">{step6.readyTitle}</Note>
      )}

      <Card className={`mt-4 ${blocked ? 'opacity-75' : ''}`}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3 border-b-2 border-forest-green pb-2.5">
          <div>
            <h2 className="text-[17px] font-bold text-forest-green">{step6.katorlorTitle}</h2>
            <p className="text-xs text-muted">{step6.katorlorSubtitle}</p>
          </div>
          <Tag tone={blocked ? 'warn' : 'ok'} className="px-2.5 py-1">
            {blocked ? step6.katorlorDraftTag : step6.katorlorReadyTag}
          </Tag>
        </div>
        <div className="text-[13px] leading-[1.9] text-ink-soft">
          <p>
            <b>{step6.part1}</b> {show(applicant.legalName)}
            {applicant.representativeName ? ` · ${applicant.representativeName}` : ''}
            {applicant.registrationNumber ? ` · ${applicant.registrationNumber}` : ''}
            {messages.form.step2.nationalId[applicant.type] ? (
              <>
                {' · '}
                {messages.form.step2.nationalId[applicant.type]} {masked ?? missingValue}
              </>
            ) : null}
            {application.isAttorneyInFact
              ? ` · ${step6.attorneyApplicant(context.user.displayName)}`
              : ''}
          </p>
          <p>
            <b>{step6.part2}</b>{' '}
            {application.purposes.length > 0
              ? application.purposes.map((purpose) => purposeLabels[purpose]).join(' + ')
              : missingValue}
            {' · '}
            {application.areaTypes.length > 0
              ? application.areaTypes.map((areaType) => areaTypeShortLabels[areaType]).join(' + ')
              : missingValue}
            {application.site?.landParcels[0]?.areaSquareMetres
              ? ` · ${Number(application.site.landParcels[0].areaSquareMetres).toLocaleString('en-US')} ตร.ม.`
              : ''}
            {application.plantsPerCycle !== null ? ` · ${application.plantsPerCycle} ต้น/รอบ` : ''}
            {application.cyclesPerYear !== null ? ` · ${application.cyclesPerYear} รอบ/ปี` : ''}
            {application.landTenure ? ` · ${landTenureLabels[application.landTenure]}` : ''}
            {application.landlordName ? ` ${application.landlordName}` : ''}
            {' · '}
            {application.plantMaterials.length > KATORLOR1_PLANT_MATERIAL_ROWS
              ? step6.materialsWithAppendix(application.plantMaterials.length)
              : step6.materialsCount(application.plantMaterials.length)}
          </p>
          <p>
            <b>{step6.part3}</b>{' '}
            {step6.attachments(
              requiredStatuses.filter((status) => status.satisfied).length,
              requiredStatuses.length,
            )}
            {licenseStatuses.map((status) => (
              <span key={status.slot.code}>
                {' · '}
                {status.slot.labelTh}{' '}
                {status.licenseState ? licenseSlotStateLabels[status.licenseState] : ''}
              </span>
            ))}
          </p>
        </div>
      </Card>

      <div className="mt-[18px] text-center">
        <button
          type="button"
          disabled
          className="inline-flex h-12 cursor-not-allowed items-center justify-center rounded-md bg-[#8ed4ab] px-[26px] text-[15px] font-bold text-white"
        >
          {netAmount ? step6.confirmButton(netAmount) : step6.confirmButtonNoAmount}
        </button>
        <p className="mt-2 text-xs text-quiet">
          {blocked ? step6.confirmLocked(items.length) : step6.comingSoon}
        </p>
      </div>

      <FootNav
        backHref={stepPath(application.id, 5)}
        backLabel={messages.form.backToStep(5, messages.form.step5.plansTitle)}
        nextHref="/applicant"
        nextLabel={messages.form.saveAndExit}
      />
    </>
  );
}

export function Step6Aside({ context }: { readonly context: StepPageContext }) {
  const step6 = messages.form.step6;
  const stage1 = context.feeEstimates.find(
    (estimate) => estimate.stage === FeeStage.DOCUMENT_REVIEW,
  );
  const quotation = stage1?.forSelection ?? null;
  return (
    <>
      <AsideCard title={step6.estimateTitle}>
        {stage1 === undefined ? (
          <p className="text-[13px] leading-relaxed text-muted">{messages.form.noFeeSchedule}</p>
        ) : quotation === null ? (
          <p className="text-[13px] leading-relaxed text-muted">{step6.estimateNeedsFormats}</p>
        ) : (
          <>
            <div className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 text-[13.5px]">
              <span className="text-ink-soft">
                {stage1.schedule.lineTitleTh} · {step6.formatsCount(quotation.lines.length)}
              </span>
              <span className="whitespace-nowrap text-right">
                {formatBahtFromSatang(quotation.totals.subtotalSatang, { withUnit: true })}
              </span>
              <span className="text-ink-soft">
                {step6.vatLine(String(quotation.vatRateBasisPoints / 100))}
              </span>
              <span className="whitespace-nowrap text-right">
                {formatBahtFromSatang(quotation.totals.vatSatang, { withUnit: true })}
              </span>
              <span className="mt-1 border-t border-border pt-2 font-bold">{step6.netTotal}</span>
              <span className="mt-1 whitespace-nowrap border-t border-border pt-2 text-right text-[20px] font-bold text-forest-green">
                {formatBahtFromSatang(quotation.totals.netSatang, { withUnit: true })}
              </span>
            </div>
            <Hint>{step6.estimateHint}</Hint>
          </>
        )}
      </AsideCard>
      <AsideCard title={step6.afterConfirmTitle}>
        <ol className="flex flex-col gap-2.5 text-[13px]">
          {step6.afterConfirmSteps.map((text, index) => (
            <li key={text} className="flex items-start gap-2.5">
              <span
                className={`mt-1.5 h-2.5 w-2.5 flex-shrink-0 rounded-full ${index === 0 ? 'bg-leaf' : 'border-2 border-border bg-surface'}`}
              />
              <span>{text}</span>
            </li>
          ))}
        </ol>
      </AsideCard>
    </>
  );
}

export { STEP as STEP6 };
