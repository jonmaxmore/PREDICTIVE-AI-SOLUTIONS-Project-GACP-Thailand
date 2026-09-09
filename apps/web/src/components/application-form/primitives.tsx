import type { ReactNode } from 'react';
import { messages } from '@/messages/th.ts';
import { CheckIcon, LockIcon } from './icons.tsx';

// องค์ประกอบพื้นฐานของฟอร์ม ขนาดและสีตามแบบที่อนุมัติ (canvas ฟอร์มคำขอรับรอง GACP) และ token ใน packages/ui

export function Card({
  children,
  className = '',
  id,
}: {
  readonly children: ReactNode;
  readonly className?: string | undefined;
  readonly id?: string | undefined;
}) {
  return (
    <section
      id={id}
      className={`rounded-lg border border-border bg-surface px-6 py-[22px] shadow-card ${className}`}
    >
      {children}
    </section>
  );
}

export function CardHeading({
  title,
  reference,
  referenceTone = 'gold',
  lead,
  trailing,
}: {
  readonly title: ReactNode;
  readonly reference?: string | undefined;
  readonly referenceTone?: 'gold' | 'warn' | undefined;
  readonly lead?: string | undefined;
  readonly trailing?: ReactNode | undefined;
}) {
  return (
    <header className={lead ? 'mb-4' : 'mb-3'}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[17px] font-bold text-forest-green">{title}</h2>
        {reference ? <Tag tone={referenceTone}>{reference}</Tag> : trailing}
      </div>
      {lead ? <p className="mt-1.5 text-sm leading-relaxed text-muted">{lead}</p> : null}
    </header>
  );
}

export function Divider() {
  return <div className="my-4 h-px bg-border-soft" />;
}

export function FieldLabel({
  htmlFor,
  children,
  required,
  optional,
}: {
  readonly htmlFor?: string | undefined;
  readonly children: ReactNode;
  readonly required?: boolean | undefined;
  readonly optional?: boolean | undefined;
}) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-[13px] font-semibold text-ink">
      {children}
      {required ? <span className="ml-1 text-danger">*</span> : null}
      {optional ? (
        <span className="ml-1 text-xs font-normal text-quiet">{messages.form.optional}</span>
      ) : null}
    </label>
  );
}

const inputClassName =
  'block min-h-[42px] w-full rounded-[10px] border border-border bg-surface px-3 py-2 text-sm text-ink placeholder:text-quiet focus:border-leaf focus:outline-none';

export function TextInput({
  id,
  name,
  defaultValue,
  placeholder,
  type = 'text',
  inputMode,
  maxLength,
  min,
  step,
  invalid,
}: {
  readonly id?: string | undefined;
  readonly name: string;
  readonly defaultValue?: string | number | null | undefined;
  readonly placeholder?: string | undefined;
  readonly type?: 'text' | 'tel' | 'email' | 'number' | 'date' | undefined;
  readonly inputMode?: 'text' | 'numeric' | 'decimal' | 'tel' | 'email' | undefined;
  readonly maxLength?: number | undefined;
  readonly min?: number | string | undefined;
  readonly step?: number | string | undefined;
  readonly invalid?: boolean | undefined;
}) {
  return (
    <input
      id={id ?? name}
      name={name}
      type={type}
      inputMode={inputMode}
      maxLength={maxLength}
      min={min}
      step={step}
      defaultValue={defaultValue ?? ''}
      placeholder={placeholder}
      aria-invalid={invalid || undefined}
      className={`${inputClassName} ${invalid ? 'border-[1.5px] border-danger' : ''}`}
    />
  );
}

export function SelectInput({
  name,
  defaultValue,
  children,
}: {
  readonly name: string;
  readonly defaultValue?: string | null | undefined;
  readonly children: ReactNode;
}) {
  return (
    <select id={name} name={name} defaultValue={defaultValue ?? ''} className={inputClassName}>
      {children}
    </select>
  );
}

export function LockedValue({
  value,
  hint,
}: {
  readonly value: string | null;
  readonly hint?: string | undefined;
}) {
  return (
    <>
      <div className="flex min-h-[42px] items-center gap-2 rounded-[10px] border border-border bg-paper px-3 py-2 text-sm text-ink-soft">
        <LockIcon size={14} />
        {value ?? <span className="text-quiet">{messages.form.notFilled}</span>}
      </div>
      {hint ? <Hint>{hint}</Hint> : null}
    </>
  );
}

export function Hint({
  children,
  tone = 'muted',
}: {
  readonly children: ReactNode;
  readonly tone?: 'muted' | 'danger' | 'warning' | 'leaf' | undefined;
}) {
  const toneClass = {
    muted: 'text-muted',
    danger: 'font-semibold text-danger',
    warning: 'text-warning',
    leaf: 'font-semibold text-leaf',
  }[tone];
  return <p className={`mt-1.5 text-xs leading-relaxed ${toneClass}`}>{children}</p>;
}

