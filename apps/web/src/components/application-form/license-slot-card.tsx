import {
  type ApplicationFormStep,
  LicenseDeclarationStatus,
  RequirementLevel,
} from '@gacp/contracts';
import { toCalendarDate } from '@gacp/db';
import { LicenseSlotState } from '@gacp/domain';
import { saveLicenseDeclaration } from '@/app/applicant/applications/actions.ts';
import type { SlotStatus } from '@/lib/application-form/queries.ts';
import {
  controlledHerbLicenseFormLabels,
  licenseDeclarationStatusLabels,
  licenseSlotStateLabels,
  messages,
  uploadRejectionMessages,
} from '@/messages/th.ts';
import { AutosaveForm } from './autosave-form.tsx';
import {
  DocumentFileRow,
  type SlotCardTone,
  SlotFrame,
  SlotUploadForm,
} from './document-slot-card.tsx';
import { CheckIcon, ClockIcon, PendingIcon } from './icons.tsx';
import { FieldLabel, Hint, Note, Tag, TextInput } from './primitives.tsx';

type LicenseSlotCardProps = {
  readonly status: SlotStatus;
  readonly applicationId: string;
  readonly step: ApplicationFormStep;
  readonly editable: boolean;
  readonly errorCode: string | null;
};

const STATUS_ORDER = [
  LicenseDeclarationStatus.HAVE,
  LicenseDeclarationStatus.APPLIED,
  LicenseDeclarationStatus.NONE,
] as const;

function dateValue(value: Date | null | undefined): string {
  return value ? toCalendarDate(value) : '';
}

