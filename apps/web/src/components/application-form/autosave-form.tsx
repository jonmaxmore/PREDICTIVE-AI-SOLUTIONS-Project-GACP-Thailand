'use client';

import { type FormEvent, type ReactNode, useEffect, useRef, useTransition } from 'react';

type AutosaveFormProps = {
  readonly id: string;
  readonly action: (formData: FormData) => Promise<void>;
  readonly children: ReactNode;
  readonly className?: string | undefined;
  readonly debounceMs?: number | undefined;
  // ป้ายสถานะ "บันทึกอัตโนมัติแล้ว / กำลังบันทึก" ไม่ส่ง = ไม่แสดง
  readonly savedLabel?: string | undefined;
  readonly savingLabel?: string | undefined;
};

// บันทึกร่างอัตโนมัติ: เปลี่ยนค่าเมื่อไร ส่งให้ Server Action (ช่องข้อความหน่วงสั้น ๆ) ไม่มีปุ่ม "บันทึก" ให้ลืม
// เรียก action เองใน transition แทนการใช้ action prop ของ <form> เพื่อไม่ให้ React reset ช่องที่ผู้ใช้กำลังพิมพ์
// หลังบันทึกเสร็จ (ค่าที่พิมพ์ระหว่างบันทึกจะไม่หาย) และเรียงคิวการบันทึกให้เสร็จทีละรายการ
// ปุ่ม "ไปขั้นถัดไป" อยู่นอกฟอร์มได้ด้วย attribute form={id} (ส่ง intent=next ให้ action บันทึกแล้วพาไปขั้นถัดไป)
export function AutosaveForm({
  id,
  action,
  children,
  className,
  debounceMs = 700,
  savedLabel,
  savingLabel,
}: AutosaveFormProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const [pending, startTransition] = useTransition();

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const submit = (submitter: HTMLElement | null) => {
    const form = formRef.current;
    if (!form) return;
    const formData = new FormData(form, submitter);
    startTransition(async () => {
      queueRef.current = queueRef.current.then(() => action(formData)).catch(() => undefined);
      await queueRef.current;
    });
  };

  const scheduleSubmit = (delay: number) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => submit(null), delay);
  };

  const onInput = (event: FormEvent<HTMLFormElement>) => {
    const target = event.target as HTMLElement;
    const isTextLike =
      target instanceof HTMLInputElement
        ? !['checkbox', 'radio', 'file', 'date'].includes(target.type)
        : target instanceof HTMLTextAreaElement;
    scheduleSubmit(isTextLike ? debounceMs : 0);
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (timerRef.current) clearTimeout(timerRef.current);
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    submit(submitter instanceof HTMLElement ? submitter : null);
  };

  return (
    <form
      id={id}
      ref={formRef}
      className={className}
      onSubmit={onSubmit}
      onInput={onInput}
      onChange={onInput}
    >
      {children}
      {savedLabel && savingLabel ? (
        <div className="mt-3 flex justify-end">
          <span
            className={`inline-flex items-center gap-1 rounded-full border border-border-soft bg-paper px-3 py-1 text-xs ${pending ? 'text-warning' : 'text-muted'}`}
            aria-live="polite"
          >
            {pending ? savingLabel : savedLabel}
          </span>
        </div>
      ) : null}
    </form>
  );
}
