import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * คีย์บอร์ดที่ควรเด้งขึ้นมาบนมือถือ อนุมานจาก `type` ของช่อง
 *
 * operator 2026-09-10: "ใช้งานยาก กดไม่ค่อยถูก" · วัดจริงก่อนแก้: `inputMode` เป็น
 * **ศูนย์จุดทั้งแอป** ⇒ ช่องกรอกตัวเลขทุกช่อง (จำนวนต้น พื้นที่ จำนวนเงิน เบอร์โทร)
 * เด้งแป้นตัวอักษรขึ้นมา แล้วเกษตรกรต้องกดสลับแป้นเองทุกครั้ง
 *
 * ทำที่นี่จุดเดียว เพราะ 28 จุดที่มี type="number" วันนี้ และทุกจุดที่จะเขียนพรุ่งนี้
 * ควรได้แป้นที่ถูกโดยไม่ต้องมีใครจำ · ผู้เรียกที่ส่ง inputMode มาเอง ชนะเสมอ
 *
 * `number` → `decimal` ไม่ใช่ `numeric`: พื้นที่และจำนวนเงินมีจุดทศนิยม ส่วนจำนวนต้น
 * ไม่มีก็ไม่เสียหาย — แป้นที่มีจุดเกินมาดีกว่าแป้นที่พิมพ์ 1,600.50 ไม่ได้
 */
const INPUT_MODE_BY_TYPE: Record<string, React.HTMLAttributes<HTMLInputElement>['inputMode']> = {
  number: 'decimal',
  tel: 'tel',
  email: 'email',
  url: 'url',
  search: 'search',
};

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string | undefined;
  error?: string | undefined;
  description?: string | undefined;
  leftSection?: React.ReactNode;
  rightSection?: React.ReactNode;
  icon?: React.ReactNode;
  w?: unknown;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, type, label, error, description, leftSection, rightSection, icon, id: providedId, inputMode, ...props }, ref) => {
  // ผู้เรียกที่ระบุเอง ชนะ · ที่เหลืออนุมานจาก type
  const resolvedInputMode = inputMode ?? (type ? INPUT_MODE_BY_TYPE[type] : undefined);
  // W3-A: useId() yields stable, unique ids per render. Auto-generate when
  // caller did not supply one so the <label htmlFor> ↔ <input id> link is
  // always present (WCAG 1.3.1 + 3.3.2). Caller-provided id wins.
  const generatedId = React.useId();
  const inputId = providedId ?? generatedId;
  const errorId = error ? `${inputId}-error` : undefined;
  const descriptionId = description ? `${inputId}-desc` : undefined;
  const describedBy = [descriptionId, errorId].filter(Boolean).join(' ') || undefined;
  const a11yProps = {
    'aria-invalid': error ? true as const : undefined,
    'aria-describedby': describedBy,
  };

  const showSection = leftSection ?? icon;
  const inputEl = showSection || rightSection ? (
    <div className="relative">
      {showSection && <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">{showSection}</span>}
      <input
        id={inputId}
        type={type}
        inputMode={resolvedInputMode}
        className={cn(
          'field-emphasis flex h-11 w-full px-4 py-2.5 ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground/90 focus-visible:shadow-[0_0_0_4px_var(--leaf-ring),0_0_0_1px_var(--leaf)] focus-visible:outline-none focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-50',
          showSection && 'pl-9',
          rightSection && 'pr-9',
          error && 'border-red-500',
          className,
        )}
        ref={ref}
        {...a11yProps}
        {...props}
      />
      {rightSection && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">{rightSection}</span>}
    </div>
  ) : (
    <input
      id={inputId}
      type={type}
      inputMode={resolvedInputMode}
      className={cn(
        'field-emphasis flex h-11 w-full px-4 py-2.5 ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground/90 focus-visible:shadow-[0_0_0_4px_var(--leaf-ring),0_0_0_1px_var(--leaf)] focus-visible:outline-none focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-50',
        error && 'border-red-500',
        className,
      )}
      ref={ref}
      {...a11yProps}
      {...props}
    />
  );

  if (!label && !error && !description) return inputEl;

  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label htmlFor={inputId} className="text-sm font-medium text-foreground">
          {label}
          {props.required && <span className="ml-1 text-red-500">*</span>}
        </label>
      )}
      {inputEl}
      {description && <p id={descriptionId} className="text-xs text-muted-foreground">{description}</p>}
      {error && <p id={errorId} className="field-error" role="alert">{error}</p>}
    </div>
  );
});
Input.displayName = 'Input';

export { Input };
