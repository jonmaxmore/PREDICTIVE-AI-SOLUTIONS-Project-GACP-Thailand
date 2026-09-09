import { type ApplicationFormStep, UserRole } from '@gacp/contracts';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { RoleShell } from '@/components/role-shell.tsx';
import type { StepProgress } from '@/lib/application-form/queries.ts';
import { formStepTitles, messages } from '@/messages/th.ts';
import { ArrowLeftIcon, ArrowRightIcon, CheckIcon } from './icons.tsx';
import { buttonOutlineClassName, buttonPrimaryClassName, Tag } from './primitives.tsx';
import { StepRail } from './step-rail.tsx';

type FormShellProps = {
  readonly step: ApplicationFormStep;
  readonly plantNameTh: string;
  readonly referenceNumber: string | null;
  readonly applicationId: string | null;
  readonly progress: readonly StepProgress[] | null;
  readonly updatedAt: Date | null;
  readonly titleTag?: ReactNode | undefined;
  readonly headerChip?: ReactNode | undefined;
  readonly aside: ReactNode;
  readonly children: ReactNode;
};

function bangkokTime(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

// โครงหน้าฟอร์มทุกขั้น: หัวเรื่อง แถบขั้น และสองคอลัมน์ (เนื้อหา 1fr · แถบข้าง 352px) ตามแบบที่อนุมัติ
export function FormShell({
  step,
  plantNameTh,
  referenceNumber,
  applicationId,
  progress,
  updatedAt,
  titleTag,
  headerChip,
  aside,
  children,
}: FormShellProps) {
  return (
    <RoleShell role={UserRole.APPLICANT}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[13px] text-muted">
            {messages.form.applicationLabel} · {plantNameTh} ·{' '}
            {referenceNumber
              ? `${messages.form.draftLabel} ${referenceNumber}`
              : messages.form.newDraftLabel}
          </p>
          <h1 className="mt-1 flex flex-wrap items-center gap-3 text-[28px] font-bold leading-[1.3] text-ink">
            {messages.form.stepOf(step)} {formStepTitles[step]}
            {titleTag}
          </h1>
        </div>
        {headerChip ??
          (updatedAt ? (
            <Tag tone="quiet" className="px-3 py-1.5 text-[12.5px]">
              <CheckIcon size={13} />
              {messages.form.autosavedAt(bangkokTime(updatedAt))}
            </Tag>
          ) : null)}
      </div>

      <StepRail current={step} progress={progress} applicationId={applicationId} />

      <div className="grid items-start gap-6 lg:grid-cols-[1fr_352px]">
        <div className="min-w-0">{children}</div>
        <aside className="min-w-0">{aside}</aside>
      </div>
    </RoleShell>
  );
}

type FootNavProps = {
  readonly backHref: string;
  readonly backLabel: string;
  readonly nextLabel: string;
  readonly nextFormId?: string | undefined;
  readonly nextHref?: string | undefined;
  readonly warning?: string | null | undefined;
};

// แถวปุ่มท้ายหน้า: กลับ (ลิงก์) และไปขั้นถัดไป (ปุ่มส่งฟอร์ม autosave ผ่าน attribute form หรือลิงก์เมื่อขั้นนั้นไม่มีช่องกรอก)
export function FootNav({
  backHref,
  backLabel,
  nextLabel,
  nextFormId,
  nextHref,
  warning,
}: FootNavProps) {
  return (
    <div className="mt-[22px] flex flex-wrap items-center justify-between gap-4">
      <Link href={backHref} className={buttonOutlineClassName}>
        <ArrowLeftIcon size={16} />
        {backLabel}
      </Link>
      <div className="text-right">
        {warning ? <p className="mb-1.5 text-xs text-warning">{warning}</p> : null}
        {nextFormId ? (
          <button
            type="submit"
            form={nextFormId}
            name="intent"
            value="next"
            className={buttonPrimaryClassName}
          >
            {nextLabel}
            <ArrowRightIcon size={16} />
          </button>
        ) : nextHref ? (
          <Link href={nextHref} className={buttonPrimaryClassName}>
            {nextLabel}
            <ArrowRightIcon size={16} />
          </Link>
        ) : null}
      </div>
    </div>
  );
}
