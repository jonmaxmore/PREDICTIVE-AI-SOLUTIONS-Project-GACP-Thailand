import { type ApplicationFormStep, RequirementLevel } from '@gacp/contracts';
import { toCalendarDate } from '@gacp/db';
import type { UploadRejectionCode } from '@gacp/domain';
import { formatCalendarDateThai, formatThaiDate } from '@gacp/ui';
import type { ReactNode } from 'react';
import { removeDocument, uploadDocument } from '@/app/applicant/applications/actions.ts';
import {
  acceptAttribute,
  formatFileSize,
  isPhotoSlot,
  slotLimitsLabel,
} from '@/lib/application-form/labels.ts';
import type { ApplicationDocumentRow, SlotStatus } from '@/lib/application-form/queries.ts';
import { messages, sopSubItemLabels, uploadRejectionMessages } from '@/messages/th.ts';
import { ConfirmSubmitButton } from './confirm-submit-button.tsx';
import { DocumentViewer } from './document-viewer.tsx';
import { CheckIcon, PendingIcon } from './icons.tsx';
import { FieldLabel, Hint, Tag } from './primitives.tsx';
import { UploadField } from './upload-field.tsx';

export type SlotCardTone = 'ok' | 'todo' | 'plain' | 'bad' | 'info';

export const slotToneClassName: Record<SlotCardTone, string> = {
  ok: 'border-[#bfe5cd] bg-[#f6fcf8]',
  todo: 'border-[1.5px] border-[#f0b429] bg-[#fffaf0]',
  plain: 'border-border bg-surface',
  bad: 'border-[1.5px] border-[#f2c9c9] bg-danger-tint',
  info: 'border-[#cfdcf0] bg-[#f7faff]',
};

const slotIconClassName: Record<SlotCardTone, string> = {
  ok: 'bg-leaf-tint text-leaf',
  todo: 'bg-warning-tint text-warning',
  plain: 'bg-paper text-muted',
  bad: 'bg-[#f9dcdc] text-danger',
  info: 'bg-[#eef3fa] text-info',
};

export function SlotFrame({
  id,
  tone,
  icon,
  title,
  description,
  trailing,
  children,
}: {
  readonly id: string;
  readonly tone: SlotCardTone;
  readonly icon: ReactNode;
  readonly title: ReactNode;
  readonly description: ReactNode;
  readonly trailing?: ReactNode | undefined;
  readonly children?: ReactNode | undefined;
}) {
  return (
    <div id={id} className={`mt-2.5 rounded-md border px-4 py-3.5 ${slotToneClassName[tone]}`}>
      <div className="flex items-start gap-3">
        <span
          className={`inline-flex h-[34px] w-[34px] flex-shrink-0 items-center justify-center rounded-[10px] ${slotIconClassName[tone]}`}
        >
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 text-[14.5px] font-semibold leading-[1.4]">
            {title}
          </div>
          <div className="mt-0.5 text-[12.5px] leading-[1.6] text-muted">{description}</div>
        </div>
        {trailing}
      </div>
      {children ? <div className="ml-[46px] max-md:ml-0">{children}</div> : null}
    </div>
  );
}

// แถวไฟล์หนึ่งไฟล์: ชื่อ ขนาด วันที่ เปิดดูในหน้า ลบ
export function DocumentFileRow({
  document,
  applicationId,
  step,
  removable,
}: {
  readonly document: ApplicationDocumentRow;
  readonly applicationId: string;
  readonly step: ApplicationFormStep;
  readonly removable: boolean;
}) {
  const meta = [
    formatFileSize(document.byteSize),
    `${messages.documentCard.uploadedOn} ${formatThaiDate(document.uploadedAt)}`,
    document.issuedOn
      ? messages.documentCard.issuedOnValue(
          formatCalendarDateThai(toCalendarDate(document.issuedOn)),
        )
      : null,
  ]
    .filter((part): part is string => part !== null)
    .join(' · ');
  return (
    <div className="mt-2 flex flex-wrap items-center justify-between gap-2.5 rounded-[10px] border border-border-soft bg-surface px-3 py-2 text-[13px]">
      <div className="min-w-0">
        <div className="truncate font-semibold text-ink">{document.fileName}</div>
        <div className="text-xs text-muted">{meta}</div>
      </div>
      <div className="flex items-center gap-3 whitespace-nowrap text-[12.5px] font-semibold text-leaf">
        <DocumentViewer
          contentPath={`/applicant/documents/${document.id}/content`}
          fileName={document.fileName}
          mimeType={document.mimeType}
          openLabel={messages.documentCard.view}
          closeLabel={messages.documentCard.viewerClose}
          unsupportedLabel={messages.documentCard.viewerUnsupported}
          downloadLabel={messages.documentCard.download}
        />
        {removable ? (
          <form action={removeDocument}>
            <input type="hidden" name="applicationId" value={applicationId} />
            <input type="hidden" name="documentId" value={document.id} />
            <input type="hidden" name="returnStep" value={step} />
            <ConfirmSubmitButton
              confirmText={`${messages.documentCard.confirmRemove} ${document.fileName}`}
              className="text-xs font-normal text-quiet hover:text-danger hover:underline"
            >
              {messages.documentCard.remove}
            </ConfirmSubmitButton>
          </form>
        ) : null}
      </div>
    </div>
  );
}

