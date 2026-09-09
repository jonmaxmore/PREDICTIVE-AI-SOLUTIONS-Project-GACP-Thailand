import { APPLICATION_FORM_STEPS, type ApplicationFormStep } from '@gacp/contracts';
import Link from 'next/link';
import type { StepProgress } from '@/lib/application-form/queries.ts';
import { formStepRailLabels, messages } from '@/messages/th.ts';
import { CheckIcon } from './icons.tsx';

type StepRailProps = {
  readonly current: ApplicationFormStep;
  readonly progress: readonly StepProgress[] | null;
  readonly applicationId: string | null;
};

type RailState = 'now' | 'done' | 'warn' | 'upcoming';

function missingCount(progress: readonly StepProgress[] | null, step: ApplicationFormStep): number {
  const entry = progress?.find((item) => item.step === step);
  if (!entry) return 0;
  return entry.missingFieldKeys.length + entry.missingSlotCodes.length;
}

// แถบ 6 ขั้น: ขั้นที่ผ่านมาบอกว่าครบหรือขาดกี่รายการ (ความจริงจาก server) กดกลับไปแก้ได้ทุกขั้น
export function StepRail({ current, progress, applicationId }: StepRailProps) {
  return (
    <ol className="my-[22px] mb-[26px] flex items-start">
      {APPLICATION_FORM_STEPS.map((step) => {
        const missing = missingCount(progress, step);
        const state: RailState =
          step === current ? 'now' : step < current ? (missing > 0 ? 'warn' : 'done') : 'upcoming';
        const [lineOne, lineTwo] = formStepRailLabels[step];
        const dotClass = {
          now: 'border-forest-green bg-forest-green text-white shadow-[0_0_0_4px_var(--gacp-color-forest-mist)]',
          done: 'border-leaf bg-leaf text-white',
          warn: 'border-2 border-[#f0b429] bg-[#fffaf0] text-warning',
          upcoming: 'border-border bg-surface text-muted',
        }[state];
        const textClass = {
          now: 'font-bold text-forest-green',
          done: 'text-muted',
          warn: 'text-warning',
          upcoming: 'text-muted',
        }[state];
        const lineClass =
          state === 'now' || state === 'done' ? 'before:bg-leaf' : 'before:bg-border';
        const content = (
          <>
            <span
              className={`relative z-[1] mx-auto mb-[7px] flex h-7 w-7 items-center justify-center rounded-full border-[1.5px] text-[13px] font-bold ${dotClass}`}
            >
              {state === 'done' ? <CheckIcon size={14} /> : step}
            </span>
            <span className="block">{lineOne}</span>
            {state === 'warn' ? (
              <span className="block text-xs">{messages.form.railMissing(missing)}</span>
            ) : lineTwo ? (
              <span className="block">{lineTwo}</span>
            ) : null}
          </>
        );
        return (
          <li
            key={step}
            aria-current={state === 'now' ? 'step' : undefined}
            className={`relative flex-1 px-1 text-center text-[12.5px] leading-[1.35] ${textClass} before:absolute before:top-[13px] before:left-[-50%] before:h-[3px] before:w-full before:content-[''] first:before:hidden ${lineClass}`}
          >
            {applicationId ? (
              <Link
                href={`/applicant/applications/${applicationId}/steps/${step}`}
                className="block hover:underline"
              >
                {content}
              </Link>
            ) : (
              <span className="block">{content}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