// ตัวเลือกแบบการ์ด (radio) ใช้กับประเภทคำขอ ขอบข่าย ประเภทผู้ยื่น
export function ChoiceCard({
  name,
  value,
  checked,
  title,
  description,
}: {
  readonly name: string;
  readonly value: string;
  readonly checked: boolean;
  readonly title: string;
  readonly description?: string | undefined;
}) {
  return (
    <label className="block cursor-pointer rounded-md border-[1.5px] border-border bg-surface px-4 py-3 text-sm font-semibold text-ink-soft has-[:checked]:border-2 has-[:checked]:border-leaf has-[:checked]:bg-leaf-tint has-[:checked]:font-bold has-[:checked]:text-leaf">
      <input type="radio" name={name} value={value} defaultChecked={checked} className="sr-only" />
      <span className="block">{title}</span>
      {description ? (
        <span className="mt-0.5 block text-xs font-normal leading-relaxed text-muted">
          {description}
        </span>
      ) : null}
    </label>
  );
}

// ตัวเลือกแบบเม็ด ใช้กับชุดที่เลือกได้หลายค่า (ลักษณะพื้นที่ วัตถุประสงค์) และการถือครอง (radio)
export function Pill({
  name,
  value,
  checked,
  label,
  type = 'checkbox',
}: {
  readonly name: string;
  readonly value: string;
  readonly checked: boolean;
  readonly label: string;
  readonly type?: 'checkbox' | 'radio' | undefined;
}) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border-[1.5px] border-border bg-surface px-4 py-2 text-[13.5px] text-muted has-[:checked]:border-2 has-[:checked]:border-leaf has-[:checked]:bg-leaf-tint has-[:checked]:font-bold has-[:checked]:text-leaf">
      <input
        type={type}
        name={name}
        value={value}
        defaultChecked={checked}
        className="peer sr-only"
      />
      <CheckIcon size={13} className="hidden peer-checked:inline-flex" />
      {label}
    </label>
  );
}

export function Note({
  children,
  tone,
  className = '',
}: {
  readonly children: ReactNode;
  readonly tone: 'ok' | 'warn' | 'danger' | 'info' | 'quiet';
  readonly className?: string | undefined;
}) {
  const toneClass = {
    ok: 'border-[#bfe5cd] bg-leaf-tint text-[#1d4d31]',
    warn: 'border-[#f0d9a0] bg-[#fffaf0] text-[#5c4a1e]',
    danger: 'border-[#f2c9c9] bg-danger-tint text-[#5c3333]',
    info: 'border-[#cfdcf0] bg-[#eef3fa] text-[#1c3a63]',
    quiet: 'border-border-soft bg-paper text-ink-soft',
  }[tone];
  return (
    <div
      className={`rounded-md border px-3.5 py-3 text-[13px] leading-[1.65] ${toneClass} ${className}`}
    >
      {children}
    </div>
  );
}

export type TagTone = 'ok' | 'warn' | 'danger' | 'quiet' | 'info' | 'gold';

export function Tag({
  children,
  tone,
  className = '',
}: {
  readonly children: ReactNode;
  readonly tone: TagTone;
  readonly className?: string | undefined;
}) {
  const toneClass = {
    ok: 'bg-leaf-tint text-leaf',
    warn: 'bg-warning-tint text-warning',
    danger: 'bg-danger-tint text-danger',
    quiet: 'border border-border-soft bg-paper text-muted',
    info: 'bg-[#eef3fa] text-info',
    gold: 'bg-[#faf5e6] text-warning',
  }[tone];
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-[9px] py-0.5 text-[11.5px] font-semibold ${toneClass} ${className}`}
    >
      {children}
    </span>
  );
}

// แถวคีย์-ค่า ในการ์ดข้าง (เพราะคุณเลือก · ค่าใช้จ่าย)
export function KeyValueList({
  rows,
}: {
  readonly rows: readonly (readonly [ReactNode, ReactNode])[];
}) {
  return (
    <div className="grid grid-cols-[auto_1fr] gap-x-3.5 gap-y-1 text-[12.5px] leading-[1.7]">
      {rows.map(([key, value], index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: แถวคงที่ ไม่มีการเรียงใหม่
        <div key={index} className="contents">
          <b className="whitespace-nowrap font-semibold text-muted">{key}</b>
          <span>{value}</span>
        </div>
      ))}
    </div>
  );
}

export function AsideCard({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <section className="mb-4 rounded-lg border border-border bg-surface px-5 py-[18px] shadow-card">
      <h3 className="mb-2.5 text-sm font-bold text-forest-green">{title}</h3>
      {children}
    </section>
  );
}

export const buttonBaseClassName =
  'inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-md px-4 text-sm font-semibold';
export const buttonOutlineClassName = `${buttonBaseClassName} border border-border bg-surface text-ink-soft hover:bg-paper`;
export const buttonPrimaryClassName = `${buttonBaseClassName} bg-leaf font-bold text-white shadow-button hover:bg-leaf-hover`;
export const smallButtonPrimaryClassName =
  'inline-flex h-[34px] items-center justify-center gap-1.5 whitespace-nowrap rounded-[10px] bg-leaf px-3.5 text-[13px] font-bold text-white shadow-button hover:bg-leaf-hover';
export const smallButtonOutlineClassName =
  'inline-flex h-[34px] items-center justify-center gap-1.5 whitespace-nowrap rounded-[10px] border border-border bg-surface px-3.5 text-[13px] font-bold text-ink-soft hover:bg-paper';
export const smallButtonDangerClassName =
  'inline-flex h-[34px] items-center justify-center gap-1.5 whitespace-nowrap rounded-[10px] bg-danger px-3.5 text-[13px] font-bold text-white hover:opacity-90';