// ฟอร์มอัปโหลดของช่องหนึ่งช่อง (ท่อเดียว: uploadDocument) เลือกไฟล์แล้วส่งทันที
export function SlotUploadForm({
  status,
  applicationId,
  step,
  chooseLabel,
  dropHint,
}: {
  readonly status: SlotStatus;
  readonly applicationId: string;
  readonly step: ApplicationFormStep;
  readonly chooseLabel?: string | undefined;
  readonly dropHint?: string | undefined;
}) {
  const { slot } = status;
  const photo = isPhotoSlot(slot);
  return (
    <form action={uploadDocument} className="mt-1">
      <input type="hidden" name="applicationId" value={applicationId} />
      <input type="hidden" name="slotCode" value={slot.code} />
      <input type="hidden" name="returnStep" value={step} />
      {slot.requiresIssuedDate ? (
        <div className="mt-3 max-w-[260px]">
          <FieldLabel htmlFor={`issuedOn-${slot.code}`} required>
            {messages.documentCard.issuedOn}
          </FieldLabel>
          <input
            id={`issuedOn-${slot.code}`}
            name="issuedOn"
            type="date"
            className="block min-h-[42px] w-full rounded-[10px] border border-border bg-surface px-3 py-2 text-sm text-ink focus:border-leaf focus:outline-none"
          />
          <Hint>{messages.documentCard.issuedOnFirst}</Hint>
        </div>
      ) : null}
      <UploadField
        accept={acceptAttribute(slot)}
        chooseLabel={
          chooseLabel ??
          (photo ? messages.documentCard.choosePhoto : messages.documentCard.chooseFile)
        }
        dropHint={dropHint ?? messages.documentCard.dropHint}
        limitsLabel={slotLimitsLabel(slot)}
        uploadingLabel={messages.documentCard.uploading}
        capture={photo}
      />
    </form>
  );
}

type DocumentSlotCardProps = {
  readonly status: SlotStatus;
  readonly applicationId: string;
  readonly step: ApplicationFormStep;
  readonly editable: boolean;
  readonly errorCode: string | null;
  readonly contextNote?: string | null | undefined;
  readonly compact?: boolean | undefined;
};

const REASON_TAG_PREFIX = 'เพราะ';

// การ์ดเอกสารหนึ่งช่อง = หนึ่งเอกสารตามที่กรมติ๊ก สถานะ: ยังไม่ได้แนบ / แนบแล้ว (หลายไฟล์ได้) พร้อม "เพราะคุณเลือก" และ "หาได้ที่ไหน"
export function DocumentSlotCard({
  status,
  applicationId,
  step,
  editable,
  errorCode,
  contextNote,
  compact = false,
}: DocumentSlotCardProps) {
  const { slot, requirement, documents } = status;
  const required = requirement.requirementLevel === RequirementLevel.REQUIRED;
  const attached = documents.length > 0;
  const rejection = errorCode
    ? uploadRejectionMessages[errorCode as UploadRejectionCode]
    : undefined;
  const tone: SlotCardTone = rejection ? 'bad' : attached ? 'ok' : required ? 'todo' : 'plain';
  const reasonTags = requirement.reasonsTh.filter((reason) => reason.startsWith(REASON_TAG_PREFIX));
  const canAddMore = editable && documents.length < slot.maxFiles;

  return (
    <SlotFrame
      id={`slot-${slot.code}`}
      tone={tone}
      icon={attached ? <CheckIcon size={16} /> : <PendingIcon size={16} />}
      title={
        <>
          <span className={compact ? 'text-[13.5px]' : ''}>{slot.labelTh}</span>
          {required ? (
            <span className="text-danger">*</span>
          ) : (
            <Tag tone="quiet">{messages.documentCard.optional}</Tag>
          )}
          {reasonTags.map((reason) => (
            <Tag key={reason} tone="warn">
              {reason}
            </Tag>
          ))}
        </>
      }
      description={
        <>
          {slot.whatIsItTh}
          {contextNote ? <span className="block text-ink-soft">{contextNote}</span> : null}
        </>
      }
      trailing={
        attached ? (
          <Tag tone="ok">
            {documents.length > 1
              ? messages.documentCard.attachedCount(documents.length)
              : messages.documentCard.attached}
          </Tag>
        ) : required ? (
          <Tag tone="warn">{messages.documentCard.notAttached}</Tag>
        ) : null
      }
    >
      {documents.map((document) => (
        <DocumentFileRow
          key={document.id}
          document={document}
          applicationId={applicationId}
          step={step}
          removable={editable}
        />
      ))}
      {canAddMore ? (
        <SlotUploadForm
          status={status}
          applicationId={applicationId}
          step={step}
          chooseLabel={attached ? messages.documentCard.addFile : undefined}
        />
      ) : editable && attached ? (
        <Hint>{messages.documentCard.maxFilesReached}</Hint>
      ) : null}
      {rejection ? (
        <Hint tone="danger">
          {messages.errors.uploadFailed}: {rejection}
        </Hint>
      ) : errorCode === 'slot' ? (
        <Hint tone="danger">{messages.errors.slotNotApplicable}</Hint>
      ) : null}
      {slot.issuedWithinDays ? (
        <Hint tone="warning">{messages.documentCard.issuedWithin(slot.issuedWithinDays)}</Hint>
      ) : null}
      {!attached && slot.howToObtainTh ? (
        <Hint>
          {messages.documentCard.howToObtain}: {slot.howToObtainTh}
        </Hint>
      ) : null}
      {slot.subItemCodes && slot.subItemCodes.length > 0 ? (
        <div className="mt-3">
          <p className="text-xs font-semibold text-muted">{messages.form.step5.sopSubItemsTitle}</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {slot.subItemCodes.map((code) => (
              <Tag key={code} tone="quiet">
                {sopSubItemLabels[code]}
              </Tag>
            ))}
          </div>
        </div>
      ) : null}
    </SlotFrame>
  );
}