// การ์ดใบอนุญาตสมุนไพรควบคุม 3 สถานะ: แนบใบอนุญาตแล้ว / ยื่นคำขอแล้วรอผล / ยังไม่ได้ยื่น (+ วิธีขอ)
// สถานะที่แจ้งบันทึกอัตโนมัติ ไฟล์ประกอบผ่านท่ออัปโหลดเดียวกันกับช่องอื่น
export function LicenseSlotCard({
  status,
  applicationId,
  step,
  editable,
  errorCode,
}: LicenseSlotCardProps) {
  const { slot, requirement, documents, declaration } = status;
  const state = status.licenseState ?? LicenseSlotState.UNDECLARED;
  const required = requirement.requirementLevel === RequirementLevel.REQUIRED;
  const rejection = errorCode
    ? uploadRejectionMessages[errorCode as keyof typeof uploadRejectionMessages]
    : undefined;
  const tone: SlotCardTone = rejection
    ? 'bad'
    : state === LicenseSlotState.ATTACHED
      ? 'ok'
      : state === LicenseSlotState.PENDING_DECISION
        ? 'info'
        : state === LicenseSlotState.NOT_FILED
          ? 'bad'
          : required
            ? 'todo'
            : 'plain';
  const stateTagTone = {
    [LicenseSlotState.ATTACHED]: 'ok',
    [LicenseSlotState.PENDING_DECISION]: 'info',
    [LicenseSlotState.NOT_FILED]: 'danger',
    [LicenseSlotState.UNDECLARED]: 'warn',
  } as const;
  const declaredStatus = declaration?.status;
  const step5 = messages.form.step5;

  return (
    <SlotFrame
      id={`slot-${slot.code}`}
      tone={tone}
      icon={
        state === LicenseSlotState.ATTACHED ? (
          <CheckIcon size={16} />
        ) : state === LicenseSlotState.PENDING_DECISION ? (
          <ClockIcon size={16} />
        ) : (
          <PendingIcon size={16} />
        )
      }
      title={
        <>
          {slot.labelTh}
          {required ? (
            <span className="text-danger">*</span>
          ) : (
            <Tag tone="quiet">{messages.documentCard.optional}</Tag>
          )}
          {controlledHerbLicenseFormLabels[slot.code] ? (
            <Tag tone="quiet">{controlledHerbLicenseFormLabels[slot.code]}</Tag>
          ) : null}
        </>
      }
      description={slot.whatIsItTh}
      trailing={<Tag tone={stateTagTone[state]}>{licenseSlotStateLabels[state]}</Tag>}
    >
      {editable ? (
        <AutosaveForm
          id={`license-${slot.code}`}
          action={saveLicenseDeclaration.bind(null, applicationId)}
        >
          <input type="hidden" name="slotCode" value={slot.code} />
          <div className="mt-2.5">
            <span className="mb-1.5 block text-[13px] font-semibold text-ink">
              {step5.licenseStatusLabel}
            </span>
            <div className="inline-flex overflow-hidden rounded-[10px] border border-border text-[12.5px]">
              {STATUS_ORDER.map((value) => (
                <label
                  key={value}
                  className="cursor-pointer border-r border-border bg-surface px-3 py-[7px] text-muted last:border-r-0 has-[:checked]:bg-forest-green has-[:checked]:font-bold has-[:checked]:text-white"
                >
                  <input
                    type="radio"
                    name="status"
                    value={value}
                    defaultChecked={declaredStatus === value}
                    className="sr-only"
                  />
                  {licenseDeclarationStatusLabels[value]}
                </label>
              ))}
            </div>
          </div>

          {declaredStatus === LicenseDeclarationStatus.HAVE ? (
            <div className="mt-3.5 grid gap-x-5 gap-y-4 md:grid-cols-3">
              <div>
                <FieldLabel htmlFor={`licenseNumber-${slot.code}`} required>
                  {step5.licenseNumber}
                </FieldLabel>
                <TextInput
                  id={`licenseNumber-${slot.code}`}
                  name="licenseNumber"
                  defaultValue={declaration?.licenseNumber}
                  maxLength={60}
                />
              </div>
              <div>
                <FieldLabel htmlFor={`issuedOn-decl-${slot.code}`} required>
                  {step5.issuedOn}
                </FieldLabel>
                <TextInput
                  id={`issuedOn-decl-${slot.code}`}
                  name="issuedOn"
                  type="date"
                  defaultValue={dateValue(declaration?.issuedOn)}
                />
              </div>
              <div>
                <FieldLabel htmlFor={`expiresOn-${slot.code}`} required>
                  {step5.expiresOn}
                </FieldLabel>
                <TextInput
                  id={`expiresOn-${slot.code}`}
                  name="expiresOn"
                  type="date"
                  defaultValue={dateValue(declaration?.expiresOn)}
                />
              </div>
            </div>
          ) : null}

          {declaredStatus === LicenseDeclarationStatus.APPLIED ? (
            <div className="mt-3.5 grid gap-x-5 gap-y-4 md:grid-cols-2">
              <div>
                <FieldLabel htmlFor={`receiptNumber-${slot.code}`} required>
                  {step5.receiptNumber}
                </FieldLabel>
                <TextInput
                  id={`receiptNumber-${slot.code}`}
                  name="receiptNumber"
                  defaultValue={declaration?.receiptNumber}
                  maxLength={60}
                />
              </div>
              <div>
                <FieldLabel htmlFor={`filedWithTh-${slot.code}`} required>
                  {step5.filedWith}
                </FieldLabel>
                <TextInput
                  id={`filedWithTh-${slot.code}`}
                  name="filedWithTh"
                  defaultValue={declaration?.filedWithTh}
                  maxLength={200}
                />
              </div>
              <div>
                <FieldLabel htmlFor={`filedOn-${slot.code}`} required>
                  {step5.filedOn}
                </FieldLabel>
                <TextInput
                  id={`filedOn-${slot.code}`}
                  name="filedOn"
                  type="date"
                  defaultValue={dateValue(declaration?.filedOn)}
                />
              </div>
              <div>
                <FieldLabel htmlFor={`expectedDecisionOn-${slot.code}`} required>
                  {step5.expectedDecisionOn}
                </FieldLabel>
                <TextInput
                  id={`expectedDecisionOn-${slot.code}`}
                  name="expectedDecisionOn"
                  type="date"
                  defaultValue={dateValue(declaration?.expectedDecisionOn)}
                />
              </div>
            </div>
          ) : null}
        </AutosaveForm>
      ) : null}

      {documents.map((document) => (
        <DocumentFileRow
          key={document.id}
          document={document}
          applicationId={applicationId}
          step={step}
          removable={editable}
        />
      ))}

      {editable &&
      declaredStatus === LicenseDeclarationStatus.HAVE &&
      documents.length < slot.maxFiles ? (
        <SlotUploadForm
          status={status}
          applicationId={applicationId}
          step={step}
          dropHint={step5.attachLicenseFile}
        />
      ) : null}
      {editable &&
      declaredStatus === LicenseDeclarationStatus.APPLIED &&
      documents.length < slot.maxFiles ? (
        <SlotUploadForm
          status={status}
          applicationId={applicationId}
          step={step}
          dropHint={step5.attachReceiptFile}
        />
      ) : null}
      {rejection ? (
        <Hint tone="danger">
          {messages.errors.uploadFailed}: {rejection}
        </Hint>
      ) : null}

      {declaredStatus === undefined ? <Hint tone="warning">{step5.licenseUndeclared}</Hint> : null}
      {state === LicenseSlotState.UNDECLARED && declaredStatus !== undefined ? (
        <Hint tone="warning">{step5.licenseFileMissing}</Hint>
      ) : null}
      {declaredStatus === LicenseDeclarationStatus.APPLIED ? (
        <Note tone="warn" className="mt-2.5">
          {step5.appliedNote}
        </Note>
      ) : null}
      {declaredStatus === LicenseDeclarationStatus.NONE ? (
        <>
          {slot.howToObtainTh ? (
            <Hint>
              {messages.documentCard.howToObtain}: {slot.howToObtainTh}
            </Hint>
          ) : null}
          {required ? (
            <Note tone="danger" className="mt-2">
              {step5.noneNote}
            </Note>
          ) : null}
        </>
      ) : null}
    </SlotFrame>
  );
}
